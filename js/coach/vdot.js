// Running fitness maths based on Jack Daniels' VDOT model.
// Pure functions, no DOM: easy to test and reuse in the schedule generator.

/** Oxygen cost (ml/kg/min) of running at velocity v (metres per minute). */
export function oxygenCost(v) {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max that can be sustained for a race of t minutes. */
export function sustainableFraction(t) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}

/** VDOT from a race or time trial: distance in metres, time in seconds. */
export function vdotFromRace(distanceM, timeS) {
  const t = timeS / 60;
  const v = distanceM / t;
  return oxygenCost(v) / sustainableFraction(t);
}

/** Velocity (m/min) at which the oxygen cost equals the given VO2. */
function velocityForVO2(vo2) {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** Pace in seconds per km when running at `fraction` of VDOT. */
export function paceAtFraction(vdot, fraction) {
  return 60000 / velocityForVO2(vdot * fraction);
}

/** Predicted race time (seconds) for a distance at a given VDOT (bisection). */
export function predictRaceTime(vdot, distanceM) {
  let lo = 60; // 1 minute
  let hi = 60 * 60 * 10; // 10 hours
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // A slower time gives a lower VDOT.
    if (vdotFromRace(distanceM, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/**
 * Training pace zones (seconds per km). Each zone is a [fast, slow] range.
 * Fractions follow Daniels' intensity guidelines.
 */
export function paceZones(vdot) {
  const p = (f) => Math.round(paceAtFraction(vdot, f));
  return {
    easy: [p(0.7), p(0.6)], // rustig / herstel / lange duurloop
    marathon: [p(0.84), p(0.79)],
    threshold: [p(0.9), p(0.86)], // drempel / tempo
    interval: [p(1.0), p(0.96)],
    repetition: [p(1.08), p(1.04)], // strides en korte herhalingen
  };
}

/**
 * How ambitious is a goal? Compares the VDOT gain needed with the weeks
 * available. Typical gain for a recreational runner is about 0.15 to 0.3
 * VDOT per week early on, less when training only twice a week.
 */
/** Realistic VDOT gain per week; fewer run days means slower progress. */
export function weeklyCapacity(daysPerWeek) {
  return daysPerWeek <= 2 ? 0.22 : daysPerWeek === 3 ? 0.28 : 0.33;
}

export function goalFeasibility({ currentVdot, goalVdot, weeks, daysPerWeek }) {
  const gain = goalVdot - currentVdot;
  if (gain <= 0) return { level: 'easy', gain, perWeek: 0 };
  const perWeek = gain / Math.max(weeks, 1);
  const capacity = weeklyCapacity(daysPerWeek);
  const ratio = perWeek / capacity;
  const level = ratio <= 0.75 ? 'realistic' : ratio <= 1.1 ? 'ambitious' : 'very-ambitious';
  return { level, gain, perWeek, capacity, ratio };
}
