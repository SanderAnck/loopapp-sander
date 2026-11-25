// Adaptation rules: after every finished run, compare it with the plan,
// read the questionnaire, and adjust only the next 1-2 weeks.
// Transparent and rule-based: every change carries the reason shown in the app.
// Pure functions: the caller loads data and stores the result.

const EXPECTED_RPE = { easy: 3.5, recovery: 3, long: 5, fartlek: 7, hills: 7.5, threshold: 7, intervals: 8, racepace: 7.5, race: 9 };
const QUALITY = new Set(['fartlek', 'hills', 'threshold', 'intervals', 'racepace']);
const HORIZON_DAYS = 14;
const DAY_MS = 864e5;

export const isQuality = (w) => QUALITY.has(w?.type);
export const expectedRpe = (w) => EXPECTED_RPE[w?.type] ?? 5;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Average pace (s/km) of the main work blocks of a planned workout. */
function plannedWorkPace(w) {
  const paces = [];
  for (const s of w.steps) {
    if (s.kind === 'repeat') s.steps.filter((x) => x.kind === 'work').forEach((x) => paces.push((x.pace[0] + x.pace[1]) / 2));
    else if (s.kind === 'work') paces.push((s.pace[0] + s.pace[1]) / 2);
  }
  return paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : null;
}

function plannedRange(w) {
  for (const s of w.steps) {
    if (s.kind === 'repeat') {
      const work = s.steps.find((x) => x.kind === 'work');
      if (work) return work.pace;
    } else if (s.kind === 'work') return s.pace;
  }
  return null;
}

/**
 * Compare the run with the plan.
 * @returns {{ result: 'gehaald'|'te snel'|'te traag'|'deels'|'afgebroken', paceDiffS: number|null, text: string }}
 */
export function evaluateRun(workout, run, checkin) {
  if (checkin.completion === 'aborted') return { result: 'afgebroken', paceDiffS: null, text: 'Training afgebroken.' };
  if (checkin.completion === 'partial') return { result: 'deels', paceDiffS: null, text: 'Training deels gedaan.' };
  if (!workout) return { result: 'gehaald', paceDiffS: null, text: 'Extra loop, buiten het schema.' };

  // Quality sessions: block pace if entered, else no pace judgement (warm-up dilutes the average).
  // Easy and long runs: the average pace of the whole run.
  let actual = null;
  let target = null;
  let range = null;
  if (isQuality(workout)) {
    if (run.blockPaceS) {
      actual = run.blockPaceS;
      target = plannedWorkPace(workout);
      range = plannedRange(workout);
    }
  } else if (run.distanceM && run.durationS) {
    actual = run.durationS / (run.distanceM / 1000);
    range = workout.steps[0].pace;
    target = (range[0] + range[1]) / 2;
  }
  if (actual === null) return { result: 'gehaald', paceDiffS: null, text: 'Training gedaan.' };

  const diff = Math.round(actual - target); // negative = faster than planned
  const [fast, slow] = range;
  const margin = isQuality(workout) ? 6 : 10;
  if (actual < fast - margin) return { result: 'te snel', paceDiffS: diff, text: `${Math.abs(diff)} s/km sneller dan gepland.` };
  if (actual > slow + margin) return { result: 'te traag', paceDiffS: diff, text: `${diff} s/km trager dan gepland.` };
  return { result: 'gehaald', paceDiffS: diff, text: 'Netjes binnen je tempozone.' };
}

/** Lighter version of a quality workout: about a quarter fewer repeats, or shorter blocks. */
export function lighten(workout) {
  const w = JSON.parse(JSON.stringify(workout));
  for (const s of w.steps) {
    if (s.kind === 'repeat' && s.reps > 2) {
      s.reps = Math.max(2, Math.round(s.reps * 0.75));
      return w;
    }
    if (s.kind === 'repeat') {
      s.steps.forEach((x) => {
        if (x.kind === 'work' && x.durationS) x.durationS = Math.round(x.durationS * 0.75);
        if (x.kind === 'work' && x.distanceM) x.distanceM = Math.round((x.distanceM * 0.75) / 100) * 100;
      });
      return w;
    }
  }
  for (const s of w.steps) {
    if (s.kind === 'work' && s.durationS) s.durationS = Math.round(s.durationS * 0.8);
    if (s.kind === 'work' && s.distanceM) s.distanceM = Math.round((s.distanceM * 0.8) / 500) * 500;
  }
  return w;
}

