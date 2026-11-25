// Missed workouts: a key workout (quality or long run) missed earlier this
// training week moves to a free, sensible day in the same week; anything
// else is let go. Never two workouts on one day, never two hard days in a row,
// and the week's volume stays as planned.

import { db } from '../db.js';
import { isoDate } from '../profile.js';
import { moveOptions } from '../move.js';
import { pushUpcoming } from '../plan.js';

const KEY_TYPES = new Set(['long', 'threshold', 'intervals', 'racepace', 'fartlek', 'hills']);

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

/** Planned workouts before today without a run on that day. */
export function findMissed(workouts, runs, today = isoDate(new Date())) {
  const ran = new Set(runs.filter((r) => !r.test).map((r) => r.date));
  return workouts.filter((w) => w.status === 'planned' && !w.test && w.date < today && !ran.has(w.date));
}

/**
 * Handle missed workouts once (after the watch had a chance to sync).
 * Returns [{workout, action: 'moved'|'dropped', to?}] for the week review.
 */
export async function handleMissed({ workouts, runs, plan, ids = null, minAgeDays = 2 }) {
  const today = isoDate(new Date());
  const missed = findMissed(workouts, runs, today).filter((w) => (ids ? ids.includes(w.id) : w.date <= addDays(today, -minAgeDays)));
  if (!missed.length || !plan) return [];
  const results = [];
  let current = [...workouts];
  let movedThisWeek = workouts.some((w) => w.rescheduled && w.date >= addDays(today, -6));
  for (const w of missed.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const week = plan.weeks.find((wk) => wk.start <= w.date && w.date < addDays(wk.start, 7));
    const weekEnd = week ? addDays(week.start, 7) : today;
    let action = 'dropped';
    let to = null;
    if (KEY_TYPES.has(w.type) && !movedThisWeek) {
      // Only days left in the same training week; a free "ok" day first, otherwise no move.
      const opts = moveOptions({ ...w, date: '0000-00-00' }, current, plan, today).filter((o) => o.date < weekEnd);
      const pick = opts.find((o) => o.status === 'ok');
      if (pick) {
        to = pick.date;
        action = 'moved';
      }
    }
    const note = { at: new Date().toISOString(), from: w.date };
    if (action === 'moved') {
      const moved = { ...w, date: to, movedFrom: w.movedFrom || w.date, rescheduled: note };
      await db.put('workouts', moved);
      current = current.map((x) => (x.id === w.id ? moved : x));
      movedThisWeek = true;
    } else {
      await db.put('workouts', { ...w, status: 'missed', missed: note });
      current = current.map((x) => (x.id === w.id ? { ...x, status: 'missed' } : x));
    }
    results.push({ workout: w, action, to });
  }
  if (results.some((r) => r.action === 'moved')) {
    try {
      await pushUpcoming({ stale: results.filter((r) => r.action === 'moved' && r.workout.pushedAt).map((r) => r.workout.id) });
    } catch (err) {
      console.warn('Push after reschedule failed', err);
    }
  }
  // Remember for the week review.
  const log = (await db.get('profile', 'missed-log')) || { id: 'missed-log', items: [] };
  log.items = [...log.items, ...results.map((r) => ({ id: r.workout.id, name: r.workout.name, from: r.workout.date, action: r.action, to: r.to, at: today }))].slice(-40);
  await db.put('profile', log);
  return results;
}
