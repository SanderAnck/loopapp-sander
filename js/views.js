// Screen renderers. Each view has a title, the tab it belongs to,
// html(ctx) returning markup, and an optional mount(root, ctx) for events.
// ctx = { profile, analysis, plan, workouts, runs, sync } (profile/analysis/plan null until the goal is set).

import { isIos, isStandalone } from './platform.js';
import { esc, formatPace, formatDateLong, zonesTable, FEASIBILITY_TEXT } from './ui.js';
import { goalLabel, levelLabel, formatRaceTime, WEEKDAYS_LONG, isoDate } from './profile.js';
import { workoutCard, workoutRow, dayLabel } from './workout-ui.js';
import { PHASES, CHALLENGE_LEVELS, DEFAULT_CHALLENGE } from './coach/planner.js';
import { whyCard } from './workout-ui.js';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
import { setupView } from './setup.js';
import { connectView } from './connect.js';
import { entryView, resultView } from './entry.js';
import { db } from './db.js';
import { activeProvider } from './sync/provider.js';
import { showToast } from './ui.js';

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

function runListRow(r) {
  const day = new Date(`${r.date}T12:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  if (!r.distanceM || !r.durationS) {
    return `<li class="list__row"><span>${esc(day)}</span><span class="list__value">Details ontbreken</span></li>`;
  }
  const km = (r.distanceM / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 2 });
  return `<li class="list__row"><span>${esc(day)}</span><span class="list__value"><strong>${km} km</strong> · ${formatPace(r.durationS / (r.distanceM / 1000))}/km</span></li>`;
}

const isConnected = (sync) => sync.provider === 'intervals' && Boolean(sync.apiKey);
const runDates = (runs) => new Set(runs.filter((r) => !r.test).map((r) => r.date));

function noGoal() {
  return `
    <section class="card empty">
      <h2 class="empty__title">Nog geen doel</h2>
      <p class="empty__text">Stel je doel en trainingsdagen in, dan maakt Pace je persoonlijke schema.</p>
      <a class="btn" href="#/doel">Doel instellen</a>
    </section>`;
}

export const views = {
  vandaag: {
    title: 'Vandaag',
    tab: 'vandaag',
    html({ profile, analysis, workouts, runs, sync }) {
      const date = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
      if (!profile) return `${installHint()}<p class="section-label">${esc(date)}</p>${noGoal()}`;
      const today = isoDate(new Date());
      const done = runDates(runs);
      const todays = workouts.filter((w) => w.date === today);
      const next = workouts.find((w) => w.date > today);
      const actions = (w) => {
        if (w.status === 'done' || w.status === 'partial' || w.status === 'aborted') {
          return `<a class="btn btn--secondary" href="#/resultaat/c-${esc(w.id)}" style="margin-top:12px">Bekijk wat de coach zei</a>`;
        }
        if (w.status === 'skipped') return '<p class="card__text">Overgeslagen. Niet inhalen: je schema loopt gewoon verder.</p>';
        return `<div class="btn-row">
          <button class="btn btn--secondary" type="button" data-skip="${esc(w.id)}">Overslaan</button>
          <a class="btn" href="#/invoer/${esc(w.id)}">Loop invoeren</a></div>`;
      };
      // Runs that came in from the watch but have no questionnaire yet.
      const pending = workouts.filter((w) => w.date < today && w.status === 'planned' && done.has(w.date));
      const pendingCards = pending
        .map((w) => `<section class="card"><div class="card__eyebrow"><span class="badge badge--accent">⌚ Binnengekomen</span></div>
          <h2 class="card__title">Hoe ging je ${esc(w.name.toLowerCase())} van ${esc(dayLabel(w.date).toLowerCase())}?</h2>
          <p class="card__text">Vul de vragenlijst in, dan stuurt de coach je schema bij.</p>
          <a class="btn" href="#/invoer/${esc(w.id)}" style="margin-top:12px">Vragenlijst invullen</a></section>`)
        .join('');
      // A run on this date only counts for a workout when no other workout of
      // today was already linked to a run through the questionnaire.
      const finished = (w) => ['done', 'partial', 'aborted'].includes(w.status);
      const isDone = (w) => finished(w) || (w.status === 'planned' && done.has(w.date) && !todays.some(finished));
      let main;
      const visible = todays.filter((w) => w.status !== 'cancelled');
      if (visible.length) {
        main = visible
          .map((w) => workoutCard(w, { done: isDone(w), connected: isConnected(sync), heading: w.test ? 'Testtraining' : 'Training van vandaag', actions: actions(w) }))
          .join('');
      } else {
        main = `
          <section class="card">
            <div class="card__eyebrow">Rustdag</div>
            <h2 class="card__title">Vandaag geen training</h2>
            <p class="card__text">Rust hoort bij het schema: daar word je sterker van.${next ? ` Volgende training: <strong>${esc(dayLabel(next.date).toLowerCase())}</strong>.` : ''}</p>
          </section>
          ${next ? workoutCard(next, { done: false, connected: isConnected(sync), heading: `Volgende · ${dayLabel(next.date)}` }) : ''}`;
      }
      const watchHint =
        !isConnected(sync)
          ? `<a class="btn btn--secondary" href="#/koppeling">Trainingen naar je horloge sturen</a>`
          : '';
      return `
        ${installHint()}
        ${pendingCards}
        <p class="section-label">${esc(date)}</p>
        ${main}
        ${watchHint}
        ${goalCard(profile, analysis)}`;
    },
    mount(root) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-skip]');
        if (!b) return;
        const w = await db.get('workouts', b.dataset.skip);
        if (!w) return;
        await db.put('workouts', { ...w, status: 'skipped' });
        try {
          const provider = await activeProvider();
          if (provider.canPushWorkouts && w.pushedAt) await provider.deleteWorkouts([w.id]);
        } catch {
          /* the watch keeps it; harmless */
        }
        showToast('Overgeslagen. Niet inhalen: je schema loopt gewoon verder.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  },

  schema: {
    title: 'Schema',
    tab: 'schema',
    html({ profile, plan, workouts, runs }) {
      if (!profile || !plan) return noGoal();
      const names = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
      const todayDate = new Date();
      const today = isoDate(todayDate);
      const done = runDates(runs);
      const monday = new Date(todayDate);
      monday.setDate(todayDate.getDate() - ((todayDate.getDay() + 6) % 7));
      const byDate = new Map(workouts.map((w) => [w.date, w]));
      const strip = names
        .map((n, i) => {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const di = isoDate(d);
          const w = byDate.get(di);
          const cls = [w ? 'day--run' : '', di === today ? 'day--today' : '', done.has(di) ? 'day--done' : ''].join(' ');
          const inner = `<div class="day__name">${n}</div><div class="day__dot">${done.has(di) ? '✓' : d.getDate()}</div>`;
          return w ? `<a class="day ${cls}" href="#/training/${esc(w.id)}">${inner}</a>` : `<div class="day ${cls}">${inner}</div>`;
        })
        .join('');

      const current = plan.weeks.find((wk) => wk.start <= today && today < addDays(wk.start, 7)) || plan.weeks[0];
      const phase = PHASES[current.phase];
      const phaseBar = plan.weeks
        .map((wk) => `<span class="phase-seg phase-seg--${wk.phase}${wk.week === current.week ? ' is-now' : ''}" title="Week ${wk.week}"></span>`)
        .join('');

      const weekCards = plan.weeks
        .filter((wk) => addDays(wk.start, 7) > today)
        .map((wk) => {
          const ws = workouts.filter((w) => w.week === wk.week && w.date >= wk.start && w.date < addDays(wk.start, 7));
          const startText = new Date(`${wk.start}T12:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
          return `
            <p class="section-label">Week ${wk.week} · ${esc(PHASES[wk.phase].label)}${wk.recovery ? ' · herstelweek' : ''}</p>
            <section class="card card--flush">
              <div class="list__row" style="border-top:0"><span class="field__hint">vanaf ${esc(startText)}</span><span class="list__value">${wk.plannedKm.toLocaleString('nl-BE')} km gepland</span></div>
              <ul class="list" style="border-top:1px solid var(--line)">${ws.map((w) => workoutRow(w, done.has(w.date))).join('')}</ul>
            </section>`;
        })
        .join('');

      return `
        <p class="section-label">Deze week</p>
        <section class="card">
          <div class="card__eyebrow">Week ${current.week} van ${plan.weeks.length} <span class="badge badge--accent">${esc(phase.label)}${current.recovery ? ' · herstel' : ''}</span></div>
          <div class="week" style="margin-top:12px">${strip}</div>
          <div class="phase-bar">${phaseBar}</div>
          <p class="card__text">${esc(current.recovery ? 'Herstelweek: minder volume, zodat je lichaam de training van de vorige weken kan verwerken.' : phase.text)}</p>
        </section>
        ${weekCards}`;
    },
  },

  training: {
    title: 'Training',
    tab: 'schema',
    html({ workouts, runs, sync }) {
      const id = location.hash.split('/')[2];
      const w = workouts.find((x) => x.id === id);
      if (!w) return `<section class="card empty"><h2 class="empty__title">Training niet gevonden</h2><a class="btn" href="#/schema">Naar je schema</a></section>`;
      const done = runDates(runs).has(w.date);
      return `
        <a class="btn btn--ghost" href="#/schema" style="justify-content:flex-start;padding:0 4px;width:auto">‹ Schema</a>
        <p class="section-label">${esc(dayLabel(w.date))}</p>
        ${workoutCard(w, { done, connected: isConnected(sync) })}
        ${whyCard(w)}`;
    },
  },

  uitleg: {
    title: 'Uitleg',
    tab: 'uitleg',
    html({ profile, plan, workouts }) {
      if (!profile || !plan) return noGoal();
      const today = isoDate(new Date());
      const upcoming = workouts.filter((w) => w.date >= today).slice(0, 6);
      const lvl = CHALLENGE_LEVELS[plan.challenge ?? DEFAULT_CHALLENGE];
      return `
        <section class="card">
          <div class="card__eyebrow">Waarom je schema zo is opgebouwd</div>
          <p class="card__text">Pace volgt 4 fases: basis, opbouw, specifiek en taper. Elke 4de week is een herstelweek. Je weekvolume stijgt hoogstens 10% per week en er komen nooit 2 zware dagen na elkaar. Je tempo's komen uit je fitheid (VDOT ${plan.startVdot.toFixed(1).replace('.', ',')}) en worden elke week een beetje sneller.</p>
          <p class="card__text">Uitdagingsniveau: <strong>${esc(lvl.label)}</strong>. ${esc(lvl.text)} <a href="#/doel">Aanpassen</a></p>
        </section>
        ${upcoming.map((w) => whyCard(w, { withTitle: true })).join('')}
        <p class="field__hint" style="text-align:center">Tik op een training in Schema voor de uitleg van elke andere week.</p>`;
    },
  },

  voortgang: {
    title: 'Voortgang',
    tab: 'voortgang',
    html({ analysis, runs }) {
      const predicted = analysis?.predictedNowS ? formatRaceTime(analysis.predictedNowS) : '–';
      const monday = new Date();
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const weekKm = runs
        .filter((r) => r.distanceM && new Date(`${r.date}T12:00:00`) >= monday)
        .reduce((sum, r) => sum + r.distanceM / 1000, 0);
      const weekKmText = runs.length ? weekKm.toLocaleString('nl-BE', { maximumFractionDigits: 1 }) : '–';
      return `
        <section class="card">
          <div class="card__eyebrow">Richting je doel</div>
          <div class="stats">
            <div><div class="stat__value">${predicted}</div><div class="stat__label">Geschatte eindtijd</div></div>
            <div><div class="stat__value">${weekKmText}</div><div class="stat__label">Km deze week</div></div>
            <div><div class="stat__value">–</div><div class="stat__label">Consistentie</div></div>
          </div>
        </section>
        ${runs.length ? '' : `<section class="card empty">
          ${ICON_CHART}
          <h2 class="empty__title">Nog geen lopen</h2>
          <p class="empty__text">Na je eerste loop zie je hier je volume en geschatte eindtijd.</p>
        </section>`}
        ${runs.length ? `<p class="section-label">Laatste lopen</p><section class="card card--flush"><ul class="list">${[...runs]
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .slice(0, 5)
          .map(runListRow)
          .join('')}</ul></section>` : ''}`;
    },
  },

  profiel: {
    title: 'Profiel',
    tab: 'profiel',
    html({ profile, analysis, sync }) {
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
              <li class="list__row"><span>Uitdaging</span><span class="list__value">${esc(CHALLENGE_LEVELS[profile.challenge ?? DEFAULT_CHALLENGE].label)}</span></li>
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
        <p class="section-label">Horloge</p>
        <section class="card card--flush">
          <ul class="list">
            <li class="list__row"><a href="#/koppeling" style="color:inherit;display:flex;justify-content:space-between;width:100%">
              <span>Garmin Venu 3</span><span class="list__value">${sync.provider === 'intervals' && sync.apiKey ? 'Verbonden ›' : 'Koppelen ›'}</span></a></li>
          </ul>
        </section>
        <p class="section-label">App</p>
        <section class="card card--flush">
          <ul class="list">
            <li class="list__row"><span>Weergave</span><span class="list__value">${mode} (volgt iPhone)</span></li>
            <li class="list__row"><span>Geïnstalleerd</span><span class="list__value">${isStandalone() ? 'Ja' : 'Nee, open in Safari'}</span></li>
            <li class="list__row"><span>Gegevens</span><span class="list__value">Alleen op dit toestel</span></li>
            <li class="list__row"><span>Versie</span><span class="list__value">${esc(self.PACE_VERSION)}</span></li>
          </ul>
        </section>
        <button class="btn btn--secondary" type="button" id="check-update">Zoek naar update</button>`;
    },
    mount(root) {
      root.querySelector('#check-update')?.addEventListener('click', () => window.dispatchEvent(new Event('pace:check-update')));
    },
  },

  doel: setupView,
  koppeling: connectView,
  invoer: entryView,
  resultaat: resultView,
};
