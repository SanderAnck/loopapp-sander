// Fitness that grows with your runs: estimates your current VDOT from the
// runs you log (pace + heart rate, or pace + how hard it felt), blends that
// with your starting level, and nudges future paces when you are clearly
// ahead of or behind the plan.

import { oxygenCost, sustainableFraction, paceZones } from './vdot.js';

const DAY = 24 * 3600 * 1000;
const HALF_LIFE_DAYS = 21; // recent runs count most
const BASELINE_WEIGHT = 1.5; // the level you entered keeps some weight
const SKIP_TYPES = new Set(['hills']); // pace on slopes says little about fitness
const MIXED_TYPES = new Set(['intervals', 'fartlek']); // average pace mixes fast and slow

/** RPE (1–10) to approximate fraction of VO2max. */
const RPE_FRACTION = { 1: 0.55, 2: 0.58, 3: 0.62, 4: 0.67, 5: 0.72, 6: 0.77, 7: 0.82, 8: 0.87, 9: 0.92, 10: 0.97 };

const days = (a, b) => (new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / DAY;

/**
 * VDOT estimate from one run, or null when the run says too little.
 * Heart rate: % heart rate reserve ≈ % VO2max (Swain), or from % max HR.
 */
export function estimateFromRun(run, checkin, hrz, baseline) {
  if (!run || run.test || !run.distanceM || !run.durationS || run.durationS < 15 * 60) return null;
  if (checkin && checkin.completion && checkin.completion !== 'full') return null;
  const type = checkin?.type || null;
  if (type && SKIP_TYPES.has(type)) return null;
  const minutes = run.durationS / 60;
  const v = run.distanceM / minutes; // m/min
  if (v < 100 || v > 400) return null; // walking or GPS error
  const vo2 = oxygenCost(v);

  let fraction = null;
  let weight = 0;
  let method = null;
  if (run.avgHr && hrz?.max) {
    const max = hrz.max;
    const rest = hrz.rest;
    fraction = rest ? (run.avgHr - rest) / (max - rest) : (run.avgHr / max - 0.37) / 0.64;
    weight = hrz.estimated ? 0.6 : 1;
    method = 'hartslag';
  } else if (checkin?.rpe) {
    fraction = RPE_FRACTION[checkin.rpe];
    weight = 0.5;
    method = 'gevoel';
  }
  if (!fraction) return null;
  if (type && MIXED_TYPES.has(type)) weight *= 0.5;
  // You can never run above race effort for that duration.
  fraction = Math.min(Math.max(fraction, 0.55), sustainableFraction(minutes));
  const vdot = vo2 / fraction;
  if (Math.abs(vdot - baseline) > 8) return null; // implausible, ignore
  return { date: run.date, vdot, weight, method, runId: run.id };
}

/** All usable estimates, oldest first. */
export function runEstimates({ runs, checkins, hrz, baseline }) {
  const byRun = new Map(checkins.filter((c) => !c.test).map((c) => [c.runId, c]));
  return runs
    .map((r) => estimateFromRun(r, byRun.get(r.id), hrz, baseline))
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Blended fitness on a given date, using only runs up to that date. */
export function fitnessOn(date, { estimates, baseline, startDate }) {
  let sum = baseline * BASELINE_WEIGHT;
  let weights = BASELINE_WEIGHT;
  let used = 0;
  for (const e of estimates) {
    if (e.date > date) break;
    const w = e.weight * Math.pow(0.5, days(e.date, date) / HALF_LIFE_DAYS);
    sum += e.vdot * w;
    weights += w;
    used += 1;
  }
  let vdot = sum / weights;
  // Realistic bounds: fitness does not jump; at most ~0.4 VDOT gain per week.
  const weeks = Math.max(0, days(startDate, date) / 7);
  vdot = Math.min(Math.max(vdot, baseline - 3), baseline + 0.4 * weeks + 0.8);
  return { vdot, used };
}

/** Expected VDOT on a date according to the plan's progression. */
export function expectedVdot(plan, date) {
  if (!plan) return null;
  const perWeek = plan.vdotPerWeek ?? 0.2;
  const trainWeeks = plan.trainWeeks ?? plan.weeks.length;
  const w = Math.max(0, Math.min(trainWeeks, days(plan.start, date) / 7));
  return plan.startVdot + perWeek * w;
}

/** Fitness now plus a weekly series for the progress chart. */
export function estimateFitness({ profile, plan, runs, checkins, hrz, baseline, today }) {
  const startDate = (plan?.start || profile.updatedAt || today).slice(0, 10);
  const estimates = runEstimates({ runs, checkins, hrz, baseline });
  const now = fitnessOn(today, { estimates, baseline, startDate });
  const recent = estimates.filter((e) => days(e.date, today) <= 28);
  return {
    vdot: now.vdot,
    baseline,
    samples: estimates.length,
    recentSamples: recent.length,
    lastMethod: estimates.length ? estimates[estimates.length - 1].method : null,
    expected: expectedVdot(plan, today),
    estimates,
    startDate,
  };
}

/** Weekly points (end of each week up to today) for the chart. */
export function fitnessSeries(fitness, today) {
  const pts = [];
  const start = new Date(`${fitness.startDate}T12:00:00`);
  for (let d = new Date(start); ; d.setDate(d.getDate() + 7)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > today) break;
    pts.push({ date: iso, vdot: fitnessOn(iso, { estimates: fitness.estimates, baseline: fitness.baseline, startDate: fitness.startDate }).vdot });
  }
  if (!pts.length || pts[pts.length - 1].date !== today) pts.push({ date: today, vdot: fitness.vdot });
  return pts;
}

/**
 * Pace shift (s/km, negative = faster) for future workouts when fitness is
 * clearly ahead of or behind what the plan expects. Needs at least 3 recent
 * runs, ignores small differences and moves at most 6 s/km at a time.
 */
export function paceCorrection(fitness, appliedDelta = 0) {
  if (fitness.recentSamples < 3 || fitness.expected == null) return 0;
  const delta = fitness.vdot - fitness.expected; // + = fitter than planned
  if (Math.abs(delta - appliedDelta) < 0.5) return 0;
  const base = paceZones(fitness.expected).threshold[0];
  const target = paceZones(fitness.expected + delta).threshold[0];
  const before = paceZones(fitness.expected + appliedDelta).threshold[0];
  const shift = Math.round(target - before);
  return Math.max(-6, Math.min(6, shift)) || (base === target ? 0 : Math.sign(target - before));
}
