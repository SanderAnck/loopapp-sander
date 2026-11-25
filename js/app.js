// App shell: hash router, tab bar state, service worker and update toast.

import { views } from './views.js';
import { db, requestPersistentStorage } from './db.js';
import { loadProfile, analyse } from './profile.js';
import { showToast } from './ui.js';
import { loadSyncSettings, syncActivities } from './sync/provider.js';
import { loadPlan, ensurePlanAndWatch, pushUpcoming } from './plan.js';
import { seedTestWorkout } from './test-seed.js';

const DEFAULT_ROUTE = 'vandaag';
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return views[name] ? name : DEFAULT_ROUTE;
}

let renderId = 0;

async function render() {
  const id = ++renderId;
  const route = currentRoute();
  const view = views[route];

  const [profile, sync, runs, { plan, workouts }] = await Promise.all([
    loadProfile(),
    loadSyncSettings(),
    db.getAll('runs'),
    loadPlan(),
  ]);
  if (id !== renderId) return; // a newer navigation started meanwhile
  const ctx = { profile, analysis: profile ? analyse(profile) : null, sync, runs, plan, workouts };

  titleEl.textContent = view.title;
  document.title = `${view.title} · Pace`;

  // A fresh container per render, so event listeners never pile up.
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = view.html(ctx);
  viewEl.replaceChildren(page);
  if (typeof view.mount === 'function') await view.mount(page, ctx);

  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.route === view.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

// Buttons for features that arrive in later build steps.
viewEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-soon]')) showToast('Komt in een volgende stap.');
});

// Re-render when the system switches between light and dark mode,
// except on the setup form, where it would throw away unsaved input.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentRoute() !== 'doel') render();
});
window.addEventListener('hashchange', render);

// Service worker: offline support and automatic updates.
// A new version installs in the background, activates itself, and the
// page reloads onto it (except on the setup form, to keep unsaved input).
let registration = null;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  registration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });

  // Older versions waited for a tap on "Bijwerken": activate those right away.
  if (registration.waiting) registration.waiting.postMessage('skipWaiting');

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (currentRoute() === 'doel') {
      showToast('Nieuwe versie van Pace klaar', { label: 'Herladen', onClick: () => location.reload() });
      return;
    }
    reloading = true;
    location.reload();
  });

  // Check for updates whenever the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });
  registration.update().catch(() => {});
}

/** Manual check from the Profiel screen. */
export async function checkForUpdate() {
  if (!registration) return showToast('Updates werken alleen in de geïnstalleerde app.');
  showToast('Zoeken naar een nieuwe versie…');
  try {
    await registration.update();
    const worker = registration.installing || registration.waiting;
    if (worker) {
      worker.postMessage('skipWaiting');
      showToast('Nieuwe versie gevonden, Pace herlaadt…');
    } else {
      showToast(`Je hebt de nieuwste versie (${self.PACE_VERSION}).`);
    }
  } catch {
    showToast('Geen verbinding. Probeer het straks opnieuw.');
  }
}

window.addEventListener('pace:check-update', checkForUpdate);

// Pull new runs in the background when the app opens or returns to the
// foreground, at most every 15 minutes. Screens refresh when something came in.
async function autoSync() {
  // Keep the plan in step with the profile and the next 14 days on the watch.
  try {
    let changed = await ensurePlanAndWatch(await loadProfile());
    if (await seedTestWorkout((await loadPlan()).plan)) {
      changed = true;
      pushUpcoming().catch((err) => console.warn('Push failed', err));
    }
    if (changed) render();
  } catch (err) {
    console.warn('Plan update failed', err);
  }
  const s = await loadSyncSettings();
  if (s.provider !== 'intervals' || !s.apiKey) return;
  if (s.lastSyncAt && Date.now() - new Date(s.lastSyncAt) < 15 * 60 * 1000) return;
  try {
    const n = await syncActivities();
    if (n && currentRoute() !== 'doel') render();
  } catch (err) {
    console.warn('Sync failed', err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') autoSync();
});

if (!location.hash) history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
render().catch((err) => {
  console.error(err);
  viewEl.textContent = 'Er ging iets mis bij het laden van Pace.';
});
autoSync();
registerServiceWorker().catch((err) => console.warn('Service worker failed', err));
requestPersistentStorage();
