// Intervals.icu provider. Talks straight to the Intervals.icu REST API from
// the browser (CORS is allowed), using the personal API key with Basic auth.
//
// Chain to the watch: Pace -> Intervals.icu calendar -> Garmin Connect -> Venu 3
// (needs "Upload planned workouts" switched on in Intervals.icu's Garmin settings).
// Chain back: Venu 3 -> Garmin Connect -> Intervals.icu -> Pace.

import { toIntervalsText, totalDurationS } from './workout-text.js';

const BASE = 'https://intervals.icu/api/v1';
const ATHLETE = '0'; // "0" = the athlete that owns the API key

export class IntervalsProvider {
  constructor(apiKey) {
    this.id = 'intervals';
    this.label = 'Intervals.icu';
    this.canPushWorkouts = true;
    this.canFetchActivities = true;
    this.auth = `Basic ${btoa(`API_KEY:${apiKey.trim()}`)}`;
  }

  async request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: this.auth,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError('Geen verbinding met Intervals.icu. Controleer je internet.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new SyncError('Intervals.icu weigert de sleutel. Kijk na of je de volledige API-sleutel plakte.');
    }
    if (res.status === 429) throw new SyncError('Even te veel verzoeken naar Intervals.icu. Probeer het over een paar minuten.');
    if (!res.ok) throw new SyncError(`Intervals.icu gaf een fout (${res.status}).`);
    return res.status === 204 ? null : res.json();
  }

  async testConnection() {
    try {
      const athlete = await this.request(`/athlete/${ATHLETE}`);
      return { ok: true, athleteName: athlete?.name || athlete?.firstname || '', athleteId: athlete?.id };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Create or update planned workouts in the Intervals.icu calendar.
   * Each Pace workout needs a stable `id` and a `date` (YYYY-MM-DD);
   * the id is sent as external_id so repeated pushes update instead of duplicating.
   */
  async pushWorkouts(workouts) {
    if (!workouts.length) return { ok: true, count: 0, events: [] };
    const events = workouts.map((w) => ({
      category: 'WORKOUT',
      type: 'Run',
      start_date_local: `${w.date}T00:00:00`,
      name: w.name,
      description: toIntervalsText(w),
      moving_time: totalDurationS(w),
      external_id: `pace-${w.id}`,
    }));
    const result = await this.request(`/athlete/${ATHLETE}/events/bulk?upsert=true`, { method: 'POST', body: events });
    return { ok: true, count: events.length, events: result || [] };
  }

  async deleteWorkouts(workoutIds) {
    if (!workoutIds.length) return { ok: true, count: 0 };
    const count = await this.request(`/athlete/${ATHLETE}/events/bulk-delete`, {
      method: 'PUT',
      body: workoutIds.map((id) => ({ external_id: `pace-${id}` })),
    });
    return { ok: true, count: Number(count) || 0 };
  }

  /** Recent runs as Pace `runs` records. */
  async fetchActivities(oldest, newest) {
    const list = await this.request(`/athlete/${ATHLETE}/activities?oldest=${oldest}&newest=${newest}`);
    return (list || [])
      .filter((a) => /run/i.test(a.type || ''))
      .map((a) => toRun(a));
  }
}

export class SyncError extends Error {}

/**
 * Intervals.icu activity -> Pace run.
 * When a data source does not allow sharing (Strava, and possibly Garmin in
 * the future), Intervals.icu only returns a stub without distance or time.
 * Such runs are marked `needsInput` so the app asks the user to fill them in.
 */
function toRun(a) {
  const distanceM = Number(a.distance) || null;
  const durationS = Number(a.moving_time || a.elapsed_time) || null;
  return {
    id: `intervals-${a.id}`,
    source: 'intervals',
    externalId: String(a.id),
    date: String(a.start_date_local || '').slice(0, 10),
    startedAt: a.start_date_local || null,
    name: a.name || 'Loop',
    distanceM,
    durationS,
    avgHr: Number(a.average_heartrate) || null,
    maxHr: Number(a.max_heartrate) || null,
    trainingLoad: Number(a.icu_training_load) || null,
    pairedEventId: a.paired_event_id || null,
    needsInput: !distanceM || !durationS,
  };
}
