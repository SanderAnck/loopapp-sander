// Knee circuit for runner's knee (patellofemoral pain): hip and thigh
// strength, about 10 minutes, twice a week on rest days. Levels go up
// when sessions are done without knee pain and down after clear pain.

import { db } from '../db.js';

export const STRENGTH_KEY = 'strength';
export const SESSIONS_PER_WEEK = 2;

export const LEVELS = {
  1: { label: 'Basis', text: 'Rustig beginnen: de spieren rond heup en knie leren aanspannen.' },
  2: { label: 'Opbouw', text: 'Meer belasting en oefeningen op één been, zoals bij het lopen.' },
  3: { label: 'Sterk', text: 'Zwaarder en stabieler, zodat je knie de opbouw naar je doel aankan.' },
};

/** Exercises per level. kneeLoad: true = skip or make smaller with knee pain. */
const EX = {
  clamshell: { name: 'Clamshell', how: 'Op je zij, knieën gebogen, voeten tegen elkaar. Bovenste knie open en dicht, bekken blijft stil.', why: 'Sterke heupdraaiers houden je knie recht boven je voet.' },
  bandClamshell: { name: 'Clamshell met elastiek', how: 'Zoals de clamshell, met een weerstandsband net boven je knieën. Langzaam terug.', why: 'Meer weerstand voor je bilspier aan de zijkant.' },
  sideLegRaise: { name: 'Zijwaartse beenheffing', how: 'Op je zij, onderste been gebogen. Bovenste been gestrekt schuin naar achter optillen, tenen naar voor.', why: 'Traint de middelste bilspier, je belangrijkste kniebeschermer.' },
  bridge: { name: 'Bruggetje', how: 'Op je rug, voeten plat. Billen optillen tot een rechte lijn van knie tot schouder, 2 tellen vasthouden.', why: 'Sterke bilspieren nemen werk over van je knie.' },
  singleBridge: { name: 'Bruggetje op één been', how: 'Zoals het bruggetje, met één been gestrekt in de lucht. Bekken blijft horizontaal.', why: 'Zelfde werk als bij elke landing van een looppas.' },
  legRaise: { name: 'Gestrekte beenheffing', how: 'Op je rug, één knie gebogen. Ander been gestrekt, dijspier aanspannen en optillen tot kniehoogte.', why: 'Sterkt je dijspier zonder je knie te buigen.', },
  wallSit: { name: 'Muurzit', how: 'Rug tegen de muur, zak tot je knieën ongeveer 45° gebogen zijn (niet dieper). Knieën boven je voeten.', why: 'Statisch werk voor je dijspier, rustig voor je kniepees.', kneeLoad: true },
  sidePlankKnees: { name: 'Zijplank op knieën', how: 'Op je zij, steunend op elleboog en knieën. Heup optillen tot een rechte lijn.', why: 'Romp en heup stabiel, zodat je knie niet naar binnen valt.' },
  sidePlank: { name: 'Zijplank', how: 'Op elleboog en voeten, lichaam in een rechte lijn. Niet laten zakken.', why: 'Romp en heup stabiel tijdens vermoeidheid op het einde van een loop.' },
  stepDown: { name: 'Step-down (laag)', how: 'Op een lage trede (10–15 cm). Andere hiel langzaam naar de grond laten zakken, knie blijft boven je tweede teen.', why: 'Leert je knie gecontroleerd buigen, net zoals bij landen.', kneeLoad: true },
  stepDownHigh: { name: 'Step-down (hoger)', how: 'Zoals de step-down, op een hogere trede (20 cm). Traag naar beneden, 3 tellen.', why: 'Meer controle onder belasting.', kneeLoad: true },
  bandWalk: { name: 'Zijwaartse bandwandeling', how: 'Band rond je enkels, licht door de knieën. Kleine passen opzij, voeten blijven evenwijdig.', why: 'Heupspieren werken staand, zoals tijdens het lopen.' },
  splitSquat: { name: 'Split squat', how: 'Uitvalspas-houding. Achterste knie zakt naar de grond, voorste knie blijft boven je voet. Rustig.', why: 'Kracht op één been voor heuvels en de laatste kilometers.', kneeLoad: true },
  calfRaise: { name: 'Kuitheffing', how: 'Op twee voeten op je tenen, langzaam omhoog en 3 tellen naar beneden.', why: 'Sterke kuiten vangen de landing op, minder schok voor je knie.' },
  singleCalfRaise: { name: 'Kuitheffing op één been', how: 'Zoals de kuitheffing, op één been, eventueel op de rand van een trede.', why: 'Lopen is springen van één been op het andere.' },
};

