// Schedule generator. Pure function: profile in, plan + workouts out.
//
// Hard limits (from the design, the same at every challenge level):
// - Weekly volume rises at most 10% per week.
// - At most 2 quality sessions per week, never two hard days in a row.
// - Every workout is structured so it can go to the watch.
// - Runner's knee friendly: hills only uphill, no downhill repeats.
//
// The challenge level (1-5) tunes everything inside those limits:
// volume, growth, how early and how dense the quality work is, and paces.

import { paceZones, paceAtFraction, vdotFromRace } from './vdot.js';
import { totalDurationS } from '../sync/workout-text.js';

const DAY_MS = 864e5;

// Bump when the planning rules change, so existing plans are rebuilt.
export const PLANNER_VERSION = 2;

export const CHALLENGE_LEVELS = {
  1: { label: 'Voorzichtig', text: 'Rustige opbouw met veel marge. Goed na een blessure of bij weinig tijd.' },
  2: { label: 'Gemiddeld', text: 'Klassieke, veilige opbouw.' },
  3: { label: 'Uitdagend', text: 'Vanaf week 1 kwaliteit, stevigere blokken en een snellere opbouw.' },
  4: { label: 'Zwaar', text: 'Meer en langere blokken, lange duurlopen met een stevig einde.' },
  5: { label: 'Maximaal', text: 'Het zwaarste binnen de veiligheidsgrenzen. Let goed op je knie.' },
};
export const DEFAULT_CHALLENGE = 3;

// Tuning per challenge level (index 0 = level 1).
const TUNE = {
  growth: [1.05, 1.07, 1.09, 1.1, 1.1], // weekly volume growth (never above 10%)
  startFactor: [0.95, 1, 1.1, 1.1, 1.1], // first week vs current weekly km
  peakFactor: [0.85, 1, 1.15, 1.3, 1.45],
  recovery: [0.7, 0.75, 0.8, 0.8, 0.85], // recovery-week volume
  baseShare: [0.35, 0.3, 0.25, 0.2, 0.15], // share of weeks in the base phase
  progress: [0, 0, 1, 2, 3], // head start in the block progressions
  easy: [[0.62, 0.7], [0.63, 0.71], [0.65, 0.73], [0.67, 0.75], [0.68, 0.76]], // easy pace as fraction of VDOT
  gainCap: [0.15, 0.2, 0.25, 0.3, 0.35], // expected VDOT gain per week
  firstLong: [0.55, 0.6, 0.7, 0.75, 0.8], // first long run vs weekly km
  longStep: [0.5, 0.75, 1, 1, 1.25], // long run growth per week (km)
  strongFinish: [false, false, true, true, true], // last km of long runs at steady pace (build+)
};

// Peak weekly km for 3 run days; scaled by days per week below.
const PEAK_KM = { 5000: 22, 10000: 28, 21097.5: 40, 42195: 55 };
const LONG_MAX_KM = { 5000: 12, 10000: 16, 21097.5: 22, 42195: 32 };
const DAY_FACTOR = { 2: 0.8, 3: 1, 4: 1.15, 5: 1.3, 6: 1.4, 7: 1.5 };

