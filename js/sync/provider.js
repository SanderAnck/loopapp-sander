// SyncProvider: the single seam between Pace and the outside world.
//
// Every provider implements the same shape, so a direct Garmin connection
// could be plugged in later without touching the coach or the screens:
//
//   id: string
//   label: string
//   canPushWorkouts: boolean          // can planned workouts reach the watch?
//   canFetchActivities: boolean       // can finished runs come in automatically?
//   async testConnection()            -> { ok, athleteName?, message? }
//   async pushWorkouts(workouts)      -> { ok, count, message? }
//   async deleteWorkouts(workoutIds)  -> { ok, count }
//   async fetchActivities(oldestIso, newestIso) -> Run[] (see js/sync/intervals.js)
//
// The manual provider is always available as the fallback: runs are typed
// in by the user and nothing leaves the device.

import { db } from '../db.js';
import { IntervalsProvider } from './intervals.js';

export const SYNC_KEY = 'sync'; // record id in the `profile` store

export const ManualProvider = {
  id: 'manual',
  label: 'Handmatig',
  canPushWorkouts: false,
  canFetchActivities: false,
  async testConnection() {
    return { ok: true };
  },
  async pushWorkouts() {
    return { ok: true, count: 0 };
  },
  async deleteWorkouts() {
    return { ok: true, count: 0 };
  },
  async fetchActivities() {
    return [];
  },
};

export async function loadSyncSettings() {
  return (await db.get('profile', SYNC_KEY)) || { id: SYNC_KEY, provider: 'manual', apiKey: '', lastSyncAt: null };
}

export async function saveSyncSettings(settings) {
  await db.put('profile', { ...settings, id: SYNC_KEY });
}

/** The provider that is active right now, based on the stored settings. */
export async function activeProvider() {
  const s = await loadSyncSettings();
  if (s.provider === 'intervals' && s.apiKey) return new IntervalsProvider(s.apiKey);
  return ManualProvider;
}

/**
 * Pull recent runs from the active provider into the `runs` store.
 * Existing runs with the same id are updated; manual entries are untouched.
 * Returns the number of runs stored.
 */
export async function syncActivities({ days = 21 } = {}) {
  const provider = await activeProvider();
  if (!provider.canFetchActivities) return 0;
  const newest = new Date();
  const oldest = new Date();
  oldest.setDate(oldest.getDate() - days);
  const iso = (d) => d.toISOString().slice(0, 10);
  const runs = await provider.fetchActivities(iso(oldest), iso(newest));
  for (const run of runs) {
    const existing = await db.get('runs', run.id);
    // Keep anything the user added by hand (for example tempo per block).
    await db.put('runs', existing ? { ...run, ...pickManual(existing) } : run);
  }
  const s = await loadSyncSettings();
  await saveSyncSettings({ ...s, lastSyncAt: new Date().toISOString() });
  return runs.length;
}

function pickManual(run) {
  const keep = {};
  for (const k of ['blocks', 'completion', 'workoutId', 'manualEdits']) if (run[k] !== undefined) keep[k] = run[k];
  return keep;
}
