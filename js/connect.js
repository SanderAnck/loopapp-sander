// Garmin connection screen (#/koppeling): set up Intervals.icu as the bridge,
// send a test workout to the watch, and pull in recent runs.

import { esc, showToast, formatPace } from './ui.js';
import { db } from './db.js';
import { isoDate, formatRaceTime } from './profile.js';
import { loadSyncSettings, saveSyncSettings, syncActivities } from './sync/provider.js';
import { IntervalsProvider } from './sync/intervals.js';
import { pushUpcoming, WATCH_WINDOWS } from './plan.js';

/** Small structured workout to prove the whole chain works (about 16 minutes). */
export function testWorkout(date) {
  return {
    id: `test-${date}`,
    date,
    name: 'Pace testtraining',
    steps: [
      { kind: 'warmup', durationS: 300, pace: [430, 480] },
      {
        kind: 'repeat',
        reps: 3,
        steps: [
          { kind: 'work', label: 'Iets sneller', durationS: 60, pace: [370, 390] },
          { kind: 'recovery', durationS: 60, pace: [450, 490] },
        ],
      },
      { kind: 'cooldown', durationS: 300, pace: [440, 490] },
    ],
  };
}

function runRow(r) {
  const day = new Date(`${r.date}T12:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  if (r.needsInput) {
    return `<li class="list__row"><span>${esc(day)}<br><span class="field__hint">${esc(r.name)}</span></span>
      <span class="list__value">Geen details doorgekregen</span></li>`;
  }
  const km = (r.distanceM / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 2 });
  const pace = formatPace(r.durationS / (r.distanceM / 1000));
  return `<li class="list__row"><span>${esc(day)}<br><span class="field__hint">${esc(r.name)}</span></span>
    <span class="list__value"><strong>${km} km</strong> · ${formatRaceTime(r.durationS)} · ${pace}/km${r.avgHr ? ` · ${Math.round(r.avgHr)} bpm` : ''}</span></li>`;
}

async function runsHtml() {
  const runs = (await db.getAll('runs')).filter((r) => r.source === 'intervals').sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!runs.length) return '<p class="card__text" style="margin-top:0">Nog geen lopen opgehaald.</p>';
  return `<ul class="list">${runs.slice(0, 10).map(runRow).join('')}</ul>`;
}

function connectedHtml(settings) {
  const last = settings.lastSyncAt
    ? new Date(settings.lastSyncAt).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'nog niet';
  return `
    <section class="card">
      <div class="card__eyebrow"><span class="badge badge--good">● Verbonden</span></div>
      <h2 class="card__title">Intervals.icu${settings.athleteName ? ` · ${esc(settings.athleteName)}` : ''}</h2>
      <p class="card__text">Pace zet trainingen in je Intervals.icu-kalender. Die gaan via Garmin Connect naar je Venu 3. Je lopen komen langs dezelfde weg terug.</p>
    </section>

    <p class="section-label">Trainingen op je horloge</p>
    <section class="card">
      <div class="field" style="margin-top:0">
        <span class="field__label">Hoe ver vooruit?</span>
        <div class="seg">${Object.entries(WATCH_WINDOWS)
          .map(([k, label]) => `<button type="button" data-window="${k}" aria-pressed="${String(settings.watchWindow ?? 14) === k}">${label}</button>`)
          .join('')}</div>
        <span class="field__hint">Pace houdt deze periode automatisch bij op je horloge. Je kan in Schema ook een losse week versturen.</span>
      </div>
      <p class="card__text">Laatst verstuurd: <strong>${esc(settings.lastPushAt ? new Date(settings.lastPushAt).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'nog niet')}</strong></p>
      <button class="btn" type="button" id="push-now" style="margin-top:12px">Nu synchroniseren</button>
    </section>

    <p class="section-label">Testen</p>
    <section class="card">
      <h2 class="card__title" style="margin-top:0">Testtraining naar je horloge</h2>
      <p class="card__text">Een korte training van 16 minuten voor vandaag: opwarmen, 3 keer 1 minuut iets sneller, uitlopen.</p>
      <div class="btn-row" style="grid-template-columns:1fr">
        <button class="btn" type="button" id="push-test">Testtraining versturen</button>
      </div>
    </section>

    <p class="section-label">Je lopen</p>
    <section class="card card--flush" id="runs"><div class="card" style="border:0">Laden…</div></section>
    <p class="field__hint" style="margin:0 4px">Laatst opgehaald: ${esc(last)}</p>
    <button class="btn btn--secondary" type="button" id="fetch">Lopen nu ophalen</button>

    <p class="section-label">Koppeling</p>
    <button class="btn btn--secondary" type="button" id="disconnect">Ontkoppelen</button>`;
}

function setupHtml() {
  return `
    <section class="card">
      <h2 class="card__title" style="margin-top:0">Je Venu 3 koppelen</h2>
      <p class="card__text">Pace gebruikt het gratis Intervals.icu als brug naar Garmin Connect. Zo staan je trainingen op je horloge en komen je lopen vanzelf terug.</p>
      <hr class="divider">
      <ol class="card__text" style="padding-left:20px;margin:0">
        <li>Maak een gratis account op <strong>intervals.icu</strong>.</li>
        <li>Koppel daar bij <strong>Settings → Garmin</strong> je Garmin-account en vink <strong>Upload planned workouts</strong> aan.</li>
        <li>Maak onderaan bij <strong>Developer Settings</strong> een <strong>API key</strong> en kopieer die.</li>
      </ol>
    </section>
    <section class="card">
      <div class="field">
        <label class="field__label" for="api-key">API-sleutel van Intervals.icu</label>
        <input class="input" id="api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Plak hier je sleutel">
        <span class="field__hint">De sleutel blijft alleen op deze iPhone en komt niet in je back-up.</span>
      </div>
      <div class="btn-row" style="grid-template-columns:1fr">
        <button class="btn" type="button" id="connect">Verbinden</button>
      </div>
    </section>`;
}

export const connectView = {
  title: 'Garmin',
  tab: 'profiel',

  html({ sync }) {
    return sync.provider === 'intervals' && sync.apiKey ? connectedHtml(sync) : setupHtml();
  },

  async mount(root, { sync }) {
    const runsEl = root.querySelector('#runs');
    if (runsEl) runsEl.innerHTML = await runsHtml();

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const busy = (label) => {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = label;
      };
      const done = () => {
        btn.disabled = false;
        btn.textContent = btn.dataset.label;
      };

      if (btn.id === 'connect') {
        const key = root.querySelector('#api-key').value.trim();
        if (!key) return showToast('Plak eerst je API-sleutel.');
        busy('Verbinden…');
        const result = await new IntervalsProvider(key).testConnection();
        done();
        if (!result.ok) return showToast(result.message);
        await saveSyncSettings({ ...sync, provider: 'intervals', apiKey: key, athleteName: result.athleteName || '' });
        showToast('Verbonden met Intervals.icu');
        syncActivities().catch(() => {}).finally(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
      }

      if (btn.dataset.window) {
        const v = btn.dataset.window === 'all' ? 'all' : Number(btn.dataset.window);
        for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
        await saveSyncSettings({ ...(await loadSyncSettings()), watchWindow: v });
        btn.disabled = true;
        try {
          const r = await pushUpcoming();
          showToast(`${r.count} trainingen op je horloge gezet.`);
        } catch (err) {
          showToast(err.message);
        }
        btn.disabled = false;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
      }

      if (btn.id === 'push-now') {
        busy('Synchroniseren…');
        try {
          const r = await pushUpcoming();
          showToast(`${r.count} trainingen verstuurd. Synchroniseer je horloge met Garmin Connect.`);
        } catch (err) {
          showToast(err.message);
        }
        done();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }

      if (btn.id === 'push-test') {
        busy('Versturen…');
        try {
          await new IntervalsProvider(sync.apiKey).pushWorkouts([testWorkout(isoDate(new Date()))]);
          showToast('Verstuurd. Synchroniseer je horloge met Garmin Connect.');
        } catch (err) {
          showToast(err.message);
        }
        done();
      }

      if (btn.id === 'fetch') {
        busy('Ophalen…');
        try {
          const n = await syncActivities();
          showToast(n ? `${n} lopen opgehaald` : 'Geen lopen gevonden in de laatste 3 weken');
          runsEl.innerHTML = await runsHtml();
        } catch (err) {
          showToast(err.message);
        }
        done();
      }

      if (btn.id === 'disconnect') {
        await saveSyncSettings({ ...sync, provider: 'manual', apiKey: '', athleteName: '' });
        showToast('Ontkoppeld. Je kan je lopen nog altijd zelf invoeren.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    });
  },
};
