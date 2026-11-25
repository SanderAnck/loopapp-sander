// Plan service: (re)generates the schedule from the profile, stores it,
// and keeps the next 14 days on the watch through the active SyncProvider.

import { db } from './db.js';
import { generatePlan, PLANNER_VERSION } from './coach/planner.js';
import { goalDistanceM, levelDistanceM, isoDate } from './profile.js';
import { activeProvider, loadSyncSettings, saveSyncSettings } from './sync/provider.js';

const WATCH_WINDOW_DAYS = 14;

export async function loadPlan() {
  const [plan, workouts] = await Promise.all([db.get('plan', 'current'), db.getAll('workouts')]);
  workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { plan: plan || null, workouts };
}

/**
 * Build a new plan from the profile. Workouts before today are kept as they
 * were (history); everything from today on is replaced by the new plan.
 */
export async function regeneratePlan(profile) {
  const today = isoDate(new Date());
  const { plan, workouts } = generatePlan(profile, {
    today: new Date(),
    goalDistanceM: goalDistanceM(profile),
    levelDistanceM: levelDistanceM(profile),
  });
  const existing = await db.getAll('workouts');
  const removed = [];
  const finishedDates = new Set();
  for (const w of existing) {
    if (w.date < today || w.keep) continue;
    if (['done', 'partial', 'aborted'].includes(w.status)) {
      finishedDates.add(w.date); // keep what was already run today
      continue;
    }
    await db.delete('workouts', w.id);
    if (w.pushedAt) removed.push(w.id);
  }
  for (const w of workouts) if (!finishedDates.has(w.date)) await db.put('workouts', w);
  await db.put('plan', plan);

  // Workouts that were on the watch but are no longer in the plan.
  const keep = new Set(workouts.map((w) => w.id));
  const stale = removed.filter((id) => !keep.has(id));
  return { plan, workouts, stale };
}

/** Put the next 14 days on the watch and remove workouts that were dropped. */
export async function pushUpcoming({ stale = [] } = {}) {
  const provider = await activeProvider();
  if (!provider.canPushWorkouts) return { ok: true, count: 0, skipped: true };
  const today = new Date();
  const until = new Date();
  until.setDate(until.getDate() + WATCH_WINDOW_DAYS);
  const from = isoDate(today);
  const to = isoDate(until);
  const { workouts } = await loadPlan();
  const upcoming = workouts.filter((w) => w.date >= from && w.date <= to && w.status === 'planned');
  if (stale.length) await provider.deleteWorkouts(stale);
  const result = await provider.pushWorkouts(upcoming);
  const now = new Date().toISOString();
  for (const w of upcoming) await db.put('workouts', { ...w, pushedAt: now });
  const s = await loadSyncSettings();
  await saveSyncSettings({ ...s, lastPushAt: now });
  return result;
}

/** Make sure a plan exists and the watch window is fresh (at most once per 6 hours). */
export async function ensurePlanAndWatch(profile) {
  if (!profile) return false;
  const plan = await db.get('plan', 'current');
  let changed = false;
  let stale = [];
  if (!plan || plan.profileUpdatedAt !== profile.updatedAt || plan.plannerVersion !== PLANNER_VERSION) {
    ({ stale } = await regeneratePlan(profile));
    changed = true;
  }
  const s = await loadSyncSettings();
  const due = !s.lastPushAt || Date.now() - new Date(s.lastPushAt) > 6 * 3600 * 1000;
  if (s.provider === 'intervals' && s.apiKey && (changed || due)) {
    try {
      await pushUpcoming({ stale });
    } catch (err) {
      console.warn('Push failed', err);
    }
  }
  return changed;
}