/** Easy recovery run that replaces a workout (keeps id and date). */
export function recoveryRun(workout, easyPace, minutes = 25) {
  return {
    ...workout,
    type: 'recovery',
    name: 'Herstelloop',
    steps: [{ kind: 'work', label: 'Heel rustig', durationS: minutes * 60, pace: easyPace }],
    note: 'Heel rustig en kort. Stop als de pijn erger wordt.',
  };
}

/** Shift every pace target of a workout by `deltaS` seconds per km (positive = slower). */
export function shiftPaces(workout, deltaS) {
  const w = JSON.parse(JSON.stringify(workout));
  const shift = (s) => {
    if (s.pace) s.pace = [s.pace[0] + deltaS, s.pace[1] + deltaS];
    if (s.steps) s.steps.forEach(shift);
  };
  w.steps.forEach(shift);
  return w;
}

function easyPaceOf(w) {
  const find = (steps) => {
    for (const s of steps) {
      if (s.kind === 'warmup' || s.kind === 'cooldown' || s.kind === 'recovery') return s.pace;
      if (s.steps) {
        const p = find(s.steps);
        if (p) return p;
      }
    }
    return null;
  };
  return find(w.steps) || w.steps[0].pace;
}

/**
 * Decide what to change after a finished (or skipped) run.
 * @param {object} p
 *   workout   planned workout (may be null for an extra run)
 *   run       { distanceM, durationS, avgHr, blockPaceS }
 *   checkin   { rpe, energy, pain: 'none'|'light'|'clear', painWhere, sleep, completion, text }
 *   history   earlier checkins, newest first, each with { type, rpe, completion, pain, result }
 *   upcoming  planned workouts in the coming weeks, sorted by date
 *   today     YYYY-MM-DD
 * @returns {{ evaluation, adjustments: Array<{rule,title,reason,changes:Array<{id,action,workout}>}>, paceOffsetDeltaS, messages }}
 */
