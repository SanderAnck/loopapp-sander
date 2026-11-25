// Converts a Pace workout into Intervals.icu workout-builder text.
// Intervals.icu parses this text into structured steps and forwards the
// workout to Garmin Connect, so the watch guides each step with a pace target.
//
// Pace workout model:
// {
//   name: 'Tempoloop',
//   steps: [
//     { kind: 'warmup' | 'work' | 'recovery' | 'cooldown', label?: string,
//       durationS?: number, distanceM?: number, pace: [fastSecPerKm, slowSecPerKm] },
//     { kind: 'repeat', reps: 3, steps: [ ...steps without nested repeats ] },
//   ]
// }

const LABELS = { warmup: 'Opwarming', work: 'Blok', recovery: 'Rustig', cooldown: 'Cooling down' };

function mmss(secPerKm) {
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function duration(step) {
  if (step.distanceM) {
    return step.distanceM % 1000 === 0 ? `${step.distanceM / 1000}km` : `${Math.round(step.distanceM)}mtr`;
  }
  const total = Math.round(step.durationS);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m ? `${m}m` : ''}${s ? `${s}s` : ''}` || '1m';
}

function paceTarget([fast, slow]) {
  if (!slow || Math.round(fast) === Math.round(slow)) return `${mmss(fast)}/km Pace`;
  return `${mmss(fast)}/km-${mmss(slow)}/km Pace`;
}

// Tells Garmin which steps are warm-up and cool-down (shown as such on the watch).
const INTENSITY = { warmup: ' intensity=warmup', cooldown: ' intensity=cooldown' };

function stepLine(step) {
  const label = step.label || LABELS[step.kind] || '';
  return `- ${label} ${duration(step)} ${paceTarget(step.pace)}${INTENSITY[step.kind] || ''}`.replace(/\s+/g, ' ');
}

/** Workout -> Intervals.icu description text. Repeats get blank lines around them. */
export function toIntervalsText(workout) {
  const blocks = workout.steps.map((step) => {
    if (step.kind === 'repeat') {
      return `\n${step.label ? `${step.label} ` : ''}${step.reps}x\n${step.steps.map(stepLine).join('\n')}\n`;
    }
    return stepLine(step);
  });
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Total planned duration in seconds (distance steps estimated at their slow pace). */
export function totalDurationS(workout) {
  const stepS = (s) => (s.durationS ? s.durationS : (s.distanceM / 1000) * (s.pace[1] || s.pace[0]));
  return Math.round(
    workout.steps.reduce(
      (sum, s) => sum + (s.kind === 'repeat' ? s.reps * s.steps.reduce((a, x) => a + stepS(x), 0) : stepS(s)),
      0
    )
  );
}
