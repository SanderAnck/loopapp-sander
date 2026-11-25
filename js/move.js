// Moving a planned workout to another day, with the coach's checks:
// never two workouts on one day, warn for two hard days in a row
// (knee-friendly), and keep the watch calendar in step.

import { db } from './db.js';
import { isoDate } from './profile.js';
import { HARD_TYPES } from './coach/planner.js';
import { pushUpcoming } from './plan.js';
import { esc, showToast } from './ui.js';

const MOVE_WINDOW_DAYS = 14;
const ACTIVE = (w) => !['cancelled', 'skipped'].includes(w.status);
const isHard = (w) => HARD_TYPES.has(w.type);

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

export const canMove = (w, today = isoDate(new Date())) => w.status === 'planned' && w.type !== 'race' && w.date >= today;

/** Days the workout can go to, each with a status: ok, warn (with reason) or blocked. */
export function moveOptions(workout, workouts, plan, today = isoDate(new Date())) {
  const others = workouts.filter((w) => w.id !== workout.id && ACTIVE(w));
  const on = (date) => others.filter((w) => w.date === date);
  const race = workouts.find((w) => w.type === 'race');
  const last = race ? addDays(race.date, -1) : plan?.goalDate || addDays(today, MOVE_WINDOW_DAYS);
  const weekOf = (date) => plan?.weeks?.filter((wk) => wk.start <= date).pop()?.week ?? workout.week;
  const options = [];
  for (let i = 0; i <= MOVE_WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    if (date > last) break;
    if (date === workout.date) continue;
    const opt = { date, status: 'ok', reason: '', week: weekOf(date) };
    const neighbours = [...on(addDays(date, -1)), ...on(addDays(date, 1))];
    if (on(date).length) {
      opt.status = 'blocked';
      opt.reason = 'Er staat al een training.';
    } else if (isHard(workout) && neighbours.some(isHard)) {
      opt.status = 'warn';
      opt.reason = 'Twee zware dagen na elkaar. Voor je knie liever niet.';
    } else if (neighbours.length) {
      opt.status = 'warn';
      opt.reason = 'Twee dagen na elkaar lopen. Kan, maar houd het dan rustig.';
    } else if (opt.week !== workout.week) {
      opt.status = 'warn';
      opt.reason = 'Andere trainingsweek: die week wordt iets zwaarder.';
    }
    options.push(opt);
  }
  return options;
}

export async function moveWorkout(workout, option) {
  const moved = {
    ...workout,
    date: option.date,
    week: option.week,
    movedFrom: workout.movedFrom || workout.date,
  };
  await db.put('workouts', moved);
  // Remove the old calendar entry first, then push the next 14 days again.
  try {
    await pushUpcoming({ stale: workout.pushedAt ? [workout.id] : [] });
  } catch (err) {
    console.warn('Push after move failed', err);
    showToast('Verplaatst, maar je horloge kon niet bijgewerkt worden. Dat gebeurt later vanzelf.');
  }
  return moved;
}

const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });

/** The "Verplaatsen" panel: a grid of days, a hint for the chosen day and a confirm button. */
export function movePanelHtml(workout, options) {
  if (!options.length) return '<p class="card__text">Er is geen andere dag vrij voor deze training.</p>';
  const chips = options
    .map(
      (o) => `<button type="button" class="chip move__day move__day--${o.status}" data-move="${o.date}" aria-pressed="false" ${o.status === 'blocked' ? 'disabled' : ''}>
        ${esc(shortDay(o.date))}${o.status === 'warn' ? ' ⚠︎' : ''}</button>`
    )
    .join('');
  return `
    <div class="card__eyebrow">Naar welke dag?</div>
    <div class="chips chips--wrap move">${chips}</div>
    <p class="field__hint" id="move-hint">Kies een dag. Dagen met ⚠︎ kunnen, maar zijn minder ideaal.</p>
    <button class="btn" type="button" id="move-confirm" disabled style="margin-top:12px">Verplaatsen</button>`;
}

/** Wire the panel inside `root`; calls onDone(movedWorkout) after a move. */
export function mountMovePanel(root, workout, options, onDone) {
  let chosen = null;
  root.addEventListener('click', async (e) => {
    const day = e.target.closest('[data-move]');
    if (day) {
      chosen = options.find((o) => o.date === day.dataset.move);
      for (const b of root.querySelectorAll('[data-move]')) b.setAttribute('aria-pressed', String(b === day));
      const hint = root.querySelector('#move-hint');
      hint.textContent = chosen.reason || 'Goede keuze: genoeg rust rond deze dag.';
      const btn = root.querySelector('#move-confirm');
      btn.disabled = false;
      btn.textContent = `Verplaatsen naar ${shortDay(chosen.date)}`;
      return;
    }
    const confirm = e.target.closest('#move-confirm');
    if (confirm && chosen) {
      confirm.disabled = true;
      confirm.textContent = 'Verplaatsen…';
      const moved = await moveWorkout(workout, chosen);
      showToast(`${workout.name} staat nu op ${shortDay(moved.date)}.`);
      onDone(moved);
    }
  });
}
