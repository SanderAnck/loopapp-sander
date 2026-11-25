// Plan service: (re)generates the schedule from the profile, stores it,
// and keeps the next 14 days on the watch through the active SyncProvider.

import { db } from './db.js';
import { generatePlan, PLANNER_VERSION } from './coach/planner.js';
import { goalDistanceM, levelDistanceM, isoDate } from './profile.js';
import { activeProvider, loadSyncSettings, saveSyncSettings } from './sync/provider.js';

const WATCH_WINDOW_DAYS = 14;

export async function loadPlan() {
  const [plan, all] = await Promise.all([db.get('plan', 'current'), db.getAll('workouts')]);
  // Workouts you removed yourself stay stored (for undo) but are hidden everywhere.
  const workouts = all.filter((w) => w.status !== 'removed');
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
    if (['done', 'partial', 'aborted', 'removed'].includes(w.status)) {
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

/** How far ahead Pace keeps the watch filled: 7, 14 days or 'all' (whole plan). */
export const WATCH_WINDOWS = { 7: '1 week', 14: '2 weken', all: 'Volledig schema' };

const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

/**
 * Put planned workouts on the watch and remove the ones that were dropped.
 * Without from/to it uses the window from the settings. Workouts that were
 * already sent before are always updated too, so the watch never shows an
 * old version.
 */
export async function pushUpcoming({ stale = [], from = null, to = null } = {}) {
  const provider = await activeProvider();
  if (!provider.canPushWorkouts) return { ok: true, count: 0, skipped: true };
  const s = await loadSyncSettings();
  const { plan, workouts } = await loadPlan();
  const today = isoDate(new Date());
  const win = s.watchWindow ?? WATCH_WINDOW_DAYS;
  const start = from && from > today ? from : today;
  const end = to || (win === 'all' ? plan?.goalDate || addDaysIso(today, 365) : addDaysIso(today, Number(win)));
  const upcoming = workouts.filter(
    (w) => w.status === 'planned' && !w.test && w.date >= today && ((w.date >= start && w.date <= end) || w.pushedAt)
  );
  if (stale.length) await provider.deleteWorkouts(stale);
  const result = await provider.pushWorkouts(upcoming);
  const now = new Date().toISOString();
  for (const w of upcoming) await db.put('workouts', { ...w, pushedAt: now });
  await saveSyncSettings({ ...(await loadSyncSettings()), lastPushAt: now });
  return { ...result, count: upcoming.length };
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