// Default day patterns (0 = Monday). The last day is the long run.
const PATTERNS = {
  2: [2, 6],
  3: [1, 3, 6],
  4: [0, 2, 4, 6],
  5: [0, 1, 3, 4, 6],
  6: [0, 1, 2, 3, 4, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};
const DAY_NAMES = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

export const PHASES = {
  base: { label: 'Basis', text: 'Fundament leggen: duurvermogen, loopsnelheid en een sterke knie.' },
  build: { label: 'Opbouw', text: 'Tempolopen en intervallen tillen je drempel en je VO2max op.' },
  specific: { label: 'Specifiek', text: 'Blokken op wedstrijdtempo, zodat je doeltempo vertrouwd aanvoelt.' },
  taper: { label: 'Taper', text: 'Minder volume, scherpte houden. Je komt fris aan de start.' },
};

export const WORKOUT_TYPES = {
  easy: 'Rustige duurloop',
  recovery: 'Herstelloop',
  long: 'Lange duurloop',
  fartlek: 'Fartlek',
  threshold: 'Tempoloop',
  intervals: 'Intervallen',
  hills: 'Heuvels',
  racepace: 'Wedstrijdtempo',
  race: 'Wedstrijd',
};

export const HARD_TYPES = new Set(['fartlek', 'threshold', 'intervals', 'hills', 'racepace', 'race', 'long']);

// What each type of training is for, and how it should feel.
const PURPOSE = {
  easy: {
    goal: 'Aerobe basis bouwen: je hart, je bloedvaten en je spieren worden efficiënter in het gebruiken van zuurstof.',
    feel: 'RPE 3–4: je kan een gesprek voeren.',
  },
  long: {
    goal: 'Duurvermogen: je leert langer lopen zonder te verzuren, en je pezen en gewrichten wennen aan de belasting.',
    feel: 'RPE 4–5, op het einde misschien 6.',
  },
  fartlek: {
    goal: 'Snelheid en loopeconomie: korte, stevige versnellingen leren je benen sneller bewegen zonder dat het zwaar wordt.',
    feel: 'RPE 7 tijdens de versnellingen, 3 ertussen.',
  },
  threshold: {
    goal: 'Je drempel verhogen: het tempo dat je lang kan volhouden voordat melkzuur zich opstapelt. Dit is de belangrijkste training voor een snellere 10 km.',
    feel: 'RPE 7: comfortabel zwaar, korte zinnen lukken nog.',
  },
  intervals: {
    goal: 'Je VO2max verhogen: je maximale zuurstofopname. Daardoor voelt je wedstrijdtempo later relatief makkelijker.',
    feel: 'RPE 8: zwaar, maar elke herhaling even snel.',
  },
  hills: {
    goal: 'Kracht en loopeconomie: bergop lopen versterkt kuiten, bilspieren en bovenbenen met weinig schokbelasting. Sterke bilspieren ontlasten ook je knie.',
    feel: 'RPE 8 bergop, heel rustig terug.',
  },
  racepace: {
    goal: 'Je doeltempo leren kennen: je lichaam en je hoofd wennen aan precies het tempo van je wedstrijd.',
    feel: 'RPE 7–8: stevig, maar gecontroleerd en gelijkmatig.',
  },
  race: {
    goal: 'De dag waar je naartoe werkte.',
    feel: 'Vertrek gecontroleerd, versnel na 5 km als je je goed voelt.',
  },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(`${s}T12:00:00`);
const mondayOf = (d) => {
  const m = new Date(d);
  m.setHours(12, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
const round = (x, step) => Math.round(x / step) * step;
const kmText = (km) => `${km.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km`;

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

function easyRun(z, minutes, stridesReps = 0) {
  const steps = stridesReps ? [easyBlock(z, Math.max(15, minutes - 9)), strides(z, stridesReps), cooldown(z, 3)] : [easyBlock(z, minutes)];
  return {
    type: 'easy',
    steps,
    note: stridesReps ? 'Strides: 20 seconden vlot maar ontspannen, niet sprinten.' : 'Echt rustig: je moet vlot kunnen praten.',
    detail: stridesReps ? `${minutes} minuten rustig met ${stridesReps} strides` : `${minutes} minuten rustig`,
  };
}

function longRun(z, km, finishKm) {
  if (finishKm) {
    const easyKm = round(km - finishKm, 0.5);
    return {
      type: 'long',
      steps: [
        { kind: 'work', label: 'Rustig lang', distanceM: easyKm * 1000, pace: z.easy },
        { kind: 'work', label: 'Stevig einde', distanceM: finishKm * 1000, pace: z.marathon },
      ],
      note: `De laatste ${finishKm} km op stevig duurtempo: vermoeid toch je tempo vasthouden.`,
      detail: `${kmText(easyKm + finishKm)}, waarvan de laatste ${finishKm} km stevig`,
    };
  }
  return {
    type: 'long',
    steps: [{ kind: 'work', label: 'Rustig lang', distanceM: round(km, 0.5) * 1000, pace: z.easy }],
    note: 'Rustig tempo, liefst op vlak terrein.',
    detail: kmText(round(km, 0.5)),
  };
}

function fartlek(z, level) {
  const reps = Math.min(6 + level, 10);
  return {
    type: 'fartlek',
    steps: [warmup(z, 10), { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Vlot', durationS: 60, pace: z.interval }, jog(z, 90)] }, cooldown(z, 8)],
    note: `${reps} × 1 minuut vlot, 1,5 minuut rustig. Vlot is je 5 km-gevoel, niet sprinten.`,
    detail: `${reps} × 1 min vlot`,
  };
}

const THRESHOLD_STEPS = [[3, 6], [3, 8], [4, 7], [3, 10], [2, 15], [4, 8], [3, 12], [2, 18], [5, 8], [1, 30]];

function threshold(z, level) {
  const [reps, min] = THRESHOLD_STEPS[Math.min(level, THRESHOLD_STEPS.length - 1)];
  const block = { kind: 'work', label: 'Drempel', durationS: min * 60, pace: z.threshold };
  const steps = reps === 1 ? [warmup(z, 12), block, cooldown(z, 8)] : [warmup(z, 12), { kind: 'repeat', reps, steps: [block, jog(z, 90)] }, cooldown(z, 8)];
  return {
    type: 'threshold',
    steps,
    note: `${reps} × ${min} minuten "comfortabel zwaar": je kan nog korte zinnen zeggen.`,
    detail: `${reps} × ${min} min op drempeltempo (${reps * min} min in totaal)`,
  };
}

const RACEPACE_STEPS = [[5, 1000], [4, 1500], [6, 1000], [3, 2000], [4, 2000], [3, 2500], [2, 3000], [5, 1600], [3, 3000], [2, 4000]];

function racePace(z, pace, level) {
  const [reps, dist] = RACEPACE_STEPS[Math.min(level, RACEPACE_STEPS.length - 1)];
  return {
    type: 'racepace',
    steps: [
      warmup(z, 12),
      { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Wedstrijdtempo', distanceM: dist, pace: [pace - 4, pace + 4] }, jog(z, 120)] },
      cooldown(z, 8),
    ],
    note: `${reps} × ${(dist / 1000).toLocaleString('nl-BE')} km op je doeltempo. Gelijkmatig lopen is belangrijker dan sneller.`,
    detail: `${reps} × ${(dist / 1000).toLocaleString('nl-BE')} km op doeltempo (${((reps * dist) / 1000).toLocaleString('nl-BE')} km in totaal)`,
  };
}

const INTERVAL_STEPS = [[5, 180], [6, 180], [5, 240], [6, 240], [4, 300], [5, 300]];

function intervals(z, level) {
  const [reps, s] = INTERVAL_STEPS[Math.min(level, INTERVAL_STEPS.length - 1)];
  return {
    type: 'intervals',
    steps: [warmup(z, 12), { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Interval', durationS: s, pace: z.interval }, jog(z, 120)] }, cooldown(z, 8)],
    note: `${reps} × ${s / 60} minuten stevig, 2 minuten rustig dribbelen ertussen.`,
    detail: `${reps} × ${s / 60} min op intervaltempo`,
  };
}

function hills(z, level) {
  const reps = Math.min(6 + level, 10);
  return {
    type: 'hills',
    steps: [
      warmup(z, 15),
      { kind: 'repeat', reps, steps: [{ kind: 'work', label: 'Heuvel op', durationS: 60, pace: [z.interval[0], z.threshold[1]] }, { kind: 'recovery', label: 'Wandel of dribbel terug', durationS: 120, pace: z.easy }] },
      cooldown(z, 10),
    ],
    note: 'Zoek een helling van 1 minuut. Krachtig bergop, heel rustig terug naar beneden (spaart je knie). Tempo bergop is een richtlijn: loop op gevoel.',
    detail: `${reps} × 1 min bergop`,
  };
}

function raceTouch(z, pace) {
  return {
    type: 'racepace',
    steps: [warmup(z, 10), { kind: 'repeat', reps: 3, steps: [{ kind: 'work', label: 'Wedstrijdtempo', distanceM: 1000, pace: [pace - 4, pace + 4] }, jog(z, 120)] }, cooldown(z, 6)],
    note: 'Kort en scherp. Je moet je na afloop fris voelen.',
    detail: '3 × 1 km op doeltempo',
  };
}

function preRace(z) {
  const t = easyRun(z, 25, 4);
  return { ...t, note: 'Losmaken voor de wedstrijd. Rustig, met een paar korte versnellingen.' };
}

function race(z, distanceM, pace) {
  return {
    type: 'race',
    steps: [warmup(z, 10), { kind: 'work', label: 'Wedstrijd', distanceM, pace: [pace - 4, pace + 4] }],
    note: 'Start iets voorzichtiger dan je doeltempo en versnel in de tweede helft. Succes!',
    detail: `${kmText(distanceM / 1000)} op doeltempo`,
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

/** Quality days: far from the long run and never next to another hard day. */
function qualityDays(days, longDay, count) {
  const candidates = days
    .filter((d) => d !== longDay)
    .map((d) => ({ d, gap: Math.min((d - longDay + 7) % 7, (longDay - d + 7) % 7) }))
    .sort((a, b) => b.gap - a.gap);
  const chosen = [];
  for (const { d } of candidates) {
    if (chosen.length >= count) break;
    if (![longDay, ...chosen].some((h) => adjacent(h, d))) chosen.push(d);
  }
  return chosen;
}

// ---------- Explanations ----------

function explain(t, ctx) {
  const p = PURPOSE[t.type] || PURPOSE.easy;
  const reasons = [];
  const { phase, recovery, raceWeek, week, weeks, challenge, day, longDay, prevLongKm, longKm, weekKm, prevWeekKm, quality } = ctx;
  const lvl = CHALLENGE_LEVELS[challenge].label.toLowerCase();
  const phaseText = PHASES[phase].text;

  if (raceWeek && t.type === 'race') reasons.push('Wedstrijddag: alles in de voorbije weken stond in het teken van vandaag.');
  else if (raceWeek) reasons.push('Wedstrijdweek: weinig volume zodat je benen fris zijn, met net genoeg prikkel om scherp te blijven.');
  else if (recovery) reasons.push(`Herstelweek (week ${week}): het volume zakt naar ${kmText(weekKm)}. Je wordt sterker tijdens het herstel, niet tijdens de training zelf.`);
  else reasons.push(`Week ${week} van ${weeks}, fase ${PHASES[phase].label.toLowerCase()}: ${phaseText.charAt(0).toLowerCase()}${phaseText.slice(1)}`);

  if (t.type === 'long' && prevLongKm && !raceWeek) {
    const diff = Math.round((longKm - prevLongKm) * 10) / 10;
    if (diff > 0) reasons.push(`De lange duurloop groeit met ${kmText(diff)} tegenover vorige week: genoeg om vooruit te gaan, klein genoeg voor je knie.`);
    else if (diff < 0) reasons.push('De lange duurloop is korter dan vorige week, zodat je lichaam kan bijkomen.');
  }
  if (quality && t.detail) reasons.push(`Vandaag: ${t.detail}, afgestemd op uitdagingsniveau "${lvl}". Elke volgende sessie van dit type wordt iets zwaarder.`);
  if (t.type === 'long' && t.steps.length > 1) reasons.push('Het stevige einde leert je tempo vasthouden als je moe bent, precies wat je in de tweede helft van je wedstrijd nodig hebt.');
  if (t.type === 'hills') reasons.push('Alleen bergop en rustig terug: zo krijg je de kracht zonder de klappen van bergaf lopen, wat je knie spaart.');
  if (quality) reasons.push(`Op ${DAY_NAMES[day]}: zo ver mogelijk van je lange duurloop op ${DAY_NAMES[longDay]}, zodat er nooit twee zware dagen na elkaar komen.`);
  if (t.type === 'easy' && !raceWeek) reasons.push('Rustig is hier echt rustig: zo kan je herstellen van de zware sessies en blijft je knie fit.');
  if (!raceWeek && !recovery && prevWeekKm && weekKm > prevWeekKm) {
    const pct = Math.round((weekKm / prevWeekKm - 1) * 100);
    if (pct > 0) reasons.push(`Je weekvolume stijgt deze week met ${pct}%, binnen de veilige grens van 10%.`);
  }
  return { goal: p.goal, feel: p.feel, reasons };
}

// ---------- Main ----------

export function generatePlan(profile, { today = new Date(), goalDistanceM, levelDistanceM }) {
  const challenge = Number(profile.challenge) || DEFAULT_CHALLENGE;
  const L = challenge - 1;
  const start = mondayOf(today);
  const goalDate = parse(profile.goal.date);
  const weeks = Math.max(1, Math.round((mondayOf(goalDate) - start) / (7 * DAY_MS)) + 1);
  const days = profile.availability.daysPerWeek;

  const taperWeeks = weeks >= 8 ? 2 : 1;
  const rest = weeks - taperWeeks;
  const baseWeeks = Math.max(1, Math.round(rest * TUNE.baseShare[L]));
  const buildWeeks = Math.max(1, Math.round(rest * 0.38));
  const phaseOf = (w) => {
    if (w >= weeks - taperWeeks) return 'taper';
    if (w < baseWeeks) return 'base';
    if (w < baseWeeks + buildWeeks) return 'build';
    return 'specific';
  };
  const isRecovery = (w) => phaseOf(w) !== 'taper' && w % 4 === 3;

  // Fitness: expected progress per week, capped by the challenge level.
  const currentVdot = vdotFromRace(levelDistanceM, profile.level.timeS);
  const hasTimeGoal = profile.goal.mode === 'time' && profile.goal.targetTimeS > 0;
  const goalVdot = hasTimeGoal ? vdotFromRace(goalDistanceM, profile.goal.targetTimeS) : currentVdot + 0.15 * weeks;
  const trainWeeks = Math.max(weeks - taperWeeks, 1);
  const gain = Math.min(Math.max(goalVdot - currentVdot, 0), TUNE.gainCap[L] * trainWeeks);
  const vdotAt = (w) => currentVdot + gain * Math.min(1, w / trainWeeks);
  const zonesAt = (w) => {
    const v = vdotAt(w);
    const z = paceZones(v);
    const [slowF, fastF] = TUNE.easy[L];
    z.easy = [Math.round(paceAtFraction(v, fastF)), Math.round(paceAtFraction(v, slowF))];
    return z;
  };
  const goalPace = hasTimeGoal ? profile.goal.targetTimeS / (goalDistanceM / 1000) : Math.round(paceAtFraction(currentVdot, 0.8));

  // Volume
  const distKey = Object.keys(PEAK_KM).map(Number).reduce((a, b) => (Math.abs(b - goalDistanceM) < Math.abs(a - goalDistanceM) ? b : a));
  const startKm = Math.max((profile.level.weeklyKm || 0) * TUNE.startFactor[L], days * 4);
  const peakKm = Math.max(startKm, PEAK_KM[distKey] * DAY_FACTOR[days] * TUNE.peakFactor[L]);
  const longMax = LONG_MAX_KM[distKey];
  const firstLong = Math.max(5, (profile.level.weeklyKm || startKm) * TUNE.firstLong[L]);
  const volume = [];
  let level = startKm;
  for (let w = 0; w < weeks; w++) {
    const phase = phaseOf(w);
    if (phase === 'taper') volume.push(w === weeks - 1 ? peakKm * 0.5 : Math.min(level, peakKm) * 0.8);
    else if (isRecovery(w)) volume.push(level * TUNE.recovery[L]);
    else {
      if (w > 0 && !isRecovery(w - 1)) level = Math.min(level * TUNE.growth[L], peakKm);
      volume.push(level);
    }
  }

  const { days: runDays, longDay } = chooseDays(profile.availability);
  const maxWeekday = profile.availability.maxWeekdayMin;
  const workouts = [];
  const planWeeks = [];
  const lv = {
    threshold: TUNE.progress[L],
    racepace: TUNE.progress[L],
    intervals: Math.max(0, TUNE.progress[L] - 1),
    fartlek: TUNE.progress[L],
    hills: TUNE.progress[L],
  };
  let prevLongKm = null;
  let prevWeekKm = null;
  let loadKm = startKm; // highest normal week so far, base for the 10% rule
  let buildToggle = 0;
  const stridesReps = challenge >= 3 ? 8 : 6;
  const todayIso = iso(today);

  for (let w = 0; w < weeks; w++) {
    const phase = phaseOf(w);
    const recovery = isRecovery(w);
    const z = zonesAt(w);
    const weekStart = new Date(start.getTime() + w * 7 * DAY_MS);
    const raceWeek = w === weeks - 1;
    const twoQuality = days >= 3 && !recovery && (phase !== 'base' || challenge >= 4);
    const qDays = qualityDays(runDays, longDay, raceWeek ? 1 : twoQuality ? 2 : 1);

    const raceDay = (goalDate.getDay() + 6) % 7;
    let daysThisWeek = runDays;
    if (raceWeek) {
      const before = runDays.filter((d) => d < raceDay);
      while (before.length > days - 1) before.pop();
      daysThisWeek = [...before, raceDay];
    }

    const weekWorkouts = [];
    for (const d of daysThisWeek) {
      const date = new Date(weekStart.getTime() + d * DAY_MS);
      const dateIso = iso(date);
      if (dateIso < todayIso) continue;
      let t;
      let quality = false;
      if (raceWeek && dateIso === profile.goal.date) {
        t = race(z, goalDistanceM, goalPace);
      } else if (raceWeek) {
        const daysToRace = Math.round((goalDate - date) / DAY_MS);
        t = daysToRace >= 4 && qDays.includes(d) ? raceTouch(z, goalPace) : preRace(z);
      } else if (d === longDay) {
        t = null;
      } else if (qDays.includes(d)) {
        const idx = qDays.indexOf(d);
        quality = true;
        if (recovery) {
          t = challenge >= 3 ? fartlek(z, Math.max(0, lv.fartlek - 2)) : easyRun(z, 35, stridesReps);
          quality = challenge >= 3;
        } else if (phase === 'base') {
          // Level 1-2 start with strides; level 3+ start with real quality from week 1.
          if (challenge <= 2 && w < 2) {
            t = easyRun(z, 35, stridesReps);
            quality = false;
          } else {
            t = (w + idx) % 2 === 0 ? fartlek(z, lv.fartlek++) : hills(z, lv.hills++);
          }
        } else if (phase === 'build') {
          if (idx === 0) {
            // With one quality day, alternate threshold and intervals from level 3.
            t = !twoQuality && challenge >= 3 && buildToggle++ % 2 === 1 ? intervals(z, lv.intervals++) : threshold(z, lv.threshold++);
          } else t = intervals(z, lv.intervals++);
        } else if (phase === 'specific') {
          t = idx === 0 ? racePace(z, goalPace, lv.racepace++) : threshold(z, lv.threshold++);
        } else {
          t = idx === 0 ? raceTouch(z, goalPace) : easyRun(z, 35, stridesReps);
        }
      } else {
        t = easyRun(z, 40, challenge >= 3 ? stridesReps : 0);
      }
      weekWorkouts.push({ d, date: dateIso, t, quality });
    }

    // Long run: what is left of the weekly volume, within the growth cap.
    const otherKm = weekWorkouts.filter((x) => x.t).reduce((s, x) => s + estimateKm(x.t), 0);
    const longEntry = weekWorkouts.find((x) => !x.t);
    let longKm = null;
    if (longEntry) {
      const weekKmTarget = volume[w] * (weekWorkouts.length / daysThisWeek.length);
      const share = days === 2 ? 0.6 : days === 3 ? 0.45 : 0.35;
      const target = Math.max(weekKmTarget - otherKm, weekKmTarget * share);
      const cap = Math.min(firstLong + TUNE.longStep[L] * w, phase === 'taper' ? longMax * 0.7 : longMax);
      const recoveryCap = recovery && prevLongKm ? prevLongKm * 0.8 : Infinity;
      longKm = round(Math.max(5, Math.min(Math.max(target, 5), cap, recoveryCap)), 0.5);
      const finish =
        TUNE.strongFinish[L] && !recovery && (phase === 'build' || phase === 'specific')
          ? Math.min(challenge >= 5 ? 4 : challenge >= 4 ? 3 : 2, Math.floor(longKm / 3))
          : 0;
      longEntry.t = longRun(z, longKm, finish);
    }

    for (const x of weekWorkouts) {
      if (x.d <= 4 && maxWeekday && totalDurationS({ steps: x.t.steps }) > maxWeekday * 60) x.t = capDuration(x.t, maxWeekday * 60);
    }

    // Hard 10% rule against the last normal (non-recovery) week:
    // shorten the long run first, then warm-ups and cool-downs.
    const fullWeek = weekWorkouts.length === daysThisWeek.length;
    if (fullWeek && !recovery && !raceWeek && phase !== 'taper') {
      const limit = loadKm * 1.1;
      let total = weekWorkouts.reduce((s, x) => s + estimateKm(x.t), 0);
      if (total > limit && longEntry) {
        const cut = Math.min(total - limit, longKm - 5);
        if (cut > 0) {
          longKm = Math.max(5, Math.floor((longKm - cut) * 2) / 2);
          const finish = longEntry.t.steps.length > 1 ? longEntry.t.steps[1].distanceM / 1000 : 0;
          longEntry.t = longRun(z, longKm, Math.min(finish, Math.floor(longKm / 3)));
          total = weekWorkouts.reduce((s, x) => s + estimateKm(x.t), 0);
        }
      }
      for (const x of weekWorkouts) {
        if (total <= limit) break;
        for (const st of x.t.steps) {
          if ((st.kind === 'warmup' || st.kind === 'cooldown') && st.durationS > 300) {
            const before = estimateKm(x.t);
            st.durationS = Math.max(300, st.durationS - 300);
            total -= before - estimateKm(x.t);
          }
        }
      }
    }

    const weekKm = Math.round(weekWorkouts.reduce((s, x) => s + estimateKm(x.t), 0) * 10) / 10;
    if (fullWeek && !recovery && phase !== 'taper') loadKm = Math.max(loadKm, weekKm);
    for (const x of weekWorkouts) {
      const why = explain(x.t, {
        phase,
        recovery,
        raceWeek,
        week: w + 1,
        weeks,
        challenge,
        day: x.d,
        longDay,
        prevLongKm,
        longKm,
        weekKm,
        prevWeekKm,
        quality: x.quality,
      });
      workouts.push({
        id: `w${String(w + 1).padStart(2, '0')}-${x.d}`,
        date: x.date,
        week: w + 1,
        phase,
        type: x.t.type,
        name: WORKOUT_TYPES[x.t.type],
        steps: x.t.steps,
        note: x.t.note,
        why,
        km: estimateKm(x.t),
        durationS: totalDurationS({ steps: x.t.steps }),
        status: 'planned',
      });
    }
    if (longKm) prevLongKm = longKm;
    if (weekWorkouts.length === daysThisWeek.length) prevWeekKm = weekKm;
    planWeeks.push({ week: w + 1, start: iso(weekStart), phase, recovery, plannedKm: weekKm });
  }

  return {
    plan: {
      id: 'current',
      plannerVersion: PLANNER_VERSION,
      createdAt: new Date().toISOString(),
      profileUpdatedAt: profile.updatedAt,
      start: iso(start),
      goalDate: profile.goal.date,
      weeks: planWeeks,
      startVdot: currentVdot,
      challenge,
      peakKm: Math.round(peakKm),
    },
    workouts,
  };
}

/** Shorten a workout to fit a time cap: trim cool-down and warm-up first, then easy blocks. */
function capDuration(t, capS) {
  const copy = JSON.parse(JSON.stringify(t));
  let over = totalDurationS({ steps: copy.steps }) - capS;
  for (const kind of ['cooldown', 'warmup', 'work']) {
    for (const s of copy.steps) {
      if (over <= 0) break;
      if (s.kind !== kind || !s.durationS) continue;
      const min = kind === 'work' ? 15 * 60 : 5 * 60;
      const cut = Math.min(over, Math.max(0, s.durationS - min));
      s.durationS -= cut;
      over -= cut;
    }
  }
  return copy;
}
