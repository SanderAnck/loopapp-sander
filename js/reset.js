// Full reset: removes Pace's planned workouts from the Intervals.icu calendar
// (so the watch is clean too), then wipes every local store. Afterwards the
// app opens as on day one.

import { db, STORES } from './db.js';
import { IntervalsProvider } from './sync/intervals.js';
import { isoDate } from './profile.js';

// One-time reset requested on 25 November 2026 to clear all test data.
const ONE_TIME_ID = 'reset-2026-11-25';
const ONE_TIME_UNTIL = '2026-12-02';

export async function wipeEverything() {
  try {
    const sync = await db.get('profile', 'sync');
    if (sync?.provider === 'intervals' && sync.apiKey) {
      const workouts = await db.getAll('workouts');
      const ids = workouts.filter((w) => w.pushedAt).map((w) => w.id);
      // Test workouts sent from the connection screen.
      for (let i = -14; i <= 1; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        ids.push(`test-${isoDate(d)}`);
      }
      await new IntervalsProvider(sync.apiKey).deleteWorkouts(ids);
    }
  } catch (err) {
    console.warn('Could not clean the watch calendar', err);
  }
  for (const name of Object.keys(STORES)) await db.clear(name);
}

/** Runs once per device, only in the week after the request. */
export async function runOneTimeReset() {
  try {
    if (localStorage.getItem(ONE_TIME_ID) || isoDate(new Date()) > ONE_TIME_UNTIL) return false;
    await wipeEverything();
    localStorage.setItem(ONE_TIME_ID, new Date().toISOString());
    return true;
  } catch (err) {
    console.warn('One-time reset failed', err);
    return false;
  }
}
