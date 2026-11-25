// Heart rate settings (#/hartslag): max and resting heart rate, fetched from
// Intervals.icu when connected, and the resulting zones next to the pace zones.

import { esc, showToast, zonesTable } from './ui.js';
import { loadHr, saveHr, hrZones } from './coach/hr.js';
import { IntervalsProvider } from './sync/intervals.js';

let draft = null;

const num = (v) => {
  const n = Math.round(Number(String(v).replace(',', '.')));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function previewHtml(analysis) {
  const z = hrZones(draft);
  if (!z) return '<p class="card__text" style="margin-top:0">Vul je maximale hartslag of je leeftijd in, dan berekent Pace je zones.</p>';
  const how = z.estimated
    ? `Geschat uit je leeftijd: max. ongeveer ${z.max} bpm. Een gemeten waarde is nauwkeuriger.`
    : `Op basis van max. ${z.max} bpm${z.karvonen ? ' en je rusthartslag (hartslagreserve)' : ''}.`;
  return `<p class="card__text" style="margin-top:0">${esc(how)}</p>${zonesTable(analysis.zones, z)}`;
}

export const heartRateView = {
  title: 'Hartslag',
  tab: 'profiel',

  html() {
    return '<section class="card"><p class="card__text" style="margin-top:0">Laden…</p></section>';
  },

  async mount(root, { analysis, sync, runs }) {
    draft = await loadHr();
    const connected = sync.provider === 'intervals' && Boolean(sync.apiKey);
    const highest = Math.max(0, ...runs.filter((r) => !r.test).map((r) => r.maxHr || 0));
    const input = (id, label, value, hint, placeholder) => `
      <div class="field">
        <label class="field__label" for="${id}">${label}</label>
        <input class="input" id="${id}" type="number" inputmode="numeric" min="30" max="230" placeholder="${placeholder}" data-hr="${id}" value="${value ?? ''}">
        <span class="field__hint">${hint}</span>
      </div>`;

    root.innerHTML = `
      <a class="btn btn--ghost" href="#/profiel" style="justify-content:flex-start;padding:0 4px;width:auto">‹ Profiel</a>
      <section class="card">
        <p class="card__text" style="margin-top:0">Je horloge stuurt je op <strong>tempo</strong>. De hartslag is een controle: zit je bij een rustige loop boven je rustige zone, dan loop je te snel. Bij korte intervallen loopt je hartslag achter, kijk daar dus vooral naar je tempo.</p>
        ${connected ? '<button class="btn btn--secondary" type="button" id="fetch-hr" style="margin-top:12px">Ophalen uit Intervals.icu</button>' : ''}
      </section>
      <section class="card">
        ${input('maxHr', 'Maximale hartslag', draft.maxHr, highest ? `Hoogste in je lopen tot nu: ${highest} bpm. Je echte max ligt meestal iets hoger.` : 'Staat in Garmin Connect bij Hartslagzones. Weet je het niet, laat dit leeg.', 'bv. 190')}
        ${input('restHr', 'Rusthartslag <span class="field__hint">(optioneel)</span>', draft.restHr, 'Staat in Garmin Connect bij Hartslag, gemeten tijdens je slaap.', 'bv. 55')}
        ${input('age', 'Leeftijd <span class="field__hint">(alleen als je je max niet kent)</span>', draft.age, 'Pace schat dan je max met de formule 208 − 0,7 × leeftijd.', 'bv. 35')}
      </section>
      <p class="section-label">Je zones</p>
      <section class="card" id="hr-preview">${previewHtml(analysis)}</section>
      <div class="sticky-save"><button class="btn" type="button" id="save-hr">Opslaan</button></div>`;

    const refresh = () => (root.querySelector('#hr-preview').innerHTML = previewHtml(analysis));
    root.addEventListener('input', (e) => {
      const key = e.target.dataset.hr;
      if (!key) return;
      draft[key] = num(e.target.value);
      if (key !== 'age') draft.source = 'manual';
      refresh();
    });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'fetch-hr') {
        b.disabled = true;
        b.textContent = 'Ophalen…';
        try {
          const got = await new IntervalsProvider(sync.apiKey).fetchHeartRate();
          if (!got.maxHr && !got.restHr) {
            showToast('Intervals.icu kent je hartslag nog niet. Vul ze hier zelf in.');
          } else {
            if (got.maxHr) draft.maxHr = got.maxHr;
            if (got.restHr) draft.restHr = got.restHr;
            draft.source = 'intervals';
            root.querySelector('#maxHr').value = draft.maxHr ?? '';
            root.querySelector('#restHr').value = draft.restHr ?? '';
            refresh();
            showToast('Opgehaald. Kijk het na en tik op Opslaan.');
          }
        } catch (err) {
          showToast(err.message || 'Ophalen lukte niet.');
        }
        b.disabled = false;
        b.textContent = 'Ophalen uit Intervals.icu';
      }
      if (b.id === 'save-hr') {
        if (draft.maxHr && (draft.maxHr < 140 || draft.maxHr > 225)) return showToast('Een maximale hartslag ligt meestal tussen 140 en 225.');
        if (draft.restHr && (draft.restHr < 30 || draft.restHr > 100)) return showToast('Een rusthartslag ligt meestal tussen 30 en 100.');
        await saveHr(draft);
        showToast('Hartslag opgeslagen.');
        location.hash = '#/profiel';
      }
    });
  },
};
