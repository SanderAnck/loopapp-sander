// Glue between stored data and the fitness model: computes current fitness
// for the screens and applies pace corrections to the plan when needed.

import { db } from './db.js';
import { isoDate, levelDistanceM } from './profile.js';
import { vdotFromRace } from './coach/vdot.js';
import { estimateFitness, paceCorrection } from './coach/fitness.js';
import { shiftPaces } from './coach/adapt.js';
import { loadHr, hrZones } from './coach/hr.js';
import { pushUpcoming } from './plan.js';

const FITNESS_KEY = 'fitness';

export function computeFitness({ profile, plan, runs, checkins, hrz }) {
  if (!profile) return null;
  const baseline = vdotFromRace(levelDistanceM(profile), profile.level.timeS);
  return estimateFitness({ profile, plan, runs, checkins, hrz, baseline, today: isoDate(new Date()) });
}

/**
 * Shift future planned paces when fitness clearly differs from the plan.
 * Returns the applied shift in s/km (0 when nothing changed).
 */
export async function applyFitnessCorrection() {
  const [profile, plan, runs, checkins, hr, state] = await Promise.all([
    db.get('profile', 'me'),
    db.get('plan', 'current'),
    db.getAll('runs'),
    db.getAll('checkins'),
    loadHr(),
    db.get('profile', FITNESS_KEY),
  ]);
  if (!profile || !plan) return 0;
  const fitness = computeFitness({ profile, plan, runs, checkins, hrz: hrZones(hr) });
  const applied = state?.appliedDelta || 0;
  const shift = paceCorrection(fitness, applied);
  if (!shift) return 0;
  const today = isoDate(new Date());
  for (const w of await db.getAll('workouts')) {
    if (w.date > today && w.status === 'planned' && !w.test) await db.put('workouts', shiftPaces(w, shift));
  }
  // Written directly (no updatedAt change) so the plan is not rebuilt.
  await db.put('profile', { ...profile, paceOffsetS: (profile.paceOffsetS || 0) + shift });
  const delta = fitness.vdot - fitness.expected;
  await db.put('profile', {
    id: FITNESS_KEY,
    appliedDelta: delta,
    lastShiftS: shift,
    at: new Date().toISOString(),
    history: [...(state?.history || []), { date: today, shiftS: shift, vdot: fitness.vdot, expected: fitness.expected }].slice(-20),
  });
  try {
    await pushUpcoming();
  } catch (err) {
    console.warn('Push after fitness correction failed', err);
  }
  return shift;
}

export async function loadFitnessState() {
  return (await db.get('profile', FITNESS_KEY)) || null;
}
