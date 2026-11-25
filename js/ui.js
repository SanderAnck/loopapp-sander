// Shared UI helpers.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Format seconds per km as m:ss. */
export function formatPace(secPerKm) {
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDateLong(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

let toastTimer = null;

/** Show a short message above the tab bar, optionally with one action button. */
export function showToast(message, action) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    el.append(btn);
  } else {
    toastTimer = setTimeout(() => (el.hidden = true), 2500);
  }
  el.hidden = false;
}

export const ZONE_LABELS = {
  easy: 'Rustig en lange duurloop',
  marathon: 'Stevig duurtempo',
  threshold: 'Drempel (tempoloop)',
  interval: 'Intervallen',
  repetition: 'Strides en korte versnellingen',
};

/** Pace zone table rows (fast to slow shown as slow–fast for easy reading). */
export function zonesTable(zones) {
  const rows = Object.entries(ZONE_LABELS)
    .map(([key, label]) => {
      const [fast, slow] = zones[key];
      const hard = key !== 'easy' && key !== 'marathon';
      return `<tr><td><span class="zone-dot ${hard ? 'zone-dot--hard' : ''}"></span>${esc(label)}</td>
        <td>${formatPace(slow)}–${formatPace(fast)}</td></tr>`;
    })
    .join('');
  return `<table class="zones">${rows}</table>`;
}

export const FEASIBILITY_TEXT = {
  easy: ['Al binnen bereik', 'Je huidige niveau haalt dit doel al. Je kan een snellere doeltijd overwegen.'],
  realistic: ['Haalbaar', 'Je doel vraagt een gezonde, geleidelijke vooruitgang per week.'],
  ambitious: [
    'Ambitieus maar haalbaar',
    'Met consequent trainen lukt dit. Pace houdt je vooruitgang in het oog en stelt bij als het nodig is.',
  ],
  'very-ambitious': [
    'Erg ambitieus',
    'Voor de tijd die je hebt is dit veel. Overweeg een latere datum, een extra trainingsdag of een iets ruimere doeltijd.',
  ],
};
