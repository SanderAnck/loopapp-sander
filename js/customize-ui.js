// Slider panel on the training screen to make one workout lighter or harder.

import { db } from './db.js';
import { esc, formatPace, showToast } from './ui.js';
import { pushUpcoming } from './plan.js';
import { customizeWorkout, judgeChange, VOLUME_RANGE, PACE_RANGE } from './coach/customize.js';

const VERDICT_CLASS = { ok: 'realistic', lighter: 'realistic', pittig: 'ambitious', 'te-zwaar': 'very-ambitious' };

const volumeText = (v) => (v === 0 ? 'zoals gepland' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`);
const paceText = (p) => (p === 0 ? 'zoals gepland' : `${Math.abs(p)} s/km ${p < 0 ? 'sneller' : 'trager'}`);

function mainPace(w) {
  const find = (steps) => {
    for (const s of steps) {
      if (s.kind === 'repeat') {
        const x = s.steps.find((y) => y.kind === 'work');
        if (x) return x.pace;
      }
    }
    return (steps.find((s) => s.kind === 'work' || s.kind === 'steady') || steps[0]).pace;
  };
  const p = find(w.steps);
  return p ? `${formatPace(p[1])}–${formatPace(p[0])}` : '–';
}

export const canCustomize = (w, today = new Date().toISOString().slice(0, 10)) =>
  w.status === 'planned' && w.type !== 'race' && w.date >= today && !w.test;

export function customizePanelHtml(w) {
  const c = w.custom || { volumePct: 0, paceS: 0 };
  // Slider for pace runs from slower (left) to faster (right), so it is inverted.
  return `
    <div class="card__eyebrow">Pimp je training</div>
    <p class="card__text" style="margin-top:0">Zin in meer, of net minder? Pas deze ene training aan. De rest van je schema blijft zoals het is.</p>
    <div class="field">
      <label class="field__label" for="cz-vol">Afstand / herhalingen <span class="cz__val" id="cz-vol-val">${volumeText(c.volumePct)}</span></label>
      <input class="range" type="range" id="cz-vol" min="${VOLUME_RANGE.min}" max="${VOLUME_RANGE.max}" step="${VOLUME_RANGE.step}" value="${c.volumePct}">
      <div class="range__ends"><span>Lichter</span><span>Langer</span></div>
    </div>
    <div class="field">
      <label class="field__label" for="cz-pace">Tempo <span class="cz__val" id="cz-pace-val">${paceText(c.paceS)}</span></label>
      <input class="range" type="range" id="cz-pace" min="${-PACE_RANGE.max}" max="${-PACE_RANGE.min}" step="${PACE_RANGE.step}" value="${-c.paceS}">
      <div class="range__ends"><span>Trager</span><span>Sneller</span></div>
    </div>
    <div class="stats" id="cz-stats"></div>
    <div id="cz-verdict" style="margin-top:12px"></div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn--secondary" type="button" id="cz-reset">Terug naar plan</button>
      <button class="btn" type="button" id="cz-save">Opslaan</button>
    </div>`;
}

export function mountCustomizePanel(root, w, ctx) {
  const vol = root.querySelector('#cz-vol');
  const pace = root.querySelector('#cz-pace');
  const save = root.querySelector('#cz-save');
  const planned = w;
  let changed = w;
  let verdict = null;

  const update = () => {
    const opts = { volumePct: Number(vol.value), paceS: -Number(pace.value) };
    changed = customizeWorkout(w, opts);
    verdict = judgeChange(planned, changed, opts, ctx);
    root.querySelector('#cz-vol-val').textContent = volumeText(opts.volumePct);
    root.querySelector('#cz-pace-val').textContent = paceText(opts.paceS);
    root.querySelector('#cz-stats').innerHTML = `
      <div><div class="stat__value">${changed.km.toLocaleString('nl-BE', { maximumFractionDigits: 1 })}<span class="stat__unit">km</span></div><div class="stat__label">Afstand (ca.)</div></div>
      <div><div class="stat__value">${Math.round(changed.durationS / 60)}<span class="stat__unit">min</span></div><div class="stat__label">Duur (ca.)</div></div>
      <div><div class="stat__value" style="font-size:20px">${mainPace(changed)}</div><div class="stat__label">Hoofdtempo /km</div></div>`;
    root.querySelector('#cz-verdict').innerHTML = `<div class="note note--${VERDICT_CLASS[verdict.level]}"><strong>Coach: ${esc(verdict.title)}</strong>${verdict.reasons.map(esc).join(' ')}</div>`;
    save.textContent = verdict.level === 'te-zwaar' ? 'Toch opslaan' : 'Opslaan';
    save.classList.toggle('btn--secondary', verdict.level === 'te-zwaar');
  };
  vol.addEventListener('input', update);
  pace.addEventListener('input', update);
  update();

  const store = async (next, message) => {
    save.disabled = true;
    await db.put('workouts', next);
    try {
      await pushUpcoming();
    } catch (err) {
      console.warn('Push after customize failed', err);
    }
    showToast(message);
    if (location.hash.endsWith('/aanpassen')) location.hash = `#/training/${encodeURIComponent(w.id)}`;
    else window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  save.addEventListener('click', () => {
    const next = { ...changed };
    if (next.custom) next.custom = { ...next.custom, verdict: verdict.level };
    store(next, next.custom ? 'Aangepast. Je horloge krijgt de nieuwe versie.' : 'Training staat terug zoals gepland.');
  });
  root.querySelector('#cz-reset').addEventListener('click', () => {
    vol.value = 0;
    pace.value = 0;
    update();
  });
}
