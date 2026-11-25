// Weekly review (#/week): what you did, what the coach changed, how your
// fitness moved, what happened with missed workouts, and next week.

import { db } from './db.js';
import { esc, formatPace } from './ui.js';
import { isoDate, formatRaceTime, goalDistanceM } from './profile.js';
import { PHASES } from './coach/planner.js';
import { fitnessOn } from './coach/fitness.js';
import { predictRaceTime } from './coach/vdot.js';
import { workoutRow, dayLabel } from './workout-ui.js';
import { loadBackupInfo, backupDue } from './backup.js';

const REVIEW_KEY = 'review';
const FINISHED = ['done', 'partial', 'aborted'];

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
const km1 = (x) => x.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });

/** The most recent finished plan week, or the current one when none finished yet. */
export function reviewWeek(plan, today = isoDate(new Date())) {
  if (!plan) return null;
  const ended = plan.weeks.filter((wk) => addDays(wk.start, 7) <= today);
  if (ended.length) return { week: ended[ended.length - 1], finished: true };
  const cur = plan.weeks.find((wk) => wk.start <= today && today < addDays(wk.start, 7)) || plan.weeks[0];
  return { week: cur, finished: false };
}

/** Show the review card on Vandaag in the 3 days after a week ended, until opened. */
export async function reviewDue(plan) {
  const r = reviewWeek(plan);
  if (!r || !r.finished) return null;
  const today = isoDate(new Date());
  if (addDays(r.week.start, 10) <= today) return null;
  const seen = await db.get('profile', REVIEW_KEY);
  return seen?.seenWeek === r.week.week ? null : r.week;
}

export function reviewCard(week) {
  if (!week) return '';
  return `<section class="card">
    <div class="card__eyebrow"><span class="badge badge--accent">Nieuw</span> Weekoverzicht</div>
    <h2 class="card__title">Week ${week.week} zit erop</h2>
    <p class="card__text">Bekijk wat je deed, wat de coach aanpaste en wat er volgende week komt.</p>
    <a class="btn" href="#/week" style="margin-top:12px">Bekijk je week</a></section>`;
}

