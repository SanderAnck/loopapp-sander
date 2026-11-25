// App shell: hash router, tab bar state, service worker and update toast.

import { views } from './views.js';
import { requestPersistentStorage } from './db.js';

const DEFAULT_ROUTE = 'vandaag';
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
const toastEl = document.getElementById('toast');

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return views[name] ? name : DEFAULT_ROUTE;
}

function render() {
  const route = currentRoute();
  const view = views[route];
  titleEl.textContent = view.title;
  document.title = `${view.title} · Pace`;
  viewEl.innerHTML = view.html();
  if (typeof view.mount === 'function') view.mount(viewEl);

  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.route === route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

// Buttons for features that arrive in later build steps.
viewEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-soon]')) showToast('Komt in een volgende stap.');
});

// Re-render when the system switches between light and dark mode.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
window.addEventListener('hashchange', render);

let toastTimer = null;
function showToast(message, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  toastEl.append(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    toastEl.append(btn);
  } else {
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
  }
  toastEl.hidden = false;
}

// Service worker: offline support, plus a toast when a new version is ready.
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('sw.js');

  const offerUpdate = (worker) =>
    showToast('Nieuwe versie van Pace', {
      label: 'Bijwerken',
      onClick: () => worker.postMessage('skipWaiting'),
    });

  if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  // Check for updates whenever the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

if (!location.hash) history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
render();
registerServiceWorker().catch((err) => console.warn('Service worker failed', err));
requestPersistentStorage();
