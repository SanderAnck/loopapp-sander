// Runner profile: goal, current level and availability.
// Stored as a single record { id: 'me', ... } in the `profile` store.

import { db } from './db.js';
import { vdotFromRace, paceZones, predictRaceTime, goalFeasibility } from './coach/vdot.js';

export const GOAL_TYPES = [
  { id: '5k', label: '5 km', distanceM: 5000 },
  { id: '10k', label: '10 km', distanceM: 10000 },
  { id: 'half', label: 'Halve marathon', distanceM: 21097.5 },
  { id: 'marathon', label: 'Marathon', distanceM: 42195 },
  { id: 'custom', label: 'Eigen afstand', distanceM: null },
];

export const LEVEL_DISTANCES = [
  { id: '5k', label: '5 km', distanceM: 5000 },
  { id: '10k', label: '10 km', distanceM: 10000 },
  { id: 'half', label: 'Halve marathon', distanceM: 21097.5 },
  { id: 'custom', label: 'Andere afstand', distanceM: null },
];

// Monday = 0 ... Sunday = 6
export const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
export const WEEKDAYS_LONG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** ISO date (YYYY-MM-DD) in local time. */
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default goal date: the Sunday about 15 weeks from now. */
function defaultGoalDate() {
  const d = new Date();
  d.setDate(d.getDate() + 15 * 7);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // move forward to Sunday (getDay: Sunday = 0)
  return isoDate(d);
}

/** Starting values for a new profile (Sander's known situation). */
export function defaultProfile() {
  return {
    id: 'me',
    goal: {
      type: '10k',
      customDistanceKm: null,
      mode: 'time', // 'time' = with target time, 'finish' = just complete the distance
      targetTimeS: 55 * 60,
      date: defaultGoalDate(),
    },
    level: {
      distance: '10k',
      customDistanceKm: null,
      timeS: 60 * 60,
      date: isoDate(new Date()),
      weeklyKm: 12,
    },
    availability: {
      daysPerWeek: 2,
      preferredDays: [], // empty = no fixed days
      longRunDay: null, // null = let Pace choose
      maxWeekdayMin: null, // null = no limit
    },
    challenge: 3, // 1 = voorzichtig ... 5 = maximaal
    notes: { injuries: 'Runners knee' },
    createdAt: new Date().toISOString(),
    updatedAt: null, // null until the user saved the setup once
  };
}

export async function loadProfile() {
  return (await db.get('profile', 'me')) || null;
}

export async function saveProfile(profile) {
  const next = { ...profile, updatedAt: new Date().toISOString() };
  await db.put('profile', next);
  return next;
}

export function goalDistanceM(profile) {
  const g = profile.goal;
  if (g.type === 'custom') return (Number(g.customDistanceKm) || 0) * 1000;
  return GOAL_TYPES.find((t) => t.id === g.type).distanceM;
}

export function levelDistanceM(profile) {
  const l = profile.level;
  if (l.distance === 'custom') return (Number(l.customDistanceKm) || 0) * 1000;
  return LEVEL_DISTANCES.find((t) => t.id === l.distance).distanceM;
}

export function goalLabel(profile) {
  const g = profile.goal;
  const name = g.type === 'custom' ? `${g.customDistanceKm} km` : GOAL_TYPES.find((t) => t.id === g.type).label;
  return g.mode === 'time' && g.targetTimeS ? `${name} in ${formatRaceTime(g.targetTimeS)}` : `${name} uitlopen`;
}

export function levelLabel(profile) {
  const l = profile.level;
  const name = l.distance === 'custom' ? `${l.customDistanceKm} km` : LEVEL_DISTANCES.find((t) => t.id === l.distance).label;
  return `${name} in ${formatRaceTime(l.timeS)}`;
}

export function weeksUntil(isoDateStr) {
  const target = new Date(`${isoDateStr}T12:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((target - now) / (7 * 864e5)));
}

/** Format seconds as h:mm:ss or m:ss. */
export function formatDuration(totalS) {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Race times under 100 minutes read better as mm:ss (60:00 instead of 1:00:00). */
export function formatRaceTime(totalS) {
  const s = Math.round(totalS);
  if (s >= 6000) return formatDuration(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Everything derived from the profile that screens need. */
export function analyse(profile) {
  const currentVdot = vdotFromRace(levelDistanceM(profile), profile.level.timeS);
  const distanceM = goalDistanceM(profile);
  const weeks = weeksUntil(profile.goal.date);
  const result = {
    currentVdot,
    zones: paceZones(currentVdot),
    weeks,
    predictedNowS: distanceM ? predictRaceTime(currentVdot, distanceM) : null,
    goalVdot: null,
    goalPaceS: null,
    feasibility: null,
  };
  if (profile.goal.mode === 'time' && profile.goal.targetTimeS && distanceM) {
    result.goalVdot = vdotFromRace(distanceM, profile.goal.targetTimeS);
    result.goalPaceS = profile.goal.targetTimeS / (distanceM / 1000);
    result.feasibility = goalFeasibility({
      currentVdot,
      goalVdot: result.goalVdot,
      weeks,
      daysPerWeek: profile.availability.daysPerWeek,
    });
  }
  return result;
}

/** Returns a list of Dutch error messages; empty when valid. */
export function validate(profile) {
  const errors = [];
  const g = profile.goal;
  const l = profile.level;
  const a = profile.availability;
  if (g.type === 'custom' && !(Number(g.customDistanceKm) > 0)) errors.push('Vul de afstand van je doel in.');
  if (g.mode === 'time' && !(g.targetTimeS > 0)) errors.push('Vul een doeltijd in, of kies "Afstand uitlopen".');
  if (!g.date) errors.push('Kies een doeldatum.');
  else if (weeksUntil(g.date) < 3) errors.push('Kies een doeldatum minstens 3 weken vanaf nu.');
  if (l.distance === 'custom' && !(Number(l.customDistanceKm) > 0)) errors.push('Vul de afstand van je recente loop in.');
  if (!(l.timeS > 0)) errors.push('Vul de tijd van je recente loop in.');
  if (a.preferredDays.length > 0 && a.preferredDays.length < a.daysPerWeek) {
    errors.push(`Kies minstens ${a.daysPerWeek} voorkeursdagen, of geen enkele.`);
  }
  return errors;
}
