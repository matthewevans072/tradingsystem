// Small SVG charts drawn with DOM APIs (no external libraries).
const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const PALETTE = ['#5aa9e6', '#7fc8a9', '#e3b15c', '#c58fd8', '#e57f73', '#6cc3d5', '#a9b665', '#d3869b', '#8fa3bf', '#f2a65a'];

// Donut with a legend list returned alongside.
export function donut(items, { size = 168, thickness = 22, centerLabel = '', centerValue = '' } = {}) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'donut', role: 'img', 'aria-label': 'Allocation chart' });
  svg.append(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': thickness }));
  let offset = 0;
  items.forEach((it, i) => {
    if (!total || it.value <= 0) return;
    const len = (it.value / total) * c;
    const seg = s('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: it.color || PALETTE[i % PALETTE.length], 'stroke-width': thickness,
      'stroke-dasharray': `${Math.max(0, len - 1.5)} ${c}`, 'stroke-dashoffset': -offset, transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }, s('title', {}, `${it.label}: ${((it.value / total) * 100).toFixed(1)}%`));
    svg.append(seg);
    offset += len;
  });
  svg.append(s('text', { x: size / 2, y: size / 2 - 4, 'text-anchor': 'middle', class: 'donut-value' }, centerValue));
  svg.append(s('text', { x: size / 2, y: size / 2 + 14, 'text-anchor': 'middle', class: 'donut-label' }, centerLabel));
  return svg;
}

// Horizontal bars (e.g. sector exposure, contributors). Values may be negative.
export function hbars(items, { width = 320, rowH = 24, format = (v) => v, signed = false } = {}) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  const labelW = 120, valueW = 84;
  const barW = width - labelW - valueW;
  const svg = s('svg', { viewBox: `0 0 ${width} ${items.length * rowH}`, width: '100%', class: 'hbars', role: 'img', preserveAspectRatio: 'xMinYMin meet' });
  items.forEach((it, i) => {
    const y = i * rowH;
    const w = (Math.abs(it.value) / max) * (signed ? barW / 2 : barW);
    const x0 = labelW + (signed ? barW / 2 : 0);
    const x = signed && it.value < 0 ? x0 - w : x0;
    svg.append(s('text', { x: 0, y: y + rowH / 2 + 4, class: 'bar-label' }, it.label.length > 18 ? it.label.slice(0, 17) + '…' : it.label));
    svg.append(s('rect', { x: labelW, y: y + 5, width: barW, height: rowH - 10, rx: 3, fill: 'var(--track)' }));
    svg.append(s('rect', { x, y: y + 5, width: Math.max(1, w), height: rowH - 10, rx: 3, fill: it.color || (signed ? (it.value >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--accent)') },
      s('title', {}, `${it.label}: ${format(it.value)}`)));
    svg.append(s('text', { x: width, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'bar-value' }, format(it.value)));
  });
  return svg;
}

// Price line with optional overlay series (e.g. moving averages).
export function line(points, { width = 640, height = 200, overlays = [], refLines = [] } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', class: 'linechart', role: 'img', 'aria-label': 'Price chart', preserveAspectRatio: 'none' });
  if (points.length < 2) return svg;
  const all = [...points.map((p) => p.v), ...overlays.flatMap((o) => o.points.map((p) => p.v)), ...refLines.map((r) => r.v)].filter((v) => v != null);
  let min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  min -= pad; max += pad;
  const padL = 4, padR = 52, padT = 8, padB = 18;
  const X = (i) => padL + (i / (points.length - 1)) * (width - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  for (let k = 0; k <= 3; k++) {
    const v = min + ((max - min) * k) / 3;
    svg.append(s('line', { x1: padL, x2: width - padR, y1: Y(v), y2: Y(v), class: 'grid' }));
    svg.append(s('text', { x: width - padR + 6, y: Y(v) + 4, class: 'axis' }, v.toFixed(v > 100 ? 0 : 2)));
  }
  const path = (pts, idx) => pts.map((p, i) => (p.v == null ? null : `${i === 0 || pts[i - 1]?.v == null ? 'M' : 'L'}${X(idx ? idx(p, i) : i).toFixed(1)},${Y(p.v).toFixed(1)}`)).filter(Boolean).join(' ');
  const area = `${path(points)} L${X(points.length - 1)},${height - padB} L${X(0)},${height - padB} Z`;
  svg.append(s('path', { d: area, class: 'area' }));
  for (const o of overlays) svg.append(s('path', { d: path(o.points), class: `overlay ${o.class || ''}`, fill: 'none' }, s('title', {}, o.label)));
  svg.append(s('path', { d: path(points), class: 'price', fill: 'none' }));
  for (const r of refLines) {
    svg.append(s('line', { x1: padL, x2: width - padR, y1: Y(r.v), y2: Y(r.v), class: `ref ${r.class || ''}` }, s('title', {}, `${r.label}: ${r.v}`)));
  }
  const first = points[0].t, last = points[points.length - 1].t;
  svg.append(s('text', { x: padL, y: height - 4, class: 'axis' }, first));
  svg.append(s('text', { x: width - padR, y: height - 4, 'text-anchor': 'end', class: 'axis' }, last));
  return svg;
}

export function sparkline(values, { width = 90, height = 26 } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'spark' });
  const v = values.filter((x) => x != null);
  if (v.length < 2) return svg;
  const min = Math.min(...v), max = Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * width},${height - 2 - ((x - min) / (max - min || 1)) * (height - 4)}`).join(' ');
  svg.append(s('polyline', { points: pts, fill: 'none', class: v[v.length - 1] >= v[0] ? 'up' : 'down' }));
  return svg;
}
