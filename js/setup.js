// Goal and availability setup screen (#/doel).
// Edits a draft copy of the profile; the coach preview updates live,
// and nothing is stored until the user taps "Opslaan".

import { esc, formatPace, zonesTable, FEASIBILITY_TEXT, showToast } from './ui.js';
import {
  GOAL_TYPES,
  LEVEL_DISTANCES,
  WEEKDAYS,
  defaultProfile,
  saveProfile,
  analyse,
  validate,
  formatRaceTime,
  isoDate,
} from './profile.js';

let draft = null;

const clone = (o) => JSON.parse(JSON.stringify(o));

function seg(name, options, selected) {
  const buttons = options
    .map(
      ([value, label]) =>
        `<button type="button" data-seg="${name}" data-value="${esc(value)}" aria-pressed="${String(value) === String(selected)}">${esc(label)}</button>`
    )
    .join('');
  return `<div class="seg" role="group">${buttons}</div>`;
}

function dayChips(name, selected, multi) {
  const chips = WEEKDAYS.map((d, i) => {
    const on = multi ? selected.includes(i) : selected === i;
    return `<button type="button" class="chip" data-chip="${name}" data-day="${i}" aria-pressed="${on}">${d}</button>`;
  }).join('');
  return `<div class="chips" role="group">${chips}</div>`;
}

