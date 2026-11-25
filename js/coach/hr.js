// Heart rate zones that match Pace's pace zones (Daniels, % of max heart rate),
// plus the Garmin default zone numbers so you can read them on the Venu 3.

import { db } from '../db.js';

export const HR_KEY = 'hr';

/** Daniels' heart rate ranges per pace zone, as % of max HR and as % of heart rate reserve. */
const HR_PCT_MAX = {
  easy: [0.65, 0.79],
  marathon: [0.8, 0.85],
  threshold: [0.88, 0.92],
  interval: [0.95, 0.99],
};
const HR_PCT_RESERVE = {
  easy: [0.59, 0.74],
  marathon: [0.75, 0.84],
  threshold: [0.83, 0.88],
  interval: [0.93, 0.98],
};

/** Garmin's default zones: Z1 50–60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90–100% of max. */
const garminZone = (pct) => Math.min(5, Math.max(1, Math.floor((pct - 0.4) / 0.1)));

export async function loadHr() {
  return (await db.get('profile', HR_KEY)) || { id: HR_KEY, maxHr: null, restHr: null, age: null, source: null };
}

export async function saveHr(hr) {
  await db.put('profile', { ...hr, id: HR_KEY, updatedAt: new Date().toISOString() });
}

/** The max HR Pace uses: measured if known, otherwise an estimate from age (Tanaka: 208 − 0,7 × age). */
export function effectiveMaxHr(hr) {
  if (hr?.maxHr) return { value: hr.maxHr, estimated: false };
  if (hr?.age) return { value: Math.round(208 - 0.7 * hr.age), estimated: true };
  return null;
}

/**
 * bpm range per pace zone. With a resting HR the Karvonen method is used
 * (rest + % × reserve), which fits individual hearts better.
 */
export function hrZones(hr) {
  const max = effectiveMaxHr(hr);
  if (!max) return null;
  const rest = hr.restHr && hr.restHr < max.value - 40 ? hr.restHr : null;
  const bpm = (pct) => Math.round(rest ? rest + pct * (max.value - rest) : pct * max.value);
  const zones = {};
  for (const [key, [lo, hi]] of Object.entries(rest ? HR_PCT_RESERVE : HR_PCT_MAX)) {
    const low = bpm(lo);
    const high = bpm(hi);
    zones[key] = { low, high, garmin: [garminZone(low / max.value), garminZone(high / max.value)] };
  }
  return { zones, max: max.value, rest, estimated: max.estimated, karvonen: Boolean(rest) };
}

export const garminText = ([a, b]) => (a === b ? `Garmin zone ${a}` : `Garmin zone ${a}–${b}`);

/** Which pace zone a step belongs to, from its pace target. */
export function zoneForPace(pace, paceZones) {
  if (!pace || !paceZones) return null;
  const mid = (pace[0] + pace[1]) / 2;
  let best = null;
  let bestDiff = Infinity;
  for (const key of ['easy', 'marathon', 'threshold', 'interval', 'repetition']) {
    const z = paceZones[key];
    if (!z) continue;
    const diff = mid < z[0] ? z[0] - mid : mid > z[1] ? mid - z[1] : 0;
    if (diff < bestDiff) {
      best = key;
      bestDiff = diff;
    }
  }
  // Slower than easy (warm-up, recovery jog) still counts as easy.
  return best;
}
