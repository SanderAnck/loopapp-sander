// One-off test workout so the run form can be tried on 25 November 2026.
// It only appears on that day, only once, and is removed again by a plan
// rebuild like any other planned workout. Safe to delete this file later.

import { db } from './db.js';
import { isoDate } from './profile.js';
import { estimateKm } from './coach/planner.js';
import { totalDurationS } from './sync/workout-text.js';

const TEST_DATE = '2026-11-25';
const FLAG_ID = `seed-${TEST_DATE}`;

export async function seedTestWorkout(plan) {
  if (isoDate(new Date()) !== TEST_DATE || !plan) return false;
  if (await db.get('profile', FLAG_ID)) return false;
  const week = plan?.weeks?.find((wk) => wk.start <= TEST_DATE)?.week ?? 1;
  const workout = {
    id: `testform-${TEST_DATE}`,
    date: TEST_DATE,
    week,
    phase: 'base',
    type: 'fartlek',
    name: 'Testtraining',
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
    note: 'Korte testtraining om het invulformulier en de bijsturing van de coach uit te proberen.',
    why: {
      goal: 'Het formulier na een loop testen.',
      feel: 'Rustig, met drie korte versnellingen.',
      reasons: ['Deze training staat er alleen vandaag, om de app te testen.'],
    },
    status: 'planned',
    keep: true, // survives a plan rebuild
    test: true, // coach shows its decisions but does not change the plan
  };
  workout.km = estimateKm(workout);
  workout.durationS = totalDurationS(workout);
  await db.put('workouts', workout);
  await db.put('profile', { id: FLAG_ID, at: new Date().toISOString() });
  return true;
}
