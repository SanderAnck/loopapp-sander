// After-run flow: enter the run (pre-filled from the plan or from the watch),
// answer the 30-second questionnaire, and see what the coach adjusts.

import { db } from './db.js';
import { esc, formatPace, showToast } from './ui.js';
import { formatRaceTime, isoDate } from './profile.js';
import { adapt, isQuality, shiftPaces } from './coach/adapt.js';
import { estimateKm } from './coach/planner.js';
import { totalDurationS } from './sync/workout-text.js';
import { activeProvider } from './sync/provider.js';
import { pushUpcoming } from './plan.js';
import { dayLabel } from './workout-ui.js';
import { applyFitnessCorrection, computeFitness } from './fitness-service.js';
import { loadHr, hrZones } from './coach/hr.js';
import { goalDistanceM } from './profile.js';
import { predictRaceTime } from './coach/vdot.js';

const PAIN_PLACES = ['Knie links', 'Knie rechts', 'Kuit', 'Scheen', 'Voet', 'Heup', 'Anders'];
const RESULT_BADGE = {
  gehaald: 'badge--good',
  'te snel': 'badge--accent',
  'te traag': 'badge--accent',
  deels: '',
  afgebroken: '',
};

let form = null;

function seg(name, options, selected) {
  return `<div class="seg" role="group">${options
    .map(([v, l]) => `<button type="button" data-seg="${name}" data-value="${esc(v)}" aria-pressed="${String(v) === String(selected)}">${esc(l)}</button>`)
    .join('')}</div>`;
}

function timeInputs(totalS) {
  const s = Math.round(totalS || 0);
  const box = (part, label, value, max) =>
    `<label>${label}<input class="input" type="number" inputmode="numeric" min="0" max="${max}" data-time="${part}" value="${value}"></label>`;
  return `<div class="time-inputs">${box('h', 'uur', Math.floor(s / 3600), 9)}${box('m', 'min', Math.floor((s % 3600) / 60), 59)}${box('s', 'sec', s % 60, 59)}</div>`;
}

