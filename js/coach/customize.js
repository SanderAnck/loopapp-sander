// "Pimp je training": change one planned workout's volume and pace with two
// sliders, and let the coach judge the change (ok / pittig / te zwaar).
// Only this workout changes; the rest of the plan stays as it is.

import { estimateKm, HARD_TYPES } from './planner.js';
import { totalDurationS } from '../sync/workout-text.js';
import { isQuality, expectedRpe } from './adapt.js';

export const VOLUME_RANGE = { min: -20, max: 40, step: 5 }; // % of the main part
export const PACE_RANGE = { min: -12, max: 10, step: 2 }; // s/km, negative = faster

const EASY_TYPES = new Set(['easy', 'recovery', 'long']);
const roundTo = (x, step) => Math.round(x / step) * step;

// The version before your own changes (may already contain coach adjustments).
const baseSteps = (w) => w.customBase || w.steps;

/** Apply volume % and pace shift to the original (planned) version of a workout. */
export function customizeWorkout(w, { volumePct = 0, paceS = 0 }) {
  const base = JSON.parse(JSON.stringify(baseSteps(w)));
  const f = 1 + volumePct / 100;
  const quality = isQuality(w);
  const scaleStep = (s) => {
    if (s.distanceM) s.distanceM = Math.max(500, roundTo(s.distanceM * f, s.distanceM >= 2000 ? 500 : 100));
    else if (s.durationS) s.durationS = Math.max(60, roundTo(s.durationS * f, s.durationS >= 600 ? 60 : 15));
  };
  const shift = (s) => {
    if (s.pace) s.pace = [s.pace[0] + paceS, s.pace[1] + paceS];
  };
  const hasRepeat = base.some((s) => s.kind === 'repeat');
  for (const s of base) {
    if (s.kind === 'warmup' || s.kind === 'cooldown') continue;
    if (s.kind === 'repeat') {
      if (quality) {
        // More or fewer repetitions; strides in an easy run stay as they are.
        s.reps = Math.max(1, Math.round(s.reps * f));
        for (const x of s.steps) if (x.kind === 'work') shift(x);
      }
      continue;
    }
    if (s.kind === 'work' || s.kind === 'steady') {
      if (!(quality && hasRepeat)) scaleStep(s);
      shift(s);
    }
  }
  const next = { ...w, steps: base, customBase: baseSteps(w) };
  if (!volumePct && !paceS) {
    next.steps = baseSteps(w);
    delete next.custom;
    delete next.customBase;
  } else {
    next.custom = { volumePct, paceS, at: new Date().toISOString() };
  }
  next.km = estimateKm(next);
  next.durationS = totalDurationS(next);
  return next;
}

const prevWeekStart = (start) => {
  const d = new Date(`${start}T12:00:00`);
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
};

/**
 * The coach's verdict on a change. Returns { level: 'ok'|'lighter'|'pittig'|'te-zwaar', title, reasons[] }.
 * ctx: { workouts, plan, checkins, runs }
 */
