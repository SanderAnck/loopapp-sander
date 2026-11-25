// Small inline SVG charts for Voortgang. Thin marks, recessive grid, one
// accent colour for your data and grey for the plan. Tap a mark to read it.

import { esc, formatPace } from './ui.js';
import { formatRaceTime } from './profile.js';

const W = 340;
const H = 190;
const PAD = { l: 44, r: 12, t: 14, b: 26 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
const dayNum = (iso) => new Date(`${iso}T12:00:00`).getTime() / 86400000;

function niceStep(range, target) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Wrap an SVG with a caption line that shows the tapped value. */
function frame(id, svg, legend, defaultCaption) {
  return `
    <figure class="chart" id="${id}">
      ${legend}
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-cap">${svg}</svg>
      <figcaption class="chart__cap" id="${id}-cap" data-default="${esc(defaultCaption)}">${esc(defaultCaption)}</figcaption>
    </figure>`;
}

/**
 * Predicted race time per week (your estimate) versus the plan's path to the goal.
 * points: [{date, timeS}], plan: [{date, timeS}], goalS, goalDate.
 */
export function predictionChart({ points, plan, goalS, goalDate, distanceKm }) {
  const all = [...points, ...plan];
  const x0 = dayNum(points[0]?.date || plan[0].date);
  const x1 = Math.max(dayNum(goalDate), ...all.map((p) => dayNum(p.date)));
  const times = [...all.map((p) => p.timeS), goalS];
  const step = niceStep(Math.max(...times) - Math.min(...times) || 60, 4) || 60;
  const lo = Math.floor((Math.min(...times) - step * 0.3) / step) * step;
  const hi = Math.ceil((Math.max(...times) + step * 0.3) / step) * step;
  const x = (iso) => PAD.l + ((dayNum(iso) - x0) / Math.max(x1 - x0, 1)) * IW;
  // Faster is higher on screen: the line climbs towards the goal.
  const y = (t) => PAD.t + ((t - lo) / (hi - lo)) * IH;

  let grid = '';
  for (let t = lo; t <= hi + 0.1; t += step) {
    grid += `<line class="chart__grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="chart__axis" x="${PAD.l - 6}" y="${y(t) + 4}" text-anchor="end">${formatRaceTime(t)}</text>`;
  }
  const xLabels = [points[0]?.date || plan[0].date, goalDate]
    .map((d, i) => `<text class="chart__axis" x="${x(d)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${esc(shortDate(d))}</text>`)
    .join('');
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.timeS).toFixed(1)}`).join('');
  const goalLine = `<line class="chart__goal" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(goalS)}" y2="${y(goalS)}"/>
    <text class="chart__label" x="${W - PAD.r}" y="${y(goalS) - 6}" text-anchor="end">Doel ${formatRaceTime(goalS)}</text>`;
  const tip = (p, who) => `${who} ${shortDate(p.date)}: ${formatRaceTime(p.timeS)} (${formatPace(p.timeS / distanceKm)}/km)`;
  const dots = points
    .map((p, i) => {
      const last = i === points.length - 1;
      return `<g class="chart__hit" data-tip="${esc(tip(p, 'Jouw schatting'))}">
        <circle cx="${x(p.date)}" cy="${y(p.timeS)}" r="14" fill="transparent"/>
        <circle class="chart__dot" cx="${x(p.date)}" cy="${y(p.timeS)}" r="${last ? 5 : 4}"/></g>`;
    })
    .join('');
  const planHits = plan
    .map((p) => `<g class="chart__hit" data-tip="${esc(tip(p, 'Plan'))}"><circle cx="${x(p.date)}" cy="${y(p.timeS)}" r="12" fill="transparent"/></g>`)
    .join('');
  const lastP = points[points.length - 1];
  const endLabel = lastP
    ? `<text class="chart__label chart__label--strong" x="${Math.min(x(lastP.date) + 8, W - PAD.r - 40)}" y="${y(lastP.timeS) - 10}">${formatRaceTime(lastP.timeS)}</text>`
    : '';
  const svg = `${grid}${goalLine}
    <path class="chart__line chart__line--plan" d="${path(plan)}"/>
    ${points.length > 1 ? `<path class="chart__line" d="${path(points)}"/>` : ''}
    ${planHits}${dots}${endLabel}${xLabels}`;
  const legend = `<div class="chart__legend"><span><i class="key key--you"></i>Jouw schatting</span><span><i class="key key--plan"></i>Plan naar je doel</span></div>`;
  return frame('chart-pred', svg, legend, 'Tik op een punt voor de waarde.');
}

/** Kilometres per week: done (bars) and planned (grey tick). weeks: [{start, label, doneKm, plannedKm, current}] */
export function weeklyKmChart(weeks) {
  const max = Math.max(5, ...weeks.map((w) => Math.max(w.doneKm, w.plannedKm)));
  const step = niceStep(max, 3);
  const top = Math.ceil(max / step) * step;
  const band = IW / weeks.length;
  const bw = Math.min(22, band - 6);
  const y = (km) => PAD.t + IH - (km / top) * IH;
  let grid = '';
  for (let v = 0; v <= top + 0.01; v += step) {
    grid += `<line class="chart__grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="chart__axis" x="${PAD.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const r = 4;
  const bars = weeks
    .map((w, i) => {
      const cx = PAD.l + band * i + band / 2;
      const h = (w.doneKm / top) * IH;
      const x0 = cx - bw / 2;
      const yb = PAD.t + IH;
      const rr = Math.min(r, h);
      const bar = h > 0.5
        ? `<path class="chart__bar${w.current ? ' chart__bar--now' : ''}" d="M${x0},${yb} V${yb - h + rr} Q${x0},${yb - h} ${x0 + rr},${yb - h} H${x0 + bw - rr} Q${x0 + bw},${yb - h} ${x0 + bw},${yb - h + rr} V${yb} Z"/>`
        : '';
      const plan = w.plannedKm ? `<line class="chart__plan" x1="${x0 - 3}" x2="${x0 + bw + 3}" y1="${y(w.plannedKm)}" y2="${y(w.plannedKm)}"/>` : '';
      const tip = `Week ${w.label}: ${w.doneKm.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km gelopen, ${w.plannedKm.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km gepland`;
      const lbl = i % Math.ceil(weeks.length / 6) === 0 || w.current
        ? `<text class="chart__axis" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(w.current ? 'nu' : `w${w.label}`)}</text>`
        : '';
      return `<g class="chart__hit" data-tip="${esc(tip)}"><rect x="${cx - band / 2}" y="${PAD.t}" width="${band}" height="${IH}" fill="transparent"/>${bar}${plan}</g>${lbl}`;
    })
    .join('');
  const legend = `<div class="chart__legend"><span><i class="key key--bar"></i>Gelopen</span><span><i class="key key--tick"></i>Gepland</span></div>`;
  return frame('chart-km', `${grid}${bars}`, legend, 'Tik op een week voor de waarde.');
}

/** Tap/hover: show the mark's value in the caption under the chart. */
export function mountCharts(root) {
  root.addEventListener('click', (e) => {
    const hit = e.target.closest('.chart__hit');
    const fig = e.target.closest('.chart');
    if (!fig) return;
    const cap = fig.querySelector('.chart__cap');
    for (const h of fig.querySelectorAll('.chart__hit.is-on')) h.classList.remove('is-on');
    if (hit) {
      hit.classList.add('is-on');
      cap.textContent = hit.dataset.tip;
    } else cap.textContent = cap.dataset.default;
  });
}