const PLAN = {
  1: [
    ['clamshell', '2 × 12 per kant'],
    ['sideLegRaise', '2 × 12 per kant'],
    ['bridge', '2 × 12'],
    ['legRaise', '2 × 10 per been'],
    ['wallSit', '3 × 20 seconden'],
    ['calfRaise', '2 × 15'],
  ],
  2: [
    ['bandClamshell', '3 × 12 per kant'],
    ['singleBridge', '2 × 10 per been'],
    ['sidePlankKnees', '3 × 20 seconden per kant'],
    ['wallSit', '3 × 30 seconden'],
    ['stepDown', '2 × 8 per been'],
    ['singleCalfRaise', '2 × 12 per been'],
  ],
  3: [
    ['bandWalk', '3 × 10 passen per kant'],
    ['singleBridge', '3 × 12 per been'],
    ['sidePlank', '3 × 30 seconden per kant'],
    ['stepDownHigh', '3 × 10 per been'],
    ['splitSquat', '3 × 8 per been'],
    ['singleCalfRaise', '3 × 15 per been'],
  ],
};

const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};
const mondayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
};

export async function loadStrength() {
  return (await db.get('profile', STRENGTH_KEY)) || { id: STRENGTH_KEY, level: 1, sessions: [] };
}

/** Knee pain from the questionnaires: 'clear', 'light' or null (last 7 days). */
export function recentKneePain(checkins) {
  const since = daysAgo(7);
  const knee = checkins.filter((c) => !c.test && c.date >= since && c.pain && c.pain !== 'none' && /knie/i.test(c.painWhere || 'knie'));
  if (knee.some((c) => c.pain === 'clear')) return 'clear';
  if (knee.length) return 'light';
  return null;
}

/** Today's session: exercises adapted to knee pain. */
export function sessionFor(state, pain) {
  const level = pain === 'clear' ? Math.max(1, state.level - 1) : state.level;
  const items = PLAN[level].map(([key, dose]) => {
    const ex = EX[key];
    let note = '';
    let skip = false;
    if (ex.kneeLoad && pain === 'clear') {
      skip = true;
      note = 'Sla deze over zolang je knie pijn doet.';
    } else if (ex.kneeLoad && pain === 'light') {
      note = 'Minder diep en alleen zolang het pijnvrij is.';
    }
    return { key, ...ex, dose, note, skip };
  });
  return { level, items };
}

export function sessionsThisWeek(state) {
  const monday = mondayIso();
  return state.sessions.filter((s) => s.date >= monday).length;
}

export const doneToday = (state) => state.sessions.some((s) => s.date === isoDay(new Date()));

/** Show the circuit on Vandaag: rest day, not done today or yesterday, and week target not reached. */
export function suggestToday(state, isRestDay) {
  if (!isRestDay || doneToday(state)) return false;
  if (state.sessions.some((s) => s.date === daysAgo(1))) return false;
  return sessionsThisWeek(state) < SESSIONS_PER_WEEK;
}

/**
 * Record a finished session and decide on the level:
 * up after 4 sessions on a level without knee pain, down after clear pain.
 */
export async function finishSession(state, checkins, { hard }) {
  const pain = recentKneePain(checkins);
  const today = isoDay(new Date());
  const sessions = [...state.sessions.filter((s) => s.date !== today), { date: today, level: state.level, hard }];
  let level = state.level;
  let message = 'Goed gedaan. Twee keer per week is genoeg om je knie sterker te maken.';
  const onLevel = sessions.filter((s) => s.level === level && s.date >= (state.levelSince || '0000')).length;
  if (pain === 'clear' && level > 1) {
    level -= 1;
    message = `Je meldde deze week duidelijke kniepijn. Het circuit gaat terug naar niveau ${LEVELS[level].label}.`;
  } else if (!pain && !hard && onLevel >= 4 && level < 3) {
    level += 1;
    message = `Sterk! Na ${onLevel} keer zonder kniepijn ga je naar niveau ${LEVELS[level].label}.`;
  } else if (hard) {
    message = 'Was het te zwaar? Dan blijf je op dit niveau tot het makkelijker gaat.';
  }
  const next = { ...state, sessions: sessions.slice(-60), level, levelSince: level !== state.level ? today : state.levelSince || today };
  await db.put('profile', next);
  return { state: next, message, levelChanged: level !== state.level };
}