export function judgeChange(planned, changed, { volumePct, paceS }, ctx) {
  const reasons = [];
  let score = 0; // 0 ok, 1 pittig, 2 te zwaar
  const bump = (lvl, text) => {
    score = Math.max(score, lvl);
    reasons.push({ lvl, text });
  };
  const harder = volumePct > 0 || paceS < 0;
  if (!volumePct && !paceS) return { level: 'ok', title: 'Zoals gepland', reasons: ['Dit is de training zoals de coach ze plande.'] };
  if (!harder) {
    return {
      level: 'lighter',
      title: 'Prima, luister naar je lichaam',
      reasons: ['Een lichtere dag kost je niets. Regelmatig trainen is belangrijker dan elke training volledig afwerken.'],
    };
  }

  const type = planned.type;
  const week = ctx.plan?.weeks.find((wk) => wk.start <= planned.date && planned.date < nextWeek(wk.start));

  // Pain first: the knee decides.
  const recent = (ctx.checkins || []).filter((c) => !c.test && c.date >= daysAgo(7));
  if (recent.some((c) => c.pain === 'clear')) bump(2, 'Je meldde deze week duidelijke pijn. Nu zwaarder trainen vergroot de kans op een blessure.');
  else if (recent.some((c) => c.pain === 'light')) bump(1, 'Je had deze week lichte pijn. Verhoog alleen als het vandaag echt pijnvrij voelt.');

  // Pace.
  if (EASY_TYPES.has(type) && paceS < 0) {
    if (paceS <= -8) bump(2, 'Dit is geen rustige loop meer. Rustige lopen bouwen je duurvermogen op juist omdat ze rustig zijn.');
    else if (paceS <= -4) bump(1, 'Sneller dan rustig tempo maakt je herstel trager, waardoor je volgende stevige training minder goed gaat.');
  }
  if (isQuality(planned) && paceS < 0) {
    if (paceS <= -9) bump(2, 'Zo veel sneller verandert het soort training: het wordt een andere, zwaardere prikkel dan bedoeld.');
    else if (paceS <= -5) bump(1, 'Pittig sneller. Kan op een goede dag, maar houd het tempo constant tot het laatste blok.');
  }

  // Volume.
  if (volumePct > 0) {
    if (type === 'long') {
      if (volumePct >= 30) bump(2, 'De lange duurloop groeit best met hoogstens 10 à 15% per keer. Dit is te veel ineens.');
      else if (volumePct >= 15) bump(1, 'Een flink stuk langer dan gepland. Kan, als je je fris voelt en de volgende dagen rustig houdt.');
    } else if (isQuality(planned)) {
      if (volumePct >= 30) bump(2, 'Zoveel extra herhalingen maakt deze training zwaarder dan je lichaam nu kan verwerken.');
      else if (volumePct >= 15) bump(1, 'Een herhaling extra is pittig. Stop als je het tempo niet meer haalt.');
    } else if (volumePct >= 30) bump(1, 'Een stuk langer. Prima als het echt rustig blijft.');
  }
  if (volumePct >= 15 && paceS <= -4 && (HARD_TYPES.has(type) || type === 'long')) bump(2, 'Langer én sneller tegelijk is de snelste weg naar overbelasting. Kies één van de twee.');

  // Week volume against last week (10% rule).
  if (week && ctx.plan) {
    const ws = ctx.workouts.filter((w) => w.date >= week.start && w.date < nextWeek(week.start) && !['cancelled', 'skipped', 'missed'].includes(w.status) && !w.test);
    const newWeekKm = ws.reduce((a, w) => a + (w.id === planned.id ? changed.km : w.km), 0);
    const prev = ctx.plan.weeks.find((wk) => wk.start === prevWeekStart(week.start));
    const prevRun = ctx.runs?.filter((r) => !r.test && prev && r.date >= prev.start && r.date < week.start).reduce((a, r) => a + (r.distanceM || 0) / 1000, 0);
    const ref = Math.max(prev?.plannedKm || 0, prevRun || 0);
    if (ref > 0) {
      const ratio = newWeekKm / ref;
      if (ratio > 1.25) bump(2, `Je week komt dan op ${fmtKm(newWeekKm)} km, ${Math.round((ratio - 1) * 100)}% meer dan vorige week. Hoogstens 10% per week is veilig voor je knie.`);
      else if (ratio > 1.12) bump(1, `Je week komt op ${fmtKm(newWeekKm)} km, iets meer dan de 10% regel.`);
    }
    if (week.recovery) bump(1, 'Dit is een herstelweek: bewust lichter, zodat je sterker uit de vorige weken komt.');
  }

  // Tired lately?
  const q = recent.filter((c) => c.rpe && c.type).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (q && q.rpe >= expectedRpe({ type: q.type }) + 2) bump(1, 'Je vorige training voelde zwaarder dan bedoeld. Kijk of je vandaag echt fris bent.');
  const day = (n) => addDays(planned.date, n);
  const neighbours = ctx.workouts.filter((w) => (w.date === day(-1) || w.date === day(1)) && HARD_TYPES.has(w.type) && !['cancelled', 'skipped', 'missed'].includes(w.status));
  if (neighbours.length && volumePct >= 15) bump(1, 'Er staat een stevige training vlak voor of na deze dag. Houd daar rekening mee.');

  const sorted = reasons.sort((a, b) => b.lvl - a.lvl).map((r) => r.text);
  if (!sorted.length) sorted.push(volumePct > 0 && paceS < 0 ? 'Iets langer en iets sneller, binnen veilige grenzen. Goed gevoel? Ga ervoor.' : volumePct > 0 ? 'Iets langer, binnen veilige grenzen. Veel plezier!' : 'Iets sneller, binnen veilige grenzen. Mooi.');
  const level = ['ok', 'pittig', 'te-zwaar'][score];
  const title = { ok: 'Dit is ok', pittig: 'Pittig, maar kan', 'te-zwaar': 'Te zwaar' }[level];
  return { level, title, reasons: sorted };
}

function nextWeek(start) {
  return addDays(start, 7);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const fmtKm = (x) => x.toLocaleString('nl-BE', { maximumFractionDigits: 1 });

/** Fast end of the main (non warm-up) block. */
function mainPace(w) {
  const s = w.steps.find((x) => x.kind === 'work' || x.kind === 'steady');
  return s?.pace?.[0] || null;
}