export function adapt({ workout, run, checkin, history, upcoming, today }) {
  const evaluation = evaluateRun(workout, run, checkin);
  const horizon = addDays(today, HORIZON_DAYS);
  const next = upcoming.filter((w) => w.date > today && w.date <= horizon && w.status === 'planned');
  const nextQuality = next.find(isQuality);
  const adjustments = [];
  const messages = [];
  let paceOffsetDeltaS = 0;
  const touched = new Set();
  const change = (w, action, updated) => {
    touched.add(w.id);
    return { id: w.id, action, workout: updated };
  };

  // 1. Clear pain: the next 1-2 sessions become rest or a short recovery run.
  if (checkin.pain === 'clear') {
    const changes = next.slice(0, 2).map((w) => {
      const daysAway = Math.round((new Date(`${w.date}T12:00:00`) - new Date(`${today}T12:00:00`)) / DAY_MS);
      return daysAway <= 1 ? change(w, 'rest', null) : change(w, 'recovery', recoveryRun(w, easyPaceOf(w)));
    });
    adjustments.push({
      rule: 'pain-clear',
      title: 'Rust na duidelijke pijn',
      reason: `Je meldde duidelijke pijn${checkin.painWhere ? ` (${checkin.painWhere})` : ''}. De volgende ${changes.length} training(en) worden rust of een korte herstelloop. Verder lopen met pijn verlengt een blessure bijna altijd.`,
      changes,
    });
    messages.push('Houdt de pijn langer dan een week aan, of wordt ze erger? Laat je dan nakijken door een arts of kinesist.');
  }

  // 2. Light pain twice in a row: hold the load and skip hills.
  const lastPain = history[0]?.pain;
  if (checkin.pain === 'light' && lastPain && lastPain !== 'none' && nextQuality && !touched.has(nextQuality.id)) {
    const updated = nextQuality.type === 'hills' ? recoveryRun(nextQuality, easyPaceOf(nextQuality), 35) : lighten(nextQuality);
    adjustments.push({
      rule: 'pain-light-repeat',
      title: 'Voorzichtig met lichte pijn',
      reason: 'Voor de tweede keer na elkaar lichte pijn. Je volgende kwaliteitstraining wordt lichter, zodat je lichaam kan bijkomen voordat het een blessure wordt.',
      changes: [change(nextQuality, 'lighten', updated)],
    });
  }

  if (workout) {
    const exp = expectedRpe(workout);
    const hard = checkin.rpe >= exp + 2;
    const easyFeel = checkin.rpe <= exp - 2;

    // 3. Aborted or partly done quality: repeat instead of building on it.
    if (isQuality(workout) && (checkin.completion === 'aborted' || checkin.completion === 'partial') && nextQuality && !touched.has(nextQuality.id)) {
      adjustments.push({
        rule: 'incomplete',
        title: 'Volgende kwaliteitstraining lichter',
        reason: 'Deze training lukte niet helemaal. In plaats van verder op te bouwen, maken we de volgende kwaliteitstraining lichter, zodat je ze wel volledig kan afwerken.',
        changes: [change(nextQuality, 'lighten', lighten(nextQuality))],
      });
    }

    // 4. Much harder than expected: lighten the next quality session; twice in a row -> slower zones.
    if (hard && checkin.pain !== 'clear') {
      if (nextQuality && !touched.has(nextQuality.id)) {
        adjustments.push({
          rule: 'rpe-high',
          title: 'Zwaarder dan verwacht',
          reason: `Je gaf een ${checkin.rpe}/10, terwijl deze training rond ${exp}/10 hoort te voelen. Je volgende kwaliteitstraining wordt daarom wat lichter.`,
          changes: [change(nextQuality, 'lighten', lighten(nextQuality))],
        });
      }
      const prevHard = history.find((h) => h.type && h.rpe >= expectedRpe({ type: h.type }) + 2);
      if (prevHard && history.indexOf(prevHard) <= 1) {
        paceOffsetDeltaS += 5;
        adjustments.push({
          rule: 'zones-slower',
          title: 'Tempozones 5 s/km trager',
          reason: 'Al voor de tweede keer kort na elkaar voelde een training veel zwaarder dan bedoeld. Je tempozones gaan 5 seconden per km trager, tot je weer vlot meekan.',
          changes: [],
        });
      }
    }

    // 5. Several quality sessions done with a low RPE: zones faster.
    if (isQuality(workout) && easyFeel && checkin.completion === 'full' && evaluation.result !== 'te traag') {
      const recentQuality = history.filter((h) => QUALITY.has(h.type)).slice(0, 2);
      const allEasy = recentQuality.length === 2 && recentQuality.every((h) => h.completion === 'full' && h.rpe <= expectedRpe({ type: h.type }) - 1);
      if (allEasy) {
        paceOffsetDeltaS -= 4;
        adjustments.push({
          rule: 'zones-faster',
          title: 'Tempozones 4 s/km sneller',
          reason: 'Je laatste 3 kwaliteitstrainingen liep je volledig en met een lage RPE. Je bent fitter geworden: je tempozones gaan 4 seconden per km sneller.',
          changes: [],
        });
      } else {
        messages.push('Dit voelde makkelijker dan verwacht. Lukt dat nog twee keer, dan maakt de coach je tempo\'s sneller.');
      }
    }

    // 6. Pace feedback.
    if (evaluation.result === 'te snel' && !isQuality(workout)) {
      messages.push('Je liep sneller dan je rustige zone. Rustige lopen echt rustig houden maakt je sterker en spaart je knie voor de zware sessies.');
    } else if (evaluation.result === 'te snel' && isQuality(workout)) {
      messages.push('Je blokken waren sneller dan gepland. Gelijkmatig op tempo lopen levert meer op dan sneller gaan.');
    } else if (evaluation.result === 'te traag' && isQuality(workout) && !hard) {
      messages.push('Je blokken waren trager dan gepland, zonder dat het extreem zwaar voelde. Probeer de volgende keer iets dichter bij je doeltempo te lopen.');
    }
  }

  // 7. Poor sleep or low energy: a suggestion, the runner decides.
  if ((checkin.sleep <= 2 || checkin.energy <= 2) && checkin.pain !== 'clear') {
    messages.push('Je sliep slecht of had weinig energie. Voel je je morgen nog moe, kort je volgende training dan gerust in of loop ze rustiger. Dat is slim trainen, geen zwakte.');
  }

  return { evaluation, adjustments, paceOffsetDeltaS, messages };
}

/** Planned workouts in the past without a run: missed. They are not made up. */
export function findMissed(workouts, runsByDate, today) {
  return workouts.filter((w) => w.date < today && w.status === 'planned' && !runsByDate.has(w.date));
}
