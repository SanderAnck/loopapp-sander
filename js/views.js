// Screen renderers. Each view returns { title, html } and may export an
// optional `mount(root)` hook for event wiring after the HTML is inserted.

import { isIos, isStandalone } from './platform.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Format seconds per km as m:ss. */
export function formatPace(secPerKm) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ICON_CALENDAR =
  '<svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const ICON_CHART =
  '<svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 19.5h17M6.5 16v-4M11 16V8M15.5 16v-6M20 16V5"/></svg>';

function installHint() {
  if (!isIos() || isStandalone()) return '';
  return `
    <section class="card">
      <div class="card__eyebrow"><span class="badge badge--accent">Tip</span></div>
      <h2 class="card__title">Zet Pace op je beginscherm</h2>
      <p class="card__text">Tik onderaan in Safari op <strong>Deel</strong> (vierkantje met pijl) en kies
      <strong>Zet op beginscherm</strong>. Daarna opent Pace als een echte app.</p>
    </section>`;
}

// Example workout, only to show the design until the schedule generator exists.
const SAMPLE = {
  type: 'Tempoloop',
  distanceKm: 6.4,
  minutes: 42,
  steps: [
    { name: 'Opwarming', meta: '10 min rustig', pace: 7 * 60 + 10, work: false },
    { name: '3 × 6 min drempel', meta: '2 min rustig dribbelen ertussen', pace: 5 * 60 + 55, work: true },
    { name: 'Cooling down', meta: '8 min rustig', pace: 7 * 60 + 20, work: false },
  ],
};

export const views = {
  vandaag: {
    title: 'Vandaag',
    html() {
      const date = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
      const steps = SAMPLE.steps
        .map(
          (s) => `
          <li class="step ${s.work ? 'step--work' : ''}">
            <span class="step__bar"></span>
            <span><span class="step__name">${esc(s.name)}</span><br><span class="step__meta">${esc(s.meta)}</span></span>
            <span class="step__pace">${formatPace(s.pace)}<span class="stat__unit">/km</span></span>
          </li>`
        )
        .join('');
      return `
        ${installHint()}
        <p class="section-label">${esc(date)}</p>
        <section class="card">
          <div class="card__eyebrow">${esc(SAMPLE.type)} <span class="badge">Voorbeeld</span></div>
          <div class="stats">
            <div><div class="stat__value">${SAMPLE.distanceKm.toLocaleString('nl-BE')}<span class="stat__unit">km</span></div><div class="stat__label">Afstand</div></div>
            <div><div class="stat__value">${SAMPLE.minutes}<span class="stat__unit">min</span></div><div class="stat__label">Duur</div></div>
            <div><div class="stat__value">${formatPace(SAMPLE.steps[1].pace)}</div><div class="stat__label">Doeltempo /km</div></div>
          </div>
          <ul class="steps">${steps}</ul>
          <div class="btn-row">
            <button class="btn btn--secondary" type="button" data-soon>Overslaan</button>
            <button class="btn" type="button" data-soon>Loop invoeren</button>
          </div>
        </section>
        <section class="card empty">
          <h2 class="empty__title">Nog geen schema</h2>
          <p class="empty__text">Stel je doel en trainingsdagen in, dan maakt Pace je persoonlijke schema.</p>
          <a class="btn" href="#/profiel">Doel instellen</a>
        </section>`;
    },
  },

  schema: {
    title: 'Schema',
    html() {
      const names = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const days = names
        .map((n, i) => {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const isToday = d.toDateString() === today.toDateString();
          const isRun = i === 1 || i === 5; // example: 2 run days
          return `<div class="day ${isRun ? 'day--run' : ''} ${isToday ? 'day--today' : ''}">
              <div class="day__name">${n}</div><div class="day__dot">${d.getDate()}</div></div>`;
        })
        .join('');
      return `
        <p class="section-label">Deze week</p>
        <section class="card">
          <div class="card__eyebrow">Weekoverzicht <span class="badge">Voorbeeld</span></div>
          <div class="week" style="margin-top:12px">${days}</div>
        </section>
        <section class="card empty">
          ${ICON_CALENDAR}
          <h2 class="empty__title">Je schema verschijnt hier</h2>
          <p class="empty__text">Per week zie je straks gepland tegenover uitgevoerd, met de fase waarin je zit.</p>
        </section>`;
    },
  },

  voortgang: {
    title: 'Voortgang',
    html() {
      return `
        <section class="card">
          <div class="card__eyebrow">Richting je doel</div>
          <div class="stats">
            <div><div class="stat__value">–</div><div class="stat__label">Geschatte 10 km</div></div>
            <div><div class="stat__value">–</div><div class="stat__label">Km deze week</div></div>
            <div><div class="stat__value">–</div><div class="stat__label">Consistentie</div></div>
          </div>
        </section>
        <section class="card empty">
          ${ICON_CHART}
          <h2 class="empty__title">Nog geen lopen</h2>
          <p class="empty__text">Na je eerste ingevoerde loop zie je hier je volume en geschatte eindtijd.</p>
        </section>`;
    },
  },

  profiel: {
    title: 'Profiel',
    html() {
      const mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Donker' : 'Licht';
      return `
        <section class="card">
          <div class="brand">
            <img src="icons/icon-192.png" alt="">
            <div><div class="brand__name">Pace</div><div class="brand__tag">Je persoonlijke loopcoach</div></div>
          </div>
        </section>
        <p class="section-label">Doel</p>
        <section class="card card--flush">
          <ul class="list">
            <li class="list__row"><span>Doel</span><span class="list__value">Nog niet ingesteld</span></li>
            <li class="list__row"><span>Doeldatum</span><span class="list__value">–</span></li>
            <li class="list__row"><span>Trainingsdagen</span><span class="list__value">–</span></li>
          </ul>
        </section>
        <p class="section-label">App</p>
        <section class="card card--flush">
          <ul class="list">
            <li class="list__row"><span>Weergave</span><span class="list__value">${mode} (volgt iPhone)</span></li>
            <li class="list__row"><span>Geïnstalleerd</span><span class="list__value">${isStandalone() ? 'Ja' : 'Nee, open in Safari'}</span></li>
            <li class="list__row"><span>Gegevens</span><span class="list__value" id="storage-state">Alleen op dit toestel</span></li>
            <li class="list__row"><span>Versie</span><span class="list__value">${esc(self.PACE_VERSION)}</span></li>
          </ul>
        </section>`;
    },
  },
};
