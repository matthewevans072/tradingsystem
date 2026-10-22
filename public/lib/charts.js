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

// ---------- Strategy Lab ----------

// New York date and time of an instant (bars are stored as UTC ISO times).
const NY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function nyParts(t) {
  const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const shortDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const priceText = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(v >= 1000 ? 1 : 2));

// 15-minute candlesticks with the Lab's overlays. Only the bars given are
// drawn: a missing bar inside a session leaves an empty slot (it is never
// filled in), and sessions are separated by a gap and a dated divider.
// boxes: [{ windowStart, endedAt|null, resistance, support, outcome }]
// trades: [{ entryAt, exitAt, entryPrice, stop, target, exitPrice, r, symbol }]
// markers: [{ at, type, reason }]
export function candles(bars, { width = 760, height = 340, boxes = [], trades = [], markers = [], intervalMin = 15 } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', class: 'candles', role: 'img', 'aria-label': `Candlestick chart, ${bars.length} bars`, preserveAspectRatio: 'xMinYMin meet' });
  if (!bars.length) return svg;
  const step = intervalMin * 60000;
  // Slots: one per bar, empty slots for missing bars, one blank slot between sessions.
  const slots = [], sessions = [];
  let slot = 0, prev = null;
  for (const b of bars) {
    const ms = Date.parse(b.t), p = nyParts(ms);
    if (prev) {
      if (p.date !== prev.date) { slot += 2; sessions.push({ date: p.date, slot }); }
      else slot += Math.max(1, Math.round((ms - prev.ms) / step));
    } else sessions.push({ date: p.date, slot });
    slots.push({ ...b, ms, slot, date: p.date, hm: p.hm });
    prev = { ms, date: p.date };
  }
  const nSlots = slot + 1;
  const padL = 6, padR = 58, padT = 14, padB = 22, volH = Math.round(height * 0.16), gap = 8;
  const plotW = width - padL - padR, priceH = height - padT - padB - volH - gap;
  const slotW = plotW / nSlots;
  const X = (k) => padL + (k + 0.5) * slotW;
  const firstMs = slots[0].ms, lastMs = slots[slots.length - 1].ms;
  // Slot of an instant: the last bar at or before it, clamped to the drawn range.
  const toMs = (t) => (typeof t === 'number' ? t : Date.parse(t));
  const slotAt = (t) => {
    const ms = toMs(t);
    if (!Number.isFinite(ms) || ms <= firstMs) return slots[0].slot;
    if (ms >= lastMs) return slots[slots.length - 1].slot;
    let lo = 0, hi = slots.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (slots[mid].ms <= ms) lo = mid; else hi = mid - 1; }
    return slots[lo].slot;
  };
  const inView = (from, to) => toMs(to ?? lastMs) >= firstMs && toMs(from) <= lastMs + step;
  const vBoxes = boxes.filter((b) => inView(b.windowStart, b.endedAt));
  const vTrades = trades.filter((t) => t.entryAt && inView(t.entryAt, t.exitAt));
  const levels = [...slots.flatMap((b) => [b.h, b.l]), ...vBoxes.flatMap((b) => [b.resistance, b.support]), ...vTrades.flatMap((t) => [t.stop, t.target, t.entryPrice])].filter(Number.isFinite);
  let min = Math.min(...levels), max = Math.max(...levels);
  const pad = (max - min) * 0.06 || 1;
  min -= pad; max += pad;
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * priceH;
  // Grid and price axis.
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    svg.append(s('line', { x1: padL, x2: width - padR, y1: Y(v), y2: Y(v), class: 'grid' }));
    svg.append(s('text', { x: width - padR + 6, y: Y(v) + 4, class: 'axis' }, priceText(v)));
  }
  // Session dividers and dates.
  let lastLabel = -Infinity;
  sessions.forEach((x, i) => {
    const sx = padL + x.slot * slotW;
    if (i > 0) svg.append(s('line', { x1: sx - slotW / 2, x2: sx - slotW / 2, y1: padT, y2: height - padB, class: 'session-div' }));
    if (sx - lastLabel >= 44 && sx < width - padR - 20) { svg.append(s('text', { x: sx + 2, y: height - 6, class: 'axis' }, shortDate(x.date))); lastLabel = sx; }
  });
  // Boxes (frozen ceiling and floor), behind the candles.
  for (const b of vBoxes) {
    const x0 = padL + slotAt(b.windowStart) * slotW, x1 = padL + (slotAt(b.endedAt ?? lastMs) + 1) * slotW;
    const clipped = Date.parse(b.windowStart) < firstMs;
    svg.append(s('rect', { x: x0, y: Y(b.resistance), width: Math.max(2, x1 - x0), height: Math.max(1, Y(b.support) - Y(b.resistance)), class: `box box-${b.outcome || 'open'}${clipped ? ' clipped' : ''}` },
      s('title', {}, `Box ${priceText(b.support)}–${priceText(b.resistance)} (${b.outcome || 'open'})${clipped ? '; its window starts before the first bar shown' : ''}`)));
  }
  // Trade levels: entry, stop and target over the time the trade was open.
  for (const t of vTrades) {
    const x0 = X(slotAt(t.entryAt)) - slotW / 2, x1 = X(slotAt(t.exitAt ?? lastMs)) + slotW / 2;
    for (const [v, cls, label] of [[t.target, 'lvl-target', 'Target'], [t.stop, 'lvl-stop', 'Stop'], [t.entryPrice, 'lvl-entry', 'Entry']]) {
      if (!Number.isFinite(v)) continue;
      svg.append(s('line', { x1: x0, x2: x1, y1: Y(v), y2: Y(v), class: `lvl ${cls}` }, s('title', {}, `${label} ${priceText(v)}`)));
    }
  }
  // Volume pane (missing volume is left blank).
  const vols = slots.map((b) => b.v).filter((v) => Number.isFinite(v) && v >= 0);
  const vMax = Math.max(1, ...vols);
  const vTop = padT + priceH + gap;
  svg.append(s('line', { x1: padL, x2: width - padR, y1: vTop + volH, y2: vTop + volH, class: 'grid' }));
  const bw = Math.max(1, Math.min(9, slotW * 0.7));
  for (const b of slots) {
    const up = b.c >= b.o;
    if (Number.isFinite(b.v) && b.v >= 0) {
      const vh = (b.v / vMax) * volH;
      svg.append(s('rect', { x: X(b.slot) - bw / 2, y: vTop + volH - vh, width: bw, height: Math.max(0.5, vh), class: `vol ${up ? 'up' : 'down'}` }));
    }
    const yo = Y(b.o), yc = Y(b.c);
    svg.append(s('g', { class: `candle ${up ? 'up' : 'down'}` },
      s('title', {}, `${b.date} ${b.hm} ET  O ${priceText(b.o)}  H ${priceText(b.h)}  L ${priceText(b.l)}  C ${priceText(b.c)}  V ${Number.isFinite(b.v) ? b.v.toLocaleString('en-US') : 'missing'}`),
      s('line', { x1: X(b.slot), x2: X(b.slot), y1: Y(b.h), y2: Y(b.l), class: 'wick' }),
      s('rect', { x: X(b.slot) - bw / 2, y: Math.min(yo, yc), width: bw, height: Math.max(1, Math.abs(yc - yo)), class: 'body' })));
  }
  // Entry and exit markers.
  const barAt = (k) => slots.find((b) => b.slot === k);
  for (const t of vTrades) {
    const ke = slotAt(t.entryAt), be = barAt(ke);
    if (be && Date.parse(t.entryAt) >= firstMs) {
      const y = Y(be.l) + 12;
      svg.append(s('path', { d: `M${X(ke)},${y - 7} l5,8 h-10 z`, class: 'mk mk-entry' }, s('title', {}, `Simulated entry ${priceText(t.entryPrice)} at ${nyParts(t.entryAt).hm} ET`)));
    }
    if (t.exitAt && Date.parse(t.exitAt) <= lastMs + step) {
      const kx = slotAt(t.exitAt), bx = barAt(kx);
      if (bx) {
        const y = Y(bx.h) - 12;
        svg.append(s('path', { d: `M${X(kx)},${y + 7} l5,-8 h-10 z`, class: `mk ${t.r > 0 ? 'mk-win' : 'mk-loss'}` }, s('title', {}, `Simulated exit ${priceText(t.exitPrice)}${Number.isFinite(t.r) ? ` (${t.r >= 0 ? '+' : ''}${t.r.toFixed(2)}R)` : ''}`)));
      }
    }
  }
  // Decisions at a bar (signals, rejections, skips) along the top edge.
  for (const m of markers) {
    const ms = Date.parse(m.at);
    if (!(ms >= firstMs && ms <= lastMs)) continue;
    svg.append(s('circle', { cx: X(slotAt(m.at)), cy: padT - 6, r: 3.5, class: `mk-dot dot-${m.type}` }, s('title', {}, `${m.type.replace(/_/g, ' ')}: ${m.reason || ''}`)));
  }
  return svg;
}