function parsePace(text) {
  const m = /^\s*(\d{1,2})[:.,](\d{2})\s*$/.exec(text || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ---------- Entry form (#/invoer/<workoutId>) ----------

export const entryView = {
  title: 'Hoe ging het?',
  tab: 'vandaag',

  html({ workouts, runs }) {
    const id = decodeURIComponent(location.hash.split('/')[2] || '');
    const workout = workouts.find((w) => w.id === id) || null;
    const date = workout?.date || isoDate(new Date());
    const synced = runs.find((r) => r.date === date && r.source === 'intervals' && !r.needsInput);
    form = {
      workout,
      date,
      synced,
      distanceKm: synced ? Math.round(synced.distanceM / 100) / 10 : workout ? workout.km : '',
      durationS: synced ? synced.durationS : workout ? workout.durationS : 0,
      avgHr: synced?.avgHr ? Math.round(synced.avgHr) : '',
      blockPace: '',
      completion: 'full',
      rpe: null,
      energy: null,
      pain: 'none',
      painWhere: [],
      sleep: null,
      text: '',
    };
    const quality = isQuality(workout);
    return `
      <section class="card">
        <div class="card__eyebrow">${esc(dayLabel(date))}${synced ? ' <span class="badge badge--good">⌚ Van je horloge</span>' : ''}</div>
        <h2 class="card__title">${esc(workout?.name || 'Extra loop')}</h2>
        <p class="card__text">${synced ? 'Je loop kwam binnen via Garmin. Kijk na en vul de vragen in.' : 'Ingevuld volgens je plan. Pas aan wat anders was.'}</p>
      </section>

      <p class="section-label">Je loop</p>
      <section class="card">
        <div class="field">
          <span class="field__label">Uitgevoerd</span>
          ${seg('completion', [['full', 'Helemaal'], ['partial', 'Deels'], ['aborted', 'Afgebroken']], 'full')}
        </div>
        <div class="field">
          <label class="field__label" for="dist">Afstand (km)</label>
          <input class="input" id="dist" type="number" inputmode="decimal" step="0.01" min="0" data-field="distanceKm" value="${esc(form.distanceKm)}">
        </div>
        <div class="field">
          <span class="field__label">Tijd</span>
          ${timeInputs(form.durationS)}
        </div>
        <div class="field">
          <label class="field__label" for="hr">Gemiddelde hartslag <span class="field__hint">(optioneel)</span></label>
          <input class="input" id="hr" type="number" inputmode="numeric" min="60" max="220" placeholder="bv. 152" data-field="avgHr" value="${esc(form.avgHr)}">
        </div>
        ${quality ? `
        <div class="field">
          <label class="field__label" for="bp">Gemiddeld tempo van je blokken <span class="field__hint">(optioneel)</span></label>
          <input class="input" id="bp" type="text" inputmode="decimal" placeholder="bv. 5:35" data-field="blockPace">
          <span class="field__hint">Staat in Garmin Connect bij je ronden (laps). Zo kan de coach je tempo beoordelen.</span>
        </div>` : ''}
      </section>

      <p class="section-label">30 seconden vragen</p>
      <section class="card">
        <div class="field">
          <span class="field__label">1. Hoe zwaar voelde het?</span>
          <div class="rpe" role="group">${Array.from({ length: 10 }, (_, i) => `<button type="button" class="chip" data-rpe="${i + 1}" aria-pressed="false">${i + 1}</button>`).join('')}</div>
          <span class="field__hint">1 = heel licht · 5 = matig · 7 = zwaar · 10 = alles gegeven${workout ? ` · verwacht voor deze training: ongeveer ${esc(expectedText(workout))}` : ''}</span>
        </div>
        <div class="field">
          <span class="field__label">2. Energie vandaag?</span>
          ${seg('energy', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], '')}
          <span class="field__hint">1 = leeg · 5 = vol energie</span>
        </div>
        <div class="field">
          <span class="field__label">3. Pijn of ongemak?</span>
          ${seg('pain', [['none', 'Geen'], ['light', 'Licht'], ['clear', 'Duidelijk']], 'none')}
          <div class="chips chips--wrap" id="pain-where" hidden>${PAIN_PLACES.map((p) => `<button type="button" class="chip" data-where="${esc(p)}" aria-pressed="false">${esc(p)}</button>`).join('')}</div>
        </div>
        <div class="field">
          <span class="field__label">4. Slaap afgelopen nacht?</span>
          ${seg('sleep', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], '')}
          <span class="field__hint">1 = slecht · 5 = uitstekend</span>
        </div>
        <div class="field">
          <label class="field__label" for="note">5. Nog iets kwijt? <span class="field__hint">(optioneel)</span></label>
          <textarea class="input textarea" id="note" rows="3" data-field="text" placeholder="Bv. wind, heuvelachtig parcours, krampje..."></textarea>
        </div>
      </section>

      <div class="sticky-save"><button class="btn" type="button" id="save-run">Opslaan</button></div>`;
  },

  mount(root) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.seg) {
        const v = b.dataset.value;
        form[b.dataset.seg] = ['energy', 'sleep'].includes(b.dataset.seg) ? Number(v) : v;
        for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b));
        if (b.dataset.seg === 'pain') root.querySelector('#pain-where').hidden = v === 'none';
      } else if (b.dataset.rpe) {
        form.rpe = Number(b.dataset.rpe);
        for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b));
      } else if (b.dataset.where) {
        const p = b.dataset.where;
        form.painWhere = form.painWhere.includes(p) ? form.painWhere.filter((x) => x !== p) : [...form.painWhere, p];
        b.setAttribute('aria-pressed', String(form.painWhere.includes(p)));
      } else if (b.id === 'save-run') {
        const missing = [!form.rpe && 'hoe zwaar het voelde', !form.energy && 'je energie', !form.sleep && 'je slaap'].filter(Boolean);
        if (missing.length) return showToast(`Vul nog in: ${missing.join(', ')}.`);
        const h = (part) => Number(root.querySelector(`[data-time="${part}"]`).value) || 0;
        form.durationS = h('h') * 3600 + h('m') * 60 + h('s');
        if (!(Number(String(form.distanceKm).replace(',', '.')) > 0) || !(form.durationS > 0)) return showToast('Vul je afstand en tijd in.');
        b.disabled = true;
        b.textContent = 'De coach kijkt mee…';
        try {
          const checkinId = await saveCheckin(form);
          location.hash = `#/resultaat/${encodeURIComponent(checkinId)}`;
        } catch (err) {
          console.error(err);
          b.disabled = false;
          b.textContent = 'Opslaan';
          showToast('Opslaan lukte niet. Probeer opnieuw.');
        }
      }
    });
    root.addEventListener('input', (e) => {
      const f = e.target.dataset.field;
      if (f) form[f] = e.target.value;
    });
  },
};