function timeInputs(name, totalS) {
  const s = Math.round(totalS || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const box = (part, label, value, max) =>
    `<label>${label}<input class="input" type="number" inputmode="numeric" min="0" max="${max}" data-time="${name}" data-part="${part}" value="${value}"></label>`;
  return `<div class="time-inputs">${box('h', 'uur', h, 9)}${box('m', 'min', m, 59)}${box('s', 'sec', sec, 59)}</div>`;
}

function readTime(root, name) {
  const val = (part) => Number(root.querySelector(`[data-time="${name}"][data-part="${part}"]`).value) || 0;
  return val('h') * 3600 + val('m') * 60 + val('s');
}

function previewHtml() {
  const errors = validate(draft);
  if (errors.length) {
    return `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  }
  const a = analyse(draft);
  let note = '';
  if (a.feasibility) {
    const [title, text] = FEASIBILITY_TEXT[a.feasibility.level];
    note = `<div class="note note--${a.feasibility.level}"><strong>${esc(title)}</strong>${esc(text)}</div>`;
  } else {
    note = `<div class="note note--realistic"><strong>Afstand uitlopen</strong>Pace bouwt je duurvermogen op zodat je de afstand comfortabel uitloopt.</div>`;
  }
  return `
    <div class="stats" style="margin-top:0">
      <div><div class="stat__value">${a.predictedNowS ? formatRaceTime(a.predictedNowS) : '–'}</div><div class="stat__label">Nu voorspeld</div></div>
      <div><div class="stat__value">${a.goalPaceS ? formatPace(a.goalPaceS) : '–'}</div><div class="stat__label">Doeltempo /km</div></div>
      <div><div class="stat__value">${a.weeks}</div><div class="stat__label">Weken</div></div>
    </div>
    <hr class="divider">
    ${note}
    <hr class="divider">
    <div class="card__eyebrow">Je tempozones nu</div>
    ${zonesTable(a.zones)}`;
}

function formHtml() {
  const g = draft.goal;
  const l = draft.level;
  const av = draft.availability;
  const today = isoDate(new Date());
  return `
    <p class="section-label">Je doel</p>
    <section class="card">
      <div class="field">
        <span class="field__label">Afstand</span>
        ${seg('goal.type', GOAL_TYPES.map((t) => [t.id, t.label]), g.type)}
        <input class="input" type="number" inputmode="decimal" step="0.1" min="1" placeholder="Afstand in km"
          data-field="goal.customDistanceKm" value="${g.customDistanceKm ?? ''}" ${g.type === 'custom' ? '' : 'hidden'}>
      </div>
      <div class="field">
        <span class="field__label">Soort doel</span>
        ${seg('goal.mode', [['time', 'Met doeltijd'], ['finish', 'Afstand uitlopen']], g.mode)}
      </div>
      <div class="field" ${g.mode === 'time' ? '' : 'hidden'} data-show="time">
        <span class="field__label">Doeltijd</span>
        ${timeInputs('goal', g.targetTimeS)}
      </div>
      <div class="field">
        <span class="field__label">Doeldatum</span>
        <input class="input" type="date" min="${today}" data-field="goal.date" value="${esc(g.date)}">
        <span class="field__hint">Wedstrijd- of streefdatum. Je kan ze altijd later aanpassen.</span>
      </div>
    </section>

    <p class="section-label">Je huidig niveau</p>
    <section class="card">
      <div class="field">
        <span class="field__label">Recente wedstrijd of testloop</span>
        ${seg('level.distance', LEVEL_DISTANCES.map((t) => [t.id, t.label]), l.distance)}
        <input class="input" type="number" inputmode="decimal" step="0.1" min="1" placeholder="Afstand in km"
          data-field="level.customDistanceKm" value="${l.customDistanceKm ?? ''}" ${l.distance === 'custom' ? '' : 'hidden'}>
      </div>
      <div class="field">
        <span class="field__label">Tijd</span>
        ${timeInputs('level', l.timeS)}
        <span class="field__hint">Een loop waarbij je stevig doorliep, liefst van de laatste 6 weken.</span>
      </div>
      <div class="field">
        <span class="field__label">Hoeveel km loop je nu per week?</span>
        <input class="input" type="number" inputmode="numeric" min="0" max="200" data-field="level.weeklyKm" value="${l.weeklyKm ?? ''}">
        <span class="field__hint">Pace bouwt van hieruit rustig op, met maximaal 10% per week.</span>
      </div>
    </section>

    <p class="section-label">Je trainingsweek</p>
    <section class="card">
      <div class="field">
        <span class="field__label">Trainingsdagen per week</span>
        ${seg('availability.daysPerWeek', [2, 3, 4, 5, 6, 7].map((n) => [n, String(n)]), av.daysPerWeek)}
      </div>
      <div class="field">
        <span class="field__label">Voorkeursdagen</span>
        ${dayChips('preferredDays', av.preferredDays, true)}
        <span class="field__hint">Niets aangeduid betekent geen vaste dagen: Pace stelt dagen voor en jij schuift ze per week.</span>
      </div>
      <div class="field">
        <span class="field__label">Dag voor de lange duurloop</span>
        ${dayChips('longRunDay', av.longRunDay, false)}
        <span class="field__hint">Niets aangeduid betekent dat Pace kiest.</span>
      </div>
      <div class="field">
        <span class="field__label">Maximale duur op weekdagen</span>
        ${seg('availability.maxWeekdayMin', [['', 'Geen'], [45, '45 min'], [60, '60 min'], [75, '75 min'], [90, '90 min']], av.maxWeekdayMin ?? '')}
      </div>
    </section>

    <p class="section-label">Wat de coach ervan denkt</p>
    <section class="card" id="preview">${previewHtml()}</section>

    <div class="sticky-save">
      <button class="btn" type="button" id="save">Opslaan</button>
    </div>`;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function refreshPreview(root) {
  root.querySelector('#preview').innerHTML = previewHtml();
}

export const setupView = {
  title: 'Doel',
  tab: 'profiel',

  html({ profile }) {
    draft = clone(profile || defaultProfile());
    return formHtml();
  },

  mount(root) {
    root.addEventListener('click', async (e) => {
      const segBtn = e.target.closest('[data-seg]');
      if (segBtn) {
        const path = segBtn.dataset.seg;
        const raw = segBtn.dataset.value;
        const numeric = path === 'availability.daysPerWeek' || path === 'availability.maxWeekdayMin';
        const value = numeric ? (raw === '' ? null : Number(raw)) : raw;
        setPath(draft, path, value);
        for (const b of segBtn.parentElement.children) b.setAttribute('aria-pressed', String(b === segBtn));

        if (path === 'goal.type') root.querySelector('[data-field="goal.customDistanceKm"]').hidden = value !== 'custom';
        if (path === 'level.distance') root.querySelector('[data-field="level.customDistanceKm"]').hidden = value !== 'custom';
        if (path === 'goal.mode') root.querySelector('[data-show="time"]').hidden = value !== 'time';
        refreshPreview(root);
        return;
      }

      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const day = Number(chip.dataset.day);
        const av = draft.availability;
        if (chip.dataset.chip === 'preferredDays') {
          av.preferredDays = av.preferredDays.includes(day)
            ? av.preferredDays.filter((d) => d !== day)
            : [...av.preferredDays, day].sort((a, b) => a - b);
          chip.setAttribute('aria-pressed', String(av.preferredDays.includes(day)));
        } else {
          av.longRunDay = av.longRunDay === day ? null : day;
          for (const c of chip.parentElement.children) {
            c.setAttribute('aria-pressed', String(Number(c.dataset.day) === av.longRunDay));
          }
        }
        refreshPreview(root);
        return;
      }

      if (e.target.closest('#save')) {
        const errors = validate(draft);
        if (errors.length) {
          refreshPreview(root);
          root.querySelector('#preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
          showToast(errors[0]);
          return;
        }
        await saveProfile(draft);
        showToast('Doel opgeslagen');
        location.hash = '#/profiel';
      }
    });

    root.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.time) {
        const total = readTime(root, el.dataset.time);
        if (el.dataset.time === 'goal') draft.goal.targetTimeS = total;
        else draft.level.timeS = total;
      } else if (el.dataset.field) {
        const isDate = el.type === 'date';
        setPath(draft, el.dataset.field, isDate ? el.value : el.value === '' ? null : Number(el.value));
      } else {
        return;
      }
      refreshPreview(root);
    });
  },
};