// Histogram of R multiples. Bins are centred on multiples of binWidth (so a
// -1R stop lands in the -1.0 bin); values are rounded to 1e-6 first so float
// noise cannot split identical results across two bins.
export function histogram(values, { width = 420, height = 150, binWidth = 0.5, unit = 'R' } = {}) {
  const v = values.filter(Number.isFinite).map((x) => Math.round(x * 1e6) / 1e6);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', class: 'histo', role: 'img', 'aria-label': `Distribution of ${v.length} values`, preserveAspectRatio: 'xMinYMin meet' });
  if (!v.length) return svg;
  const k = (x) => Math.round(x / binWidth);
  const lo = Math.min(...v.map(k)), hi = Math.max(...v.map(k));
  const bins = [];
  for (let i = lo; i <= hi; i++) bins.push({ mid: i * binWidth, n: 0 });
  for (const x of v) bins[k(x) - lo].n++;
  const padL = 4, padB = 18, padT = 14;
  const bw = (width - padL * 2) / bins.length;
  const nMax = Math.max(...bins.map((b) => b.n));
  const every = Math.max(1, Math.ceil(bins.length / 10));
  const lbl = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
  bins.forEach((b, i) => {
    const bh = (b.n / nMax) * (height - padB - padT);
    const x = padL + i * bw;
    svg.append(s('rect', { x: x + 1, y: height - padB - bh, width: Math.max(1, bw - 2), height: Math.max(b.n ? 1 : 0, bh), class: b.mid > 0 ? 'up' : b.mid < 0 ? 'down' : 'flat' },
      s('title', {}, `${lbl(b.mid - binWidth / 2)} to ${lbl(b.mid + binWidth / 2)} ${unit}: ${b.n}`)));
    if (b.n) svg.append(s('text', { x: x + bw / 2, y: height - padB - bh - 3, 'text-anchor': 'middle', class: 'axis' }, b.n));
    if ((((i + lo) % every) + every) % every === 0) svg.append(s('text', { x: x + bw / 2, y: height - 4, 'text-anchor': 'middle', class: 'axis' }, lbl(b.mid)));
  });
  return svg;
}