function expectedText(w) {
  const map = { easy: '3–4', recovery: '3', long: '5', fartlek: '7', hills: '7–8', threshold: '7', intervals: '8', racepace: '7–8', race: '9' };
  return `${map[w.type] || '5'}/10`;
}

// ---------- Saving and applying the coach's decisions ----------

async function saveCheckin(f) {
  const today = isoDate(new Date());
  const workout = f.workout;
  const distanceM = Math.round(Number(String(f.distanceKm).replace(',', '.')) * 1000);
  const blockPaceS = parsePace(f.blockPace);

  // Run: update the synced one, or store a manual one.
  const run = f.synced
    ? { ...f.synced, distanceM, durationS: f.durationS, avgHr: Number(f.avgHr) || f.synced.avgHr, blockPaceS, workoutId: workout?.id, completion: f.completion, manualEdits: true }
    : {
        id: `manual-${f.date}-${workout?.id || Date.now()}`,
        source: 'manual',
        date: f.date,
        name: workout?.name || 'Loop',
        distanceM,
        durationS: f.durationS,
        avgHr: Number(f.avgHr) || null,
        blockPaceS,
        workoutId: workout?.id || null,
        completion: f.completion,
      };
  if (workout?.test) run.test = true;
  await db.put('runs', run);

  const checkin = {
    id: `c-${workout?.id || run.id}`,
    date: f.date,
    createdAt: new Date().toISOString(),
    workoutId: workout?.id || null,
    runId: run.id,
    type: workout?.type || null,
    rpe: f.rpe,
    energy: f.energy,
    pain: f.pain,
    painWhere: f.painWhere.join(', '),
    sleep: f.sleep,
    completion: f.completion,
    text: f.text.trim(),
    test: Boolean(workout?.test),
  };

  const [allCheckins, allWorkouts, profile] = await Promise.all([db.getAll('checkins'), db.getAll('workouts'), db.get('profile', 'me')]);
  const history = allCheckins.filter((c) => c.id !== checkin.id && !c.test).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const upcoming = allWorkouts.filter((w) => w.date > f.date).sort((a, b) => (a.date < b.date ? -1 : 1));

  const decision = adapt({ workout, run, checkin, history, upcoming, today: f.date < today ? today : f.date });
  checkin.result = decision.evaluation.result;
  checkin.evaluation = decision.evaluation;
  checkin.messages = decision.messages;
  checkin.adjustmentIds = [];

  // Mark the planned workout as done.
  if (workout) {
    const status = f.completion === 'full' ? 'done' : f.completion === 'partial' ? 'partial' : 'aborted';
    await db.put('workouts', { ...workout, status, result: decision.evaluation.result, runId: run.id });
  }

  // Apply the changes to the coming workouts.
  const removeFromWatch = [];
  for (const [i, adj] of decision.adjustments.entries()) {
    const adjId = `${checkin.id}-${i}`;
    // A test workout only shows what the coach would do.
    for (const c of checkin.test ? [] : adj.changes) {
      const current = await db.get('workouts', c.id);
      if (!current) continue;
      const note = { rule: adj.rule, title: adj.title, reason: adj.reason, at: checkin.createdAt };
      if (c.action === 'rest') {
        await db.put('workouts', { ...current, status: 'cancelled', adjusted: note });
        if (current.pushedAt) removeFromWatch.push(current.id);
      } else {
        const updated = { ...c.workout, adjusted: note, original: current.original || { steps: current.steps, name: current.name, type: current.type } };
        updated.km = estimateKm(updated);
        updated.durationS = totalDurationS(updated);
        updated.why = updated.why ? { ...updated.why, reasons: [`Aangepast door de coach: ${adj.reason}`, ...updated.why.reasons] } : updated.why;
        await db.put('workouts', updated);
      }
    }
    await db.put('adjustments', { id: adjId, date: f.date, checkinId: checkin.id, ...adj, changes: adj.changes.map((c) => ({ id: c.id, action: c.action })) });
    checkin.adjustmentIds.push(adjId);
  }

  // Zone change: shift every future workout and remember it for future plans.
  if (decision.paceOffsetDeltaS && profile && !checkin.test) {
    for (const w of await db.getAll('workouts')) {
      if (w.date > f.date && w.status === 'planned') await db.put('workouts', shiftPaces(w, decision.paceOffsetDeltaS));
    }
    // Written directly so the plan is not rebuilt (that would undo the adjustments).
    await db.put('profile', { ...profile, paceOffsetS: (profile.paceOffsetS || 0) + decision.paceOffsetDeltaS });
  }

  await db.put('checkins', checkin);
  if (!checkin.test) {
    try {
      const shift = await applyFitnessCorrection();
      if (shift) await db.put('checkins', { ...checkin, fitnessShiftS: shift });
    } catch (err) {
      console.warn('Fitness update failed', err);
    }
  }

  // Keep the watch in step (silently skipped without a connection).
  try {
    const provider = await activeProvider();
    if (provider.canPushWorkouts) {
      await pushUpcoming({ stale: removeFromWatch });
    }
  } catch (err) {
    console.warn('Push after check-in failed', err);
  }
  return checkin.id;
}

