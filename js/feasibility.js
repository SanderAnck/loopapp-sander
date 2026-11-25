// "Is my goal feasible?" card: how much faster you need to get, how that
// compares to a healthy rate of progress, what would make it easier, and
// how consistent the training has been so far.

import { esc, formatPace, FEASIBILITY_TEXT } from './ui.js';
import { formatRaceTime, goalDistanceM, isoDate } from './profile.js';
import { goalFeasibility, predictRaceTime, weeklyCapacity } from './coach/vdot.js';

const FINISHED = ['done', 'partial', 'aborted'];
const pct = (x) => `${Math.round(x * 100)}%`;

/** Consistency: finished workouts out of the planned ones until yesterday. */
export function consistency(workouts) {
  const today = isoDate(new Date());
  const past = workouts.filter((w) => w.date < today && !w.test && w.status !== 'cancelled');
  if (!past.length) return null;
  const done = past.filter((w) => FINISHED.includes(w.status)).length;
  return { done, total: past.length, ratio: done / past.length };
}

/** Options that would turn an ambitious goal into a realistic one. */
function easierOptions(profile, analysis) {
  const f = analysis.feasibility;
  const days = profile.availability.daysPerWeek;
  const out = [];
  const target = 0.75; // the "realistic" border
  const weeksNeeded = Math.ceil(f.gain / (f.capacity * target));
  if (weeksNeeded > analysis.weeks) out.push(`een doeldatum ${weeksNeeded - analysis.weeks} ${weeksNeeded - analysis.weeks === 1 ? 'week' : 'weken'} later`);
  if (days < 4) {
    const more = goalFeasibility({ currentVdot: analysis.currentVdot, goalVdot: analysis.goalVdot, weeks: analysis.weeks, daysPerWeek: days + 1 });
    if (more.level !== f.level) out.push(`${days + 1} trainingsdagen per week (dan: ${FEASIBILITY_TEXT[more.level][0].toLowerCase()})`);
  }
  const reachable = analysis.currentVdot + f.capacity * target * analysis.weeks;
  const time = predictRaceTime(reachable, goalDistanceM(profile));
  if (time > profile.goal.targetTimeS) out.push(`een doeltijd van ongeveer ${formatRaceTime(Math.ceil(time / 15) * 15)}`);
  return out;
}

export function feasibilityCard(profile, analysis, workouts = [], { compact = false } = {}) {
  if (!profile || !analysis) return '';
  const c = consistency(workouts);
  const consistencyHtml = c
    ? `<p class="card__text">Trainingen gedaan tot nu: <strong>${c.done} van ${c.total}</strong> (${pct(c.ratio)}).${
        c.ratio < 0.75 ? ' Onder 75% wordt je doel moeilijker: regelmaat telt meer dan hard trainen.' : ' Goed bezig, zo blijf je op schema.'
      }</p>`
    : '';

  if (!analysis.feasibility) {
    return `<section class="card"><div class="card__eyebrow">Haalbaarheid</div>
      <div class="note note--realistic"><strong>Afstand uitlopen</strong>Je doel is de afstand uitlopen. Met ${analysis.weeks} weken opbouw is dat haalbaar.</div>${consistencyHtml}</section>`;
  }
  const f = analysis.feasibility;
  const [title, text] = FEASIBILITY_TEXT[f.level];
  const now = analysis.predictedNowS;
  const goal = profile.goal.targetTimeS;
  const km = goalDistanceM(profile) / 1000;
  const faster = Math.max(0, now - goal);
  const perKm = faster / km;

  // Meter: 0 = no progress needed, 1 = the healthy maximum, up to 1.5 shown.
  const fill = Math.min(1, f.ratio / 1.5);
  const meter = `
    <div class="meter" role="img" aria-label="${esc(title)}">
      <div class="meter__track"><div class="meter__fill meter__fill--${f.level}" style="width:${Math.max(4, fill * 100)}%"></div></div>
      <div class="meter__labels"><span>Haalbaar</span><span>Ambitieus</span><span>Erg ambitieus</span></div>
    </div>`;

  if (compact) {
    return `<section class="card">
      <div class="card__eyebrow">Haalbaarheid <span class="badge badge--${f.level}">${esc(title)}</span></div>
      ${meter}
      <a class="btn btn--ghost" href="#/voortgang">Meer over je kansen ›</a></section>`;
  }

  const options = f.level === 'very-ambitious' || f.level === 'ambitious' ? easierOptions(profile, analysis) : [];
  const optionsHtml = options.length
    ? `<p class="card__text"><strong>Wat het makkelijker maakt:</strong></p><ul class="why__list">${options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
       <a class="btn btn--secondary" href="#/doel" style="margin-top:12px">Doel aanpassen</a>`
    : '';

  return `
    <section class="card">
      <div class="card__eyebrow">Haalbaarheid <span class="badge badge--${f.level}">${esc(title)}</span></div>
      <div class="stats">
        <div><div class="stat__value">${formatRaceTime(now)}</div><div class="stat__label">Nu voorspeld</div></div>
        <div><div class="stat__value">${formatRaceTime(goal)}</div><div class="stat__label">Doel</div></div>
        <div><div class="stat__value">${faster ? `−${Math.round(perKm)}` : '0'}<span class="stat__unit">s/km</span></div><div class="stat__label">Nog te winnen</div></div>
      </div>
      ${meter}
      <p class="card__text">${esc(text)}</p>
      <p class="card__text">${
        faster
          ? `Je moet ${formatRaceTime(faster)} sneller worden (van ${formatPace(now / km)} naar ${formatPace(goal / km)} per km) in ${analysis.weeks} weken. Dat vraagt ${pct(f.ratio)} van wat met ${profile.availability.daysPerWeek} trainingsdagen per week gezond haalbaar is.`
          : 'Je huidige niveau haalt je doeltijd al.'
      }</p>
      ${optionsHtml}
      ${consistencyHtml}
      <p class="field__hint">De voorspelling komt uit je startniveau en de lopen die je invult of die van je horloge binnenkomen. Ze wordt na elke loop bijgewerkt.</p>
    </section>`;
}