export const reviewView = {
  title: 'Weekoverzicht',
  tab: 'voortgang',

  html({ plan }) {
    if (!plan) return '<section class="card empty"><h2 class="empty__title">Nog geen schema</h2><a class="btn" href="#/doel">Doel instellen</a></section>';
    return '<section class="card"><p class="card__text" style="margin-top:0">Laden…</p></section>';
  },

  async mount(root, { profile, plan, workouts, runs: allRuns, checkins, fitness, strength }) {
    if (!plan || !profile) return;
    const { week, finished } = reviewWeek(plan);
    const start = week.start;
    const end = addDays(start, 7);
    const inWeek = (d) => d >= start && d < end;
    const runs = allRuns.filter((r) => !r.test && inWeek(r.date));
    const ws = workouts.filter((w) => !w.test && inWeek(w.date));
    const cs = checkins.filter((c) => !c.test && inWeek(c.date));
    const [adjustments, missedLog, backupInfo] = await Promise.all([db.getAll('adjustments'), db.get('profile', 'missed-log'), loadBackupInfo()]);
    const adj = adjustments.filter((a) => inWeek(a.date) && !a.checkinId?.includes('testform'));
    const missed = (missedLog?.items || []).filter((m) => inWeek(m.from));
    if (finished) await db.put('profile', { id: REVIEW_KEY, seenWeek: week.week, at: new Date().toISOString() });

    const doneKm = runs.reduce((a, r) => a + (r.distanceM || 0) / 1000, 0);
    const todayIso = isoDate(new Date());
    // During the week only count what was due until today.
    const planned = ws.filter((w) => w.status !== 'cancelled' && (finished || w.date <= todayIso));
    const done = planned.filter((w) => FINISHED.includes(w.status));
    const rpes = cs.map((c) => c.rpe).filter(Boolean);
    const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
    const pain = cs.filter((c) => c.pain && c.pain !== 'none');
    const circuit = (strength?.sessions || []).filter((s) => inWeek(s.date)).length;

    // Fitness at the start and end of the week.
    let fitLine = '';
    if (fitness) {
      const opts = { estimates: fitness.estimates, baseline: fitness.baseline, startDate: fitness.startDate };
      const a = fitnessOn(addDays(start, -1), opts).vdot;
      const b = fitnessOn(finished ? addDays(end, -1) : isoDate(new Date()), opts).vdot;
      const dist = goalDistanceM(profile);
      const diff = b - a;
      fitLine = `Fitheid: VDOT ${a.toFixed(1).replace('.', ',')} → <strong>${b.toFixed(1).replace('.', ',')}</strong>${dist ? ` · voorspeld ${formatRaceTime(predictRaceTime(b, dist))}` : ''}${Math.abs(diff) >= 0.05 ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1).replace('.', ',')})` : ''}.`;
    }

    // Verdict in one sentence.
    const ratio = planned.length ? done.length / planned.length : 1;
    let verdict = 'Sterke week: alles gedaan wat gepland was.';
    if (!finished) verdict = planned.length ? `De week loopt nog: ${done.length} van ${planned.length} trainingen tot nu gedaan.` : 'De week loopt nog. Je volledige overzicht komt na de laatste dag.';
    if (!finished) {
      /* keep the in-progress text */
    } else if (pain.some((c) => c.pain === 'clear')) verdict = 'Een week met pijn. De coach hield het rustig: herstel gaat voor.';
    else if (ratio < 0.5) verdict = 'Een drukke week met weinig trainingen. Geen probleem: je schema loopt gewoon door, niet inhalen.';
    else if (ratio < 1) verdict = 'Goede week. Niet alles lukte, maar regelmaat over meerdere weken telt het meest.';
    else if (avgRpe && avgRpe >= 7.5) verdict = 'Alles gedaan, maar het voelde zwaar. Let op je slaap en neem rustige lopen echt rustig.';

    const runRows = runs
      .sort((x, y) => (x.date < y.date ? -1 : 1))
      .map((r) => `<li class="list__row"><span>${esc(shortDay(r.date))}<br><span class="field__hint">${esc(r.name || 'Loop')}</span></span>
        <span class="list__value">${r.distanceM ? `<strong>${km1(r.distanceM / 1000)} km</strong>` : ''}${r.distanceM && r.durationS ? ` · ${formatPace(r.durationS / (r.distanceM / 1000))}/km` : ''}</span></li>`)
      .join('');
    const adjRows = adj.map((a) => `<li>${esc(a.title)}: ${esc(a.reason)}</li>`).join('');
    const missedRows = missed
      .map((m) => `<li>${esc(m.name)} (${esc(shortDay(m.from))}) ${m.action === 'moved' ? `verplaatst naar ${esc(shortDay(m.to))}` : 'vervalt. Niet inhalen, het schema loopt door.'}</li>`)
      .join('');

    const nextWeek = plan.weeks.find((wk) => wk.start === (finished ? end : addDays(start, 7)));
    const nextWs = nextWeek ? workouts.filter((w) => w.date >= nextWeek.start && w.date < addDays(nextWeek.start, 7) && w.status !== 'cancelled') : [];
    const nextHtml = nextWeek
      ? `<p class="section-label">Volgende week · week ${nextWeek.week}, ${esc(PHASES[nextWeek.phase].label.toLowerCase())}${nextWeek.recovery ? ', herstelweek' : ''}</p>
        <section class="card card--flush">
          <div class="list__row" style="border-top:0"><span class="field__hint">${esc(PHASES[nextWeek.phase].text || '')}</span><span class="list__value">${km1(nextWeek.plannedKm)} km</span></div>
          <ul class="list" style="border-top:1px solid var(--line)">${nextWs.map((w) => workoutRow(w, false)).join('')}</ul>
        </section>`
      : '';
    const backupHint = backupDue(backupInfo, allRuns.length > 0)
      ? `<section class="card"><div class="note note--ambitious"><strong>Tijd voor een back-up</strong>Je gegevens staan alleen op deze iPhone. <a href="#/backup">Maak een back-up</a></div></section>`
      : '';

    root.innerHTML = `
      <section class="card">
        <div class="card__eyebrow">Week ${week.week} van ${plan.weeks.length} · ${esc(PHASES[week.phase].label)}${finished ? '' : ' · tot nu'}</div>
        <div class="stats">
          <div><div class="stat__value">${km1(doneKm)}<span class="stat__unit">km</span></div><div class="stat__label">van ${km1(week.plannedKm)} gepland</div></div>
          <div><div class="stat__value">${done.length}/${planned.length}</div><div class="stat__label">Trainingen</div></div>
          <div><div class="stat__value">${avgRpe ? avgRpe.toFixed(1).replace('.', ',') : '–'}</div><div class="stat__label">Gem. zwaarte</div></div>
        </div>
        <p class="card__text">${esc(verdict)}</p>
        ${fitLine ? `<p class="card__text">${fitLine}</p>` : ''}
        <p class="card__text">Kniecircuit: ${circuit} van 2${pain.length ? ` · pijn gemeld bij ${pain.length} ${pain.length === 1 ? 'loop' : 'lopen'}` : ' · geen pijn gemeld'}.</p>
      </section>
      ${runRows ? `<p class="section-label">Je lopen</p><section class="card card--flush"><ul class="list">${runRows}</ul></section>` : ''}
      ${adjRows ? `<p class="section-label">Wat de coach aanpaste</p><section class="card"><ul class="why__list" style="margin-top:0">${adjRows}</ul></section>` : ''}
      ${missedRows ? `<p class="section-label">Gemiste trainingen</p><section class="card"><ul class="why__list" style="margin-top:0">${missedRows}</ul></section>` : ''}
      ${nextHtml}
      ${backupHint}
      <a class="btn" href="#/vandaag">Klaar</a>`;
  },
};
