// Schedule generator. Pure function: profile in, plan + workouts out.
//
// Principles (from the design):
// - Periodisation: base -> build -> specific -> taper, recovery week every 4th week.
// - Weekly volume rises at most ~8% per week (well under the 10% rule).
// - At most 2 quality sessions per week, never two hard days in a row.
// - Every workout is structured (warm-up, blocks, repeats, cool-down) so it can go to the watch.
// - Runner's knee friendly: gentle progression, hills only uphill, no downhill repeats.

import { paceZones, paceAtFraction, vdotFromRace } from './vdot.js';
import { totalDurationS } from '../sync/workout-text.js';

const DAY_MS = 864e5;

// Peak weekly km for 3 run days; scaled by days per week below.
const PEAK_KM = { 5000: 22, 10000: 28, 21097.5: 40, 42195: 55 };
const LONG_MAX_KM = { 5000: 10, 10000: 14, 21097.5: 20, 42195: 32 };
const DAY_FACTOR = { 2: 0.75, 3: 1, 4: 1.15, 5: 1.3, 6: 1.4, 7: 1.5 };

// Default day patterns (0 = Monday). The last day is the long run.
const PATTERNS = {
  2: [2, 6],
  3: [1, 3, 6],
  4: [0, 2, 4, 6],
  5: [0, 1, 3, 4, 6],
  6: [0, 1, 2, 3, 4, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

export const PHASES = {
  base: { label: 'Basis', text: 'Rustige kilometers en strides. Je lichaam en je knie wennen aan de belasting.' },
  build: { label: 'Opbouw', text: 'Tempolopen op drempeltempo maken je sneller op langere stukken.' },
  specific: { label: 'Specifiek', text: 'Blokken op wedstrijdtempo, zodat je doeltempo vertrouwd aanvoelt.' },
  taper: { label: 'Taper', text: 'Minder volume, scherpte houden. Je komt fris aan de start.' },
};

export const WORKOUT_TYPES = {
  easy: 'Rustige duurloop',
  recovery: 'Herstelloop',
  long: 'Lange duurloop',
  threshold: 'Tempoloop',
  intervals: 'Intervallen',
  hills: 'Heuvels',
  racepace: 'Wedstrijdtempo',
  race: 'Wedstrijd',
};

export const HARD_TYPES = new Set(['threshold', 'intervals', 'hills', 'racepace', 'race', 'long']);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(`${s}T12:00:00`);
const mondayOf = (d) => {
  const m = new Date(d);
  m.setHours(12, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
const round = (x, step) => Math.round(x / step) * step;

// ---------- Step builders ----------

const warmup = (z, min = 10) => ({ kind: 'warmup', durationS: min * 60, pace: z.easy });
const cooldown = (z, min = 8) => ({ kind: 'cooldown', durationS: min * 60, pace: z.easy });
const easyBlock = (z, min, label = 'Rustig') => ({ kind: 'work', label, durationS: min * 60, pace: z.easy });
const jog = (z, s) => ({ kind: 'recovery', durationS: s, pace: z.easy });

function strides(z, reps = 6) {
  return {
    kind: 'repeat',
    label: 'Strides',
    reps,
    steps: [{ kind: 'work', label: 'Versnelling', durationS: 20, pace: z.repetition }, jog(z, 60)],
  };
}

// ---------- Workout templates ----------

function easyRun(z, minutes, withStrides) {
  const steps = withStrides ? [easyBlock(z, Math.max(15, minutes - 9)), strides(z), cooldown(z, 3)] : [easyBlock(z, minutes)];
  return { type: 'easy', steps, note: withStrides ? 'Strides: 20 seconden vlot maar ontspannen, niet sprinten.' : 'Echt rustig: je moet vlot kunnen praten.' };
}

function longRun(z, km) {
  return {
    type: 'long',
    steps: [{ kind: 'work', label: 'Rustig lang', distanceM: round(km, 0.5) * 1000, pace: z.easy }],
    note: 'Rustig tempo, op vlak terrein. Liever trager dan te snel.',
  };
}

// Threshold progression: total minutes at threshold pace grows over the build phase.
const THRESHOLD_STEPS = [
  [3, 6],
  [3, 8],
  [4, 7],
  [2, 12],
  [3, 10],
  [2, 15],
];

function threshold(z, level) {
  const [reps, min] = THRESHOLD_STEPS[Math.min(level, THRESHOLD_STEPS.length - 1)];
  return {
    type: 'threshold',
    steps: [warmup(z, 12), { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Drempel', durationS: min * 60, pace: z.threshold }, jog(z, 120)] }, cooldown(z, 8)],
    note: `${reps} × ${min} minuten "comfortabel zwaar": je kan nog korte zinnen zeggen.`,
  };
}

const RACEPACE_STEPS = [
  [5, 1000],
  [4, 1500],
  [6, 1000],
  [3, 2000],
  [4, 2000],
  [2, 3000],
];

function racePace(z, pace, level) {
  const [reps, dist] = RACEPACE_STEPS[Math.min(level, RACEPACE_STEPS.length - 1)];
  return {
    type: 'racepace',
    steps: [
      warmup(z, 12),
      { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Wedstrijdtempo', distanceM: dist, pace: [pace - 5, pace + 5] }, jog(z, 120)] },
      cooldown(z, 8),
    ],
    note: `${reps} × ${dist / 1000} km op je doeltempo. Gelijkmatig lopen is belangrijker dan sneller.`,
  };
}

function intervals(z, level) {
  const reps = Math.min(4 + level, 6);
  return {
    type: 'intervals',
    steps: [warmup(z, 12), { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Interval', durationS: 180, pace: z.interval }, jog(z, 120)] }, cooldown(z, 8)],
    note: `${reps} × 3 minuten stevig, 2 minuten rustig dribbelen ertussen.`,
  };
}

function hills(z) {
  return {
    type: 'hills',
    steps: [
      warmup(z, 15),
      { kind: 'repeat', reps: 6, steps: [{ kind: 'work', label: 'Heuvel op', durationS: 45, pace: [z.interval[0], z.threshold[1]] }, { kind: 'recovery', label: 'Wandel of dribbel terug', durationS: 90, pace: z.easy }] },
      cooldown(z, 10),
    ],
    note: 'Zoek een zachte helling. Krachtig bergop, heel rustig terug naar beneden (spaart je knie).',
  };
}

function raceTouch(z, pace) {
  return {
    type: 'racepace',
    steps: [warmup(z, 10), { kind: 'repeat', reps: 3, steps: [{ kind: 'work', label: 'Wedstrijdtempo', distanceM: 1000, pace: [pace - 5, pace + 5] }, jog(z, 120)] }, cooldown(z, 6)],
    note: 'Kort en scherp. Je moet je na afloop fris voelen.',
  };
}

function preRace(z) {
  return { type: 'easy', steps: [easyBlock(z, 20), strides(z, 4), cooldown(z, 3)], note: 'Losmaken voor de wedstrijd. Rustig, met een paar korte versnellingen.' };
}

function race(z, distanceM, pace) {
  return {
    type: 'race',
    steps: [warmup(z, 10), { kind: 'work', label: 'Wedstrijd', distanceM, pace: [pace - 5, pace + 5] }],
    note: 'Start iets voorzichtiger dan je doeltempo en versnel in de tweede helft. Succes!',
  };
}

// ---------- Helpers ----------

/** Estimated distance in km of a workout (each step at the middle of its pace range). */
export function estimateKm(workout) {
  const stepKm = (s) => (s.distanceM ? s.distanceM / 1000 : s.durationS / ((s.pace[0] + s.pace[1]) / 2));
  const km = workout.steps.reduce(
    (sum, s) => sum + (s.kind === 'repeat' ? s.reps * s.steps.reduce((a, x) => a + stepKm(x), 0) : stepKm(s)),
    0
  );
  return Math.round(km * 10) / 10;
}

/** Pick run days: preferred days if given, otherwise a spread-out default pattern. */
export function chooseDays(availability) {
  const n = availability.daysPerWeek;
  let days;
  if (availability.preferredDays.length >= n) {
    const pref = [...availability.preferredDays].sort((a, b) => a - b);
    // Keep the most spread-out subset of the preferred days.
    days = pref.length === n ? pref : spreadSubset(pref, n);
  } else {
    days = [...PATTERNS[n]];
    if (availability.longRunDay !== null) {
      const shift = availability.longRunDay - days[days.length - 1];
      days = days.map((d) => (((d + shift) % 7) + 7) % 7).sort((a, b) => a - b);
    }
  }
  let longDay = availability.longRunDay;
  if (longDay === null || !days.includes(longDay)) {
    longDay = days.includes(6) ? 6 : days.includes(5) ? 5 : days[days.length - 1];
  }
  return { days, longDay };
}

function spreadSubset(pref, n) {
  let best = null;
  let bestScore = -1;
  const combos = (arr, k, start = 0, acc = []) => {
    if (acc.length === k) {
      const gaps = acc.map((d, i) => ((acc[(i + 1) % k] - d + 7) % 7) || 7);
      const score = Math.min(...gaps) * 10 + gaps.reduce((a, b) => a + b, 0);
      if (score > bestScore) {
        bestScore = score;
        best = [...acc];
      }
      return;
    }
    for (let i = start; i < arr.length; i++) combos(arr, k, i + 1, [...acc, arr[i]]);
  };
  combos(pref, n);
  return best;
}

const adjacent = (a, b) => Math.abs(a - b) === 1 || Math.abs(a - b) === 6;

/** Assign the quality days: far from the long run and not next to another hard day. */
function qualityDays(days, longDay, count) {
  const candidates = days
    .filter((d) => d !== longDay)
    .map((d) => ({ d, gap: Math.min((d - longDay + 7) % 7, (longDay - d + 7) % 7) }))
    .sort((a, b) => b.gap - a.gap);
  const chosen = [];
  for (const { d } of candidates) {
    if (chosen.length >= count) break;
    const hard = [longDay, ...chosen];
    if (!hard.some((h) => adjacent(h, d))) chosen.push(d);
  }
  return chosen;
}

// ---------- Main ----------

/**
 * Build the full plan.
 * @param {object} profile  stored runner profile
 * @param {object} opts     { today: Date, goalDistanceM, goalPaceS }
 * @returns {{ plan, workouts }}
 */
export function generatePlan(profile, { today = new Date(), goalDistanceM, levelDistanceM }) {
  const start = mondayOf(today);
  const goalDate = parse(profile.goal.date);
  const raceWeekStart = mondayOf(goalDate);
  const weeks = Math.max(1, Math.round((raceWeekStart - start) / (7 * DAY_MS)) + 1);
  const days = profile.availability.daysPerWeek;

  // Phases: taper 2 weeks (1 when short), then base / build / specific.
  const taperWeeks = weeks >= 8 ? 2 : 1;
  const rest = weeks - taperWeeks;
  const baseWeeks = Math.max(1, Math.round(rest * 0.3));
  const buildWeeks = Math.max(1, Math.round(rest * 0.35));
  const phaseOf = (w) => {
    if (w >= weeks - taperWeeks) return 'taper';
    if (w < baseWeeks) return 'base';
    if (w < baseWeeks + buildWeeks) return 'build';
    return 'specific';
  };
  const isRecovery = (w) => phaseOf(w) !== 'taper' && w % 4 === 3;

  // Fitness: start from the current VDOT and expect gradual progress
  // (capped at 0.25 VDOT per week), so paces get a little faster each week.
  const currentVdot = vdotFromRace(levelDistanceM, profile.level.timeS);
  const hasTimeGoal = profile.goal.mode === 'time' && profile.goal.targetTimeS > 0;
  const goalVdot = hasTimeGoal ? vdotFromRace(goalDistanceM, profile.goal.targetTimeS) : currentVdot + 0.15 * weeks;
  const gain = Math.min(Math.max(goalVdot - currentVdot, 0), 0.25 * Math.max(weeks - taperWeeks, 1));
  const vdotAt = (w) => currentVdot + gain * Math.min(1, w / Math.max(weeks - taperWeeks, 1));
  const goalPace = hasTimeGoal
    ? profile.goal.targetTimeS / (goalDistanceM / 1000)
    : Math.round(paceAtFraction(currentVdot, 0.8)); // "finish" goal: steady, comfortable effort

  // Volume
  const distKey = Object.keys(PEAK_KM).map(Number).reduce((a, b) => (Math.abs(b - goalDistanceM) < Math.abs(a - goalDistanceM) ? b : a));
  const startKm = Math.max(profile.level.weeklyKm || 0, days * 4);
  const peakKm = Math.max(startKm, PEAK_KM[distKey] * DAY_FACTOR[days]);
  const longMax = LONG_MAX_KM[distKey];
  const firstLong = Math.max(5, startKm * 0.6);
  const volume = [];
  let level = startKm;
  for (let w = 0; w < weeks; w++) {
    const phase = phaseOf(w);
    if (phase === 'taper') volume.push(w === weeks - 1 ? peakKm * 0.5 : Math.min(level, peakKm) * 0.8);
    else if (isRecovery(w)) volume.push(level * 0.75);
    else {
      if (w > 0 && !isRecovery(w - 1)) level = Math.min(level * 1.08, peakKm);
      volume.push(level);
    }
  }

  const { days: runDays, longDay } = chooseDays(profile.availability);
  const maxWeekday = profile.availability.maxWeekdayMin;
  const workouts = [];
  const planWeeks = [];
  let thresholdLevel = 0;
  let racepaceLevel = 0;
  let intervalLevel = 0;

  for (let w = 0; w < weeks; w++) {
    const phase = phaseOf(w);
    const recovery = isRecovery(w);
    const z = paceZones(vdotAt(w));
    const weekStart = new Date(start.getTime() + w * 7 * DAY_MS);
    const raceWeek = w === weeks - 1;
    const qualityCount = phase === 'base' || recovery || days <= 2 ? 1 : 2;
    const qDays = qualityDays(runDays, longDay, raceWeek ? 1 : qualityCount);
    const weekWorkouts = [];
    // Race week always contains race day, even when it is not a usual run day.
    const raceDay = (goalDate.getDay() + 6) % 7;
    let daysThisWeek = runDays;
    if (raceWeek) {
      const before = runDays.filter((d) => d < raceDay);
      while (before.length > days - 1) before.pop(); // keep the earliest runs, rest before the race
      daysThisWeek = [...before, raceDay];
    }
    const todayIso = iso(today);

    for (const d of daysThisWeek) {
      const date = new Date(weekStart.getTime() + d * DAY_MS);
      const dateIso = iso(date);
      if (dateIso < todayIso) continue; // never plan in the past
      let t;
      if (raceWeek && dateIso === profile.goal.date) {
        t = race(z, goalDistanceM, goalPace);
      } else if (raceWeek && date > goalDate) {
        continue; // nothing after race day
      } else if (raceWeek) {
        // Race week: one short sharpener early in the week, otherwise easy.
        const daysToRace = Math.round((goalDate - date) / DAY_MS);
        t = daysToRace >= 4 && qDays.includes(d) ? raceTouch(z, goalPace) : preRace(z);
      } else if (d === longDay) {
        t = null; // filled after the others, from the remaining volume
      } else if (qDays.includes(d)) {
        const idx = qDays.indexOf(d);
        if (phase === 'base') t = recovery || w < 2 || w === 0 ? easyRun(z, 35, true) : hills(z);
        else if (recovery) t = easyRun(z, 35, true);
        else if (phase === 'build') t = idx === 0 ? threshold(z, thresholdLevel) : intervals(z, intervalLevel);
        else if (phase === 'specific') t = idx === 0 ? racePace(z, goalPace, racepaceLevel) : threshold(z, thresholdLevel);
        else t = idx === 0 ? raceTouch(z, goalPace) : easyRun(z, 35, true); // taper
      } else {
        t = easyRun(z, 35, false);
      }
      weekWorkouts.push({ d, date: dateIso, t });
    }

    // Long run gets what is left of the weekly volume (within limits).
    const otherKm = weekWorkouts.filter((x) => x.t).reduce((s, x) => s + estimateKm(x.t), 0);
    const longEntry = weekWorkouts.find((x) => !x.t);
    if (longEntry) {
      // A partly past week (the first one) only gets its share of the volume.
      const weekKmTarget = volume[w] * (weekWorkouts.length / daysThisWeek.length);
      const share = days === 2 ? 0.6 : days === 3 ? 0.45 : 0.35;
      const target = Math.max(weekKmTarget - otherKm, weekKmTarget * share);
      // The long run grows by at most ~0.75 km per week from a modest start.
      const longCap = Math.min(firstLong + 0.75 * w, longMax, phase === 'taper' ? longMax * 0.7 : longMax);
      longEntry.t = longRun(z, Math.min(Math.max(target, 5), longCap));
    }

    // Easy runs absorb any remaining volume for 4+ days; respect the weekday time cap.
    for (const x of weekWorkouts) {
      const weekday = x.d <= 4;
      if (weekday && maxWeekday && totalDurationS({ steps: x.t.steps }) > maxWeekday * 60) {
        x.t = capDuration(x.t, maxWeekday * 60, z);
      }
    }

    if (!recovery && phase === 'build') {
      thresholdLevel++;
      if (qualityCount > 1) intervalLevel++;
    }
    if (!recovery && phase === 'specific') {
      racepaceLevel++;
      if (qualityCount > 1) thresholdLevel++;
    }

    let weekKm = 0;
    for (const x of weekWorkouts) {
      const km = estimateKm(x.t);
      weekKm += km;
      workouts.push({
        id: `w${String(w + 1).padStart(2, '0')}-${x.d}`,
        date: x.date,
        week: w + 1,
        phase,
        type: x.t.type,
        name: WORKOUT_TYPES[x.t.type],
        steps: x.t.steps,
        note: x.t.note,
        km,
        durationS: totalDurationS({ steps: x.t.steps }),
        status: 'planned',
      });
    }
    planWeeks.push({ week: w + 1, start: iso(weekStart), phase, recovery, plannedKm: Math.round(weekKm * 10) / 10 });
  }

  const plan = {
    id: 'current',
    createdAt: new Date().toISOString(),
    profileUpdatedAt: profile.updatedAt,
    start: iso(start),
    goalDate: profile.goal.date,
    weeks: planWeeks,
    startVdot: currentVdot,
  };
  return { plan, workouts };
}

/** Shorten a workout to fit a time cap: trim warm-up/cool-down first, then easy blocks. */
function capDuration(t, capS, z) {
  const copy = JSON.parse(JSON.stringify(t));
  let over = totalDurationS({ steps: copy.steps }) - capS;
  for (const kind of ['cooldown', 'warmup', 'work']) {
    for (const s of copy.steps) {
      if (over <= 0) break;
      if (s.kind !== kind) continue;
      if (s.durationS) {
        const min = kind === 'work' ? 15 * 60 : 5 * 60;
        const cut = Math.min(over, Math.max(0, s.durationS - min));
        s.durationS -= cut;
        over -= cut;
      } else if (s.distanceM && kind === 'work') {
        const pace = (s.pace[0] + s.pace[1]) / 2;
        const maxM = Math.max(3000, ((s.distanceM / 1000) * pace - over) / pace * 1000);
        over -= ((s.distanceM - maxM) / 1000) * pace;
        s.distanceM = round(maxM, 500);
      }
    }
  }
  return copy;
}
