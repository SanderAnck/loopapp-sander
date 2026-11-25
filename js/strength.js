// Knee circuit screen (#/kracht): today's exercises, tick them off, finish.

import { esc, showToast } from './ui.js';
import { db } from './db.js';
import { LEVELS, SESSIONS_PER_WEEK, loadStrength, recentKneePain, sessionFor, sessionsThisWeek, doneToday, finishSession } from './coach/strength.js';

/** Card for Vandaag on a rest day. */
export function strengthCard(state, { suggested }) {
  const week = sessionsThisWeek(state);
  if (doneToday(state)) {
    return `<section class="card"><div class="card__eyebrow">Kniecircuit <span class="badge badge--good">✓ Gedaan</span></div>
      <p class="card__text" style="margin-top:0">${week} van ${SESSIONS_PER_WEEK} deze week. Goed bezig.</p></section>`;
  }
  if (!suggested) return '';
  return `<section class="card">
    <div class="card__eyebrow">Kniecircuit · ongeveer 10 min <span class="badge badge--accent">${esc(LEVELS[state.level].label)}</span></div>
    <h2 class="card__title">Sterke heupen, rustige knie</h2>
    <p class="card__text">Zes oefeningen voor je heup en bovenbeen. Dat is het beste wat je op een rustdag kan doen tegen runner's knee. ${week} van ${SESSIONS_PER_WEEK} deze week.</p>
    <a class="btn" href="#/kracht" style="margin-top:12px">Start kniecircuit</a></section>`;
}

export const strengthView = {
  title: 'Kniecircuit',
  tab: 'vandaag',

  html() {
    return '<section class="card"><p class="card__text" style="margin-top:0">Laden…</p></section>';
  },

  async mount(root, { checkins }) {
    let state = await loadStrength();
    const pain = recentKneePain(checkins);
    const session = sessionFor(state, pain);
    const ticked = new Set();
    const painNote = pain === 'clear'
      ? '<div class="note note--very-ambitious"><strong>Kniepijn deze week</strong>Het circuit is lichter en de oefeningen die je knie het meest belasten vallen weg. Stop bij pijn.</div>'
      : pain === 'light'
        ? '<div class="note note--ambitious"><strong>Lichte kniepijn deze week</strong>Doe alles pijnvrij: minder diep buigen mag altijd.</div>'
        : '';
    const rows = session.items
      .map(
        (x, i) => `<li class="ex${x.skip ? ' ex--skip' : ''}">
          <button type="button" class="ex__check" data-ex="${i}" aria-pressed="false" aria-label="${esc(x.name)} gedaan" ${x.skip ? 'disabled' : ''}>✓</button>
          <div class="ex__body">
            <div class="ex__head"><span class="ex__name">${esc(x.name)}</span><span class="ex__dose">${esc(x.dose)}</span></div>
            <p class="ex__how">${esc(x.how)}</p>
            ${x.note ? `<p class="ex__note">${esc(x.note)}</p>` : ''}
            <p class="ex__why">${esc(x.why)}</p>
          </div></li>`
      )
      .join('');
    const todo = session.items.filter((x) => !x.skip).length;

    root.innerHTML = `
      <a class="btn btn--ghost" href="#/vandaag" style="justify-content:flex-start;padding:0 4px;width:auto">‹ Vandaag</a>
      <section class="card">
        <div class="card__eyebrow">Niveau ${session.level} van 3 <span class="badge badge--accent">${esc(LEVELS[session.level].label)}</span></div>
        <p class="card__text" style="margin-top:0">${esc(LEVELS[session.level].text)} Rust 30 seconden tussen de reeksen. Geen pijn boven 3 op 10.</p>
        ${painNote}
      </section>
      <section class="card card--flush"><ul class="exlist">${rows}</ul></section>
      <p class="field__hint" id="ex-count" style="text-align:center">0 van ${todo} gedaan</p>
      <section class="card">
        <div class="field" style="margin:0">
          <span class="field__label">Hoe ging het?</span>
          <div class="seg"><button type="button" data-feel="ok" aria-pressed="true">Goed te doen</button><button type="button" data-feel="hard" aria-pressed="false">Te zwaar</button></div>
        </div>
      </section>
      <div class="sticky-save"><button class="btn" type="button" id="finish">Circuit afronden</button></div>`;

    let hard = false;
    root.addEventListener('click', async (e) => {
      const check = e.target.closest('[data-ex]');
      if (check) {
        const i = Number(check.dataset.ex);
        if (ticked.has(i)) ticked.delete(i);
        else ticked.add(i);
        check.setAttribute('aria-pressed', String(ticked.has(i)));
        check.closest('.ex').classList.toggle('ex--done', ticked.has(i));
        root.querySelector('#ex-count').textContent = `${ticked.size} van ${todo} gedaan`;
        return;
      }
      const feel = e.target.closest('[data-feel]');
      if (feel) {
        hard = feel.dataset.feel === 'hard';
        for (const b of feel.parentElement.children) b.setAttribute('aria-pressed', String(b === feel));
        return;
      }
      if (e.target.closest('#finish')) {
        if (ticked.size < Math.ceil(todo / 2)) return showToast('Vink de oefeningen af die je gedaan hebt (minstens de helft).');
        const res = await finishSession(state, await db.getAll('checkins'), { hard });
        state = res.state;
        showToast(res.message);
        location.hash = '#/vandaag';
      }
    });
  },
};
