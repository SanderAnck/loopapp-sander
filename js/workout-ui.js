// Rendering of planned workouts: cards, step lists, week rows.

import { esc, formatPace } from './ui.js';
import { formatRaceTime } from './profile.js';
import { PHASES, HARD_TYPES } from './coach/planner.js';
import { zoneForPace } from './coach/hr.js';

// Current pace zones and heart rate zones, set by the app on every render,
// so each step can show its heart rate range next to the pace.
let zoneCtx = null;
export function setZoneContext(ctx) {
  zoneCtx = ctx;
}

function hrHint(pace) {
  if (!zoneCtx?.hrz) return '';
  const z = zoneCtx.hrz.zones[zoneForPace(pace, zoneCtx.paceZones)];
  return z ? `<span class="step__hr">♥ ${z.low}–${z.high}</span>` : '';
}

const paceRange = ([fast, slow]) =>
  Math.round(fast) === Math.round(slow) ? formatPace(fast) : `${formatPace(slow)}–${formatPace(fast)}`;

function amount(s) {
  if (s.distanceM) {
    const km = s.distanceM / 1000;
    return km >= 1 ? `${km.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km` : `${s.distanceM} m`;
  }
  const m = Math.floor(s.durationS / 60);
  const sec = s.durationS % 60;
  return m ? `${m}${sec ? `:${String(sec).padStart(2, '0')}` : ''} min` : `${sec} s`;
}

const STEP_NAMES = { warmup: 'Opwarming', cooldown: 'Cooling down', recovery: 'Rustig', work: 'Blok' };

/** One row per step; a repeat becomes "3 × 8 min Drempel" with its recovery as subtext. */
export function stepList(workout) {
  const rows = workout.steps.map((s) => {
    if (s.kind === 'repeat') {
      const work = s.steps.find((x) => x.kind === 'work') || s.steps[0];
      const rec = s.steps.find((x) => x !== work);
      return `<li class="step step--work"><span class="step__bar"></span>
        <span><span class="step__name">${s.reps} × ${esc(amount(work))} ${esc(work.label || '')}</span><br>
        <span class="step__meta">${rec ? `${esc(amount(rec))} ${esc((rec.label || 'rustig').toLowerCase())} ertussen` : ''}</span></span>
        <span class="step__pace">${paceRange(work.pace)}<span class="stat__unit">/km</span>${hrHint(work.pace)}</span></li>`;
    }
    const hard = s.kind === 'work' && /tempo|wedstrijd|drempel|interval/i.test(s.label || '');
    return `<li class="step ${hard ? 'step--work' : ''}"><span class="step__bar"></span>
      <span><span class="step__name">${esc(s.label || STEP_NAMES[s.kind])}</span><br><span class="step__meta">${esc(amount(s))}</span></span>
      <span class="step__pace">${paceRange(s.pace)}<span class="stat__unit">/km</span>${hrHint(s.pace)}</span></li>`;
  });
  return `<ul class="steps">${rows.join('')}</ul>`;
}

/** Status badge: done, on the watch, or planned. */
export function statusBadge(workout, { done, connected }) {
  if (done || workout.status === 'done') return '<span class="badge badge--good">✓ Gedaan</span>';
  if (workout.status === 'cancelled') return '<span class="badge">Rustdag (coach)</span>';
  if (workout.status === 'missed') return '<span class="badge">Gemist</span>';
  if (workout.rescheduled && workout.status === 'planned') return '<span class="badge badge--accent">Ingehaald</span>';
  if (connected && workout.pushedAt) return '<span class="badge badge--accent">⌚ Staat op horloge</span>';
  return '';
}

export function workoutCard(workout, { done, connected, heading, actions = '' }) {
  return `
    <section class="card">
      <div class="card__eyebrow">${esc(heading || PHASES[workout.phase].label + ' · week ' + workout.week)} ${statusBadge(workout, { done, connected })}</div>
      <h2 class="card__title">${esc(workout.name)}</h2>
      <div class="stats">
        <div><div class="stat__value">${workout.km.toLocaleString('nl-BE', { maximumFractionDigits: 1 })}<span class="stat__unit">km</span></div><div class="stat__label">Afstand (ca.)</div></div>
        <div><div class="stat__value">${Math.round(workout.durationS / 60)}<span class="stat__unit">min</span></div><div class="stat__label">Duur (ca.)</div></div>
        <div><div class="stat__value">${HARD_TYPES.has(workout.type) && workout.type !== 'long' ? 'Stevig' : 'Rustig'}</div><div class="stat__label">Intensiteit</div></div>
      </div>
      ${stepList(workout)}
      ${workout.note ? `<p class="card__text" style="margin-top:12px">${esc(workout.note)}</p>` : ''}
      ${workout.adjusted ? `<div class="note note--ambitious" style="margin-top:12px"><strong>Aangepast door de coach</strong>${esc(workout.adjusted.reason)}</div>` : ''}
      ${actions}
      ${heading && workout.why ? `<a class="btn btn--ghost" href="#/training/${esc(workout.id)}">Waarom deze training? ›</a>` : ''}
    </section>`;
}

export function dayLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Vandaag';
  if (d.toDateString() === tomorrow.toDateString()) return 'Morgen';
  return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
}

const STATUS_TEXT = { done: '✓ ', partial: '◐ ', aborted: '✕ ', skipped: 'overgeslagen · ', missed: 'gemist · ', cancelled: 'rust (coach) · ' };

export function workoutRow(w, done) {
  const d = new Date(`${w.date}T12:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  return `<li><a class="list__row" href="#/training/${esc(w.id)}" style="color:inherit">
    <span>${esc(w.name)}<br><span class="field__hint">${esc(d)}</span></span>
    <span class="list__value">${STATUS_TEXT[w.status] || (done ? '✓ ' : '')}${w.adjusted && w.status === 'planned' ? 'aangepast · ' : ''}${w.km.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km · ${Math.round(w.durationS / 60)} min ›</span></a></li>`;
}

/** "Why this workout": its purpose, the reasons for this choice now, and how it should feel. */
export function whyCard(w, { withTitle = false } = {}) {
  if (!w.why) return '';
  const reasons = w.why.reasons.map((r) => `<li>${esc(r)}</li>`).join('');
  return `
    <section class="card">
      ${withTitle
        ? `<a href="#/training/${esc(w.id)}" style="color:inherit"><div class="card__eyebrow">${esc(dayLabel(w.date))} · ${esc(PHASES[w.phase].label)}</div>
           <h2 class="card__title">${esc(w.name)} <span class="stat__unit">${w.km.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km ›</span></h2></a>`
        : '<div class="card__eyebrow">Waarom deze training</div>'}
      <p class="why__label">Doel</p>
      <p class="why__text">${esc(w.why.goal)}</p>
      <p class="why__label">Waarom nu</p>
      <ul class="why__list">${reasons}</ul>
      <p class="why__label">Hoe het moet voelen</p>
      <p class="why__text">${esc(w.why.feel)}</p>
    </section>`;
}

export { formatRaceTime };
