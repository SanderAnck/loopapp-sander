// Screen renderers. Each view has a title, the tab it belongs to,
// html(ctx) returning markup, and an optional mount(root, ctx) for events.
// ctx = { profile, analysis } (both null until the goal is set).

import { isIos, isStandalone } from './platform.js';
import { esc, formatPace, formatDateLong, zonesTable, FEASIBILITY_TEXT } from './ui.js';
import { goalLabel, levelLabel, formatRaceTime, WEEKDAYS_LONG } from './profile.js';
import { setupView } from './setup.js';

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

function goalCard(profile, analysis) {
  const goalPace = analysis.goalPaceS ? formatPace(analysis.goalPaceS) : '–';
  const now = analysis.predictedNowS ? formatRaceTime(analysis.predictedNowS) : '–';
  return `
    <section class="card">
      <div class="card__eyebrow">Je doel <span class="badge badge--accent">${analysis.weeks} weken</span></div>
      <h2 class="card__title">${esc(goalLabel(profile))}</h2>
      <p class="card__text">${esc(formatDateLong(profile.goal.date))}</p>
      <div class="stats">
        <div><div class="stat__value">${now}</div><div class="stat__label">Nu voorspeld</div></div>
        <div><div class="stat__value">${goalPace}</div><div class="stat__label">Doeltempo /km</div></div>
        <div><div class="stat__value">${analysis.currentVdot.toFixed(1).replace('.', ',')}</div><div class="stat__label">Fitheid (VDOT)</div></div>
      </div>
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

function sampleWorkout() {
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
    </section>`;
}

export const views = {
  vandaag: {
    title: 'Vandaag',
    tab: 'vandaag',
    html({ profile, analysis }) {
      const date = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
      const goal = profile
        ? goalCard(profile, analysis)
        : `
        <section class="card empty">
          <h2 class="empty__title">Nog geen doel</h2>
          <p class="empty__text">Stel je doel en trainingsdagen in, dan maakt Pace je persoonlijke schema.</p>
          <a class="btn" href="#/doel">Doel instellen</a>
        </section>`;
      return `
        ${installHint()}
        <p class="section-label">${esc(date)}</p>
        ${goal}
        ${sampleWorkout()}`;
    },
  },

  schema: {
    title: 'Schema',
    tab: 'schema',
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
    tab: 'voortgang',
    html({ analysis }) {
      const predicted = analysis?.predictedNowS ? formatRaceTime(analysis.predictedNowS) : '–';
      return `
        <section class="card">
          <div class="card__eyebrow">Richting je doel</div>
          <div class="stats">
            <div><div class="stat__value">${predicted}</div><div class="stat__label">Geschatte eindtijd</div></div>
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
    tab: 'profiel',
    html({ profile, analysis }) {
      const mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Donker' : 'Licht';
      let goalSection;
      if (profile) {
        const a = profile.availability;
        const days = a.preferredDays.length
          ? a.preferredDays.map((d) => WEEKDAYS_LONG[d].slice(0, 2)).join(', ')
          : 'geen vaste dagen';
        const longRun = a.longRunDay === null ? 'Pace kiest' : WEEKDAYS_LONG[a.longRunDay];
        const max = a.maxWeekdayMin ? `max. ${a.maxWeekdayMin} min` : 'geen limiet';
        const level = levelLabel(profile);
        const [fTitle, fText] = analysis.feasibility ? FEASIBILITY_TEXT[analysis.feasibility.level] : [null, null];
        goalSection = `
          <section class="card card--flush">
            <ul class="list">
              <li class="list__row"><span>Doel</span><span class="list__value">${esc(goalLabel(profile))}</span></li>
              <li class="list__row"><span>Doeldatum</span><span class="list__value">${esc(formatDateLong(profile.goal.date))}</span></li>
              <li class="list__row"><span>Huidig niveau</span><span class="list__value">${esc(level)}</span></li>
              <li class="list__row"><span>Weekvolume nu</span><span class="list__value">${profile.level.weeklyKm} km</span></li>
              <li class="list__row"><span>Trainingsdagen</span><span class="list__value">${a.daysPerWeek} per week</span></li>
              <li class="list__row"><span>Voorkeursdagen</span><span class="list__value">${esc(days)}</span></li>
              <li class="list__row"><span>Lange duurloop</span><span class="list__value">${esc(longRun)}</span></li>
              <li class="list__row"><span>Weekdagen</span><span class="list__value">${esc(max)}</span></li>
            </ul>
          </section>
          <a class="btn btn--secondary" href="#/doel">Doel en dagen wijzigen</a>
          ${fTitle ? `<section class="card"><div class="note note--${analysis.feasibility.level}"><strong>${esc(fTitle)}</strong>${esc(fText)}</div></section>` : ''}
          <p class="section-label">Je tempozones</p>
          <section class="card">
            <p class="card__text" style="margin-top:0">Berekend uit je huidig niveau (VDOT ${analysis.currentVdot.toFixed(1).replace('.', ',')}). Ze worden sneller naarmate je fitter wordt.</p>
            ${zonesTable(analysis.zones)}
          </section>`;
      } else {
        goalSection = `
          <section class="card empty">
            <h2 class="empty__title">Nog geen doel</h2>
            <p class="empty__text">Vertel Pace waar je naartoe wil en hoeveel je kan trainen.</p>
            <a class="btn" href="#/doel">Doel instellen</a>
          </section>`;
      }
      return `
        <section class="card">
          <div class="brand">
            <img src="icons/icon-192.png" alt="">
            <div><div class="brand__name">Pace</div><div class="brand__tag">Je persoonlijke loopcoach</div></div>
          </div>
        </section>
        <p class="section-label">Doel</p>
        ${goalSection}
        <p class="section-label">App</p>
        <section class="card card--flush">
          <ul class="list">
            <li class="list__row"><span>Weergave</span><span class="list__value">${mode} (volgt iPhone)</span></li>
            <li class="list__row"><span>Geïnstalleerd</span><span class="list__value">${isStandalone() ? 'Ja' : 'Nee, open in Safari'}</span></li>
            <li class="list__row"><span>Gegevens</span><span class="list__value">Alleen op dit toestel</span></li>
            <li class="list__row"><span>Versie</span><span class="list__value">${esc(self.PACE_VERSION)}</span></li>
          </ul>
        </section>`;
    },
  },

  doel: setupView,
};