// ---------- Result screen (#/resultaat/<checkinId>) ----------

export const resultView = {
  title: 'Je coach',
  tab: 'vandaag',

  html() {
    return '<section class="card"><p class="card__text" style="margin-top:0">Laden…</p></section>';
  },

  async mount(root) {
    const id = decodeURIComponent(location.hash.split('/')[2] || '');
    const checkin = await db.get('checkins', id);
    if (!checkin) {
      root.innerHTML = '<section class="card empty"><h2 class="empty__title">Niet gevonden</h2><a class="btn" href="#/vandaag">Naar vandaag</a></section>';
      return;
    }
    const [run, workout, adjustments] = await Promise.all([
      db.get('runs', checkin.runId),
      checkin.workoutId ? db.get('workouts', checkin.workoutId) : null,
      Promise.all((checkin.adjustmentIds || []).map((a) => db.get('adjustments', a))),
    ]);
    const all = await db.getAll('workouts');
    const ev = checkin.evaluation;
    const pace = run?.distanceM ? formatPace(run.durationS / (run.distanceM / 1000)) : '–';
    const adjCards = adjustments
      .filter(Boolean)
      .map((a) => {
        const list = a.changes
          .map((c) => {
            const w = all.find((x) => x.id === c.id);
            if (!w) return '';
            const what = checkin.test
              ? (c.action === 'rest' ? 'zou een rustdag worden' : c.action === 'recovery' ? 'zou een korte herstelloop worden' : 'zou lichter worden')
              : (c.action === 'rest' ? 'wordt een rustdag' : c.action === 'recovery' ? 'wordt een korte herstelloop' : 'wordt lichter');
            return `<li><a href="#/training/${esc(w.id)}">${esc(dayLabel(w.date))}: ${esc((w.original?.name || w.name))}</a> ${what}</li>`;
          })
          .join('');
        return `
          <section class="card">
            <div class="card__eyebrow"><span class="badge badge--accent">${checkin.test ? 'Voorbeeld' : 'Aangepast'}</span></div>
            <h2 class="card__title">${esc(a.title)}</h2>
            <p class="card__text">${esc(a.reason)}</p>
            ${list ? `<ul class="why__list" style="margin-top:8px">${list}</ul>` : ''}
          </section>`;
      })
      .join('');
    // Fitness after this run.
    let fitnessCard = '';
    const [profile, plan, runs, checkins, hr] = await Promise.all([db.get('profile', 'me'), db.get('plan', 'current'), db.getAll('runs'), db.getAll('checkins'), loadHr()]);
    const fit = profile ? computeFitness({ profile, plan, runs, checkins, hrz: hrZones(hr) }) : null;
    if (fit && !checkin.test) {
      const predicted = goalDistanceM(profile) ? formatRaceTime(predictRaceTime(fit.vdot, goalDistanceM(profile))) : null;
      const shift = checkin.fitnessShiftS;
      fitnessCard = `<section class="card"><div class="card__eyebrow">Je fitheid</div>
        <p class="card__text" style="margin-top:0">Fitheid nu: <strong>VDOT ${fit.vdot.toFixed(1).replace('.', ',')}</strong>${predicted ? `, voorspelde eindtijd <strong>${predicted}</strong>` : ''}.
        ${shift ? ` Je tempo's voor de komende trainingen zijn ${Math.abs(shift)} s/km ${shift < 0 ? 'sneller' : 'trager'} gezet.` : ''}</p></section>`;
    }
    const msgCards = (checkin.messages || [])
      .map((m) => `<section class="card"><div class="note note--ambitious">${esc(m)}</div></section>`)
      .join('');

    root.innerHTML = `
      <section class="card">
        <div class="card__eyebrow">${esc(workout?.original?.name || workout?.name || 'Loop')} <span class="badge ${RESULT_BADGE[ev.result] || ''}">${esc(ev.result)}</span></div>
        <div class="stats">
          <div><div class="stat__value">${run?.distanceM ? (run.distanceM / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 2 }) : '–'}<span class="stat__unit">km</span></div><div class="stat__label">Afstand</div></div>
          <div><div class="stat__value">${run?.durationS ? formatRaceTime(run.durationS) : '–'}</div><div class="stat__label">Tijd</div></div>
          <div><div class="stat__value">${pace}</div><div class="stat__label">Gem. tempo /km</div></div>
        </div>
        <p class="card__text" style="margin-top:12px">${esc(ev.text)} Gevoel: ${checkin.rpe}/10.</p>
      </section>
      <p class="section-label">Wat de coach doet</p>
      ${checkin.test ? '<section class="card"><div class="note note--ambitious"><strong>Testtraining</strong>Bij een echte training zou de coach het volgende doen. Je echte schema blijft nu ongewijzigd.</div></section>' : ''}
      ${adjCards || '<section class="card"><div class="note note--realistic"><strong>Alles volgens plan</strong>Je schema blijft zoals het is. Goed bezig!</div></section>'}
      ${msgCards}
      ${fitnessCard}
      ${checkin.test ? '<button class="btn btn--secondary" type="button" id="retest" style="margin-bottom:12px">Opnieuw testen met andere antwoorden</button>' : ''}
      <a class="btn" href="#/vandaag">Klaar</a>`;

    root.querySelector('#retest')?.addEventListener('click', async () => {
      // Put the test workout back to 'planned' and forget this test entry.
      if (workout) await db.put('workouts', { ...workout, status: 'planned', result: undefined, runId: undefined });
      for (const a of checkin.adjustmentIds || []) await db.delete('adjustments', a);
      if (run) await db.delete('runs', run.id);
      await db.delete('checkins', checkin.id);
      location.hash = `#/invoer/${encodeURIComponent(checkin.workoutId)}`;
    });
  },
};
