// prop-sim Phase 2, the live simulated funded account (strategy/prop-sim/LIVE-1.md), on the Research page: the live
// chart (5-minute bars with the levels, sweeps, structure breaks, setups, trades and gaps), each setup and what happened
// to it, the open position, today's result and limits, and every attempt. Read-only; it refreshes itself every 5 seconds
// while it is on the page. Text through h() and SVG text nodes only. Simulated using Lucid Trading's published rules as
// read on 2026-11-09; not affiliated with or endorsed by Lucid. Running simulated result, not validated.
import { h, badge, notice, empty, section } from '../lib/ui.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v)); for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c))); return el; };
const usd = (n) => (n == null ? '—' : `${n < 0 ? '-' : ''}US$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
const etTime = (ms) => (ms == null ? '—' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const ago = (iso, now) => { if (!iso) return '—'; const s = Math.round((now - Date.parse(iso)) / 1000); return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', {}, t)))), h('tbody', {}, ...rows)));
const td = (v, cls) => h('td', cls ? { class: cls } : {}, v);
const ACTION = { taken: ['taken', 'ok'], skipped: ['skipped', 'warn'], missed: ['missed (gap or late)', 'danger'], none: ['no trade', 'muted'], seen: ['seen, not traded', ''] };
const KIND = { stop: 'stop', target: 'target', time: 'flat-by 15:55', gap: 'closed at a gap', session_end: 'session end' };
const OUTCOME = { passed: 'passed', breached: 'failed (drawdown)', timeout: 'timed out', unfinished: 'in progress', payout: 'first payout' };

// The live chart: 5-minute candles (NQ stand-in points) with the trading windows, the levels, sweeps, breaks, setups,
// trades and gaps of one session.
function chart(o) {
  const S = o.session, tp = o.tickPoints, pts = (t) => t * tp;
  const W = 900, H = 330, padL = 6, padR = 70, padT = 18, padB = 22;
  const n = Math.max(1, Math.ceil((S.close - S.open) / 300000));
  const slot = (W - padL - padR) / n;
  const X = (k) => padL + (k + 0.5) * slot;
  const kOf = (ms) => Math.min(n - 1, Math.max(0, Math.floor((ms - S.open) / 300000)));
  const lv = S.marks.levels || {};
  const trades = S.trades.filter((t) => t.fill != null);
  const vals = [...S.bars.flatMap((b) => [b.h, b.l]), ...trades.flatMap((t) => [t.stop, t.target]), ...Object.values(lv)].filter(Number.isFinite);
  const barVals = S.bars.flatMap((b) => [b.h, b.l]);
  // Keep the bars readable: levels far outside the session's range are drawn at the edge with their value.
  const lo0 = Math.min(...barVals), hi0 = Math.max(...barVals), span = Math.max(1, hi0 - lo0);
  let lo = Math.min(...vals.filter((v) => v >= lo0 - span)), hi = Math.max(...vals.filter((v) => v <= hi0 + span));
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const Y = (v) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - padT - padB);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `Live chart of ${S.date}, ${S.bars.length} five-minute bars`, preserveAspectRatio: 'xMinYMin meet' });
  for (const w of S.windows) svg.append(sv('rect', { x: padL + kOf(w.from) * slot + slot, y: padT, width: Math.max(0, (kOf(w.to - 1) - kOf(w.from)) * slot), height: H - padT - padB, style: 'fill: var(--accent); opacity: .05' }, sv('title', {}, `Trading window ${w.id} ${etTime(w.from)} to ${etTime(w.to)} ET`)));
  for (const g of S.gaps) svg.append(sv('rect', { x: padL + kOf(g.fromMs) * slot, y: padT, width: Math.max(2, (g.toMs - g.fromMs) / 300000 * slot), height: H - padT - padB, style: 'fill: var(--neg); opacity: .16' }, sv('title', {}, `Gap ${etTime(g.fromMs)} to ${etTime(g.toMs)} ET: not observed; flat across it, nothing backfilled`)));
  for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4; svg.append(sv('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), style: 'stroke: var(--border); stroke-width: .5' }), sv('text', { x: W - padR + 4, y: Y(v) + 4, style: 'fill: var(--muted); font-size: 10px' }, pts(v).toFixed(2))); }
  for (const [name, v] of Object.entries(lv)) {
    if (!Number.isFinite(v)) continue;
    svg.append(sv('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), style: `stroke: ${name.endsWith('H') ? 'var(--neg)' : 'var(--pos)'}; stroke-dasharray: 5 4; stroke-width: 1` }, sv('title', {}, `${name} ${pts(v).toFixed(2)}`)),
      sv('text', { x: padL + 2, y: Y(v) - 3, style: 'fill: var(--text-2); font-size: 10px' }, `${name} ${pts(v).toFixed(2)}${v < lo || v > hi ? ' (off scale)' : ''}`));
  }
  const bw = Math.max(1.5, Math.min(8, slot * 0.65));
  for (const b of S.bars) {
    const up = b.c >= b.o, col = up ? 'var(--pos)' : 'var(--neg)', x = X(b.k);
    svg.append(sv('g', {}, sv('title', {}, `${etTime(b.s)} ET  O ${pts(b.o).toFixed(2)} H ${pts(b.h).toFixed(2)} L ${pts(b.l).toFixed(2)} C ${pts(b.c).toFixed(2)}`),
      sv('line', { x1: x, x2: x, y1: Y(b.h), y2: Y(b.l), style: `stroke: ${col}` }),
      sv('rect', { x: x - bw / 2, y: Math.min(Y(b.o), Y(b.c)), width: bw, height: Math.max(1, Math.abs(Y(b.c) - Y(b.o))), style: `fill: ${col}` })));
  }
  const barAt = (k) => S.bars.find((b) => b.k === k);
  for (const sw of S.marks.sweeps) { const b = barAt(sw.bucket); if (!b) continue; const y = sw.side === 'low' ? Y(b.l) + 8 : Y(b.h) - 8; svg.append(sv('path', { d: `M${X(sw.bucket)},${y - 4} l4,4 l-4,4 l-4,-4 z`, style: 'fill: var(--warn)' }, sv('title', {}, `Sweep of ${sw.level} (${sw.side === 'low' ? 'below, closed back above' : 'above, closed back below'})`))); }
  for (const br of S.marks.breaks) { const b = barAt(br.bucket); if (!b) continue; const up = br.dir === 'up'; const y = up ? Y(b.h) - 16 : Y(b.l) + 16; svg.append(sv('path', { d: up ? `M${X(br.bucket)},${y - 4} l3.5,6 h-7 z` : `M${X(br.bucket)},${y + 4} l3.5,-6 h-7 z`, style: `fill: ${up ? 'var(--pos)' : 'var(--neg)'}; opacity: .8` }, sv('title', {}, `Break of structure ${br.dir} (swing ${pts(br.level).toFixed(2)})`))); }
  const dotCol = { taken: 'var(--accent)', skipped: 'var(--warn)', missed: 'var(--neg)', none: 'var(--muted)', seen: 'var(--text-2)' };
  for (const d of [...S.decisions.map((x) => ({ ...x, fam: o.traded })), ...Object.entries(S.shown).flatMap(([id, list]) => list.map((x) => ({ ...x, fam: id })))]) {
    svg.append(sv('circle', { cx: X(d.bucket), cy: padT - 9, r: d.fam === o.traded ? 4 : 2.5, style: `fill: ${dotCol[d.action] || 'var(--muted)'}` }, sv('title', {}, `${etTime(d.t)} ET ${d.fam} ${d.d > 0 ? 'long' : 'short'}: ${(ACTION[d.action] || [d.action])[0]}${d.reason ? `, ${d.reason}` : ''}`)));
  }
  for (const t of trades) {
    const k0 = kOf(t.fillMs), k1 = t.exitMs != null ? kOf(t.exitMs) : (S.bars.at(-1)?.k ?? k0);
    for (const [v, col, label] of [[t.stop, 'var(--neg)', 'Stop'], [t.target, 'var(--pos)', 'Target'], [t.fill, 'var(--accent)', 'Fill']]) svg.append(sv('line', { x1: X(k0) - slot / 2, x2: X(k1) + slot / 2, y1: Y(v), y2: Y(v), style: `stroke: ${col}; stroke-width: 1.5` }, sv('title', {}, `${label} ${pts(v).toFixed(2)}`)));
    svg.append(sv('path', { d: `M${X(k0)},${Y(t.fill) + (t.d > 0 ? 10 : -10)} l5,${t.d > 0 ? 7 : -7} h-10 z`, style: 'fill: var(--accent)' }, sv('title', {}, `Simulated ${t.d > 0 ? 'long' : 'short'} fill ${pts(t.fill).toFixed(2)} at ${etTime(t.fillMs)} ET`)));
    if (t.exitMs != null) svg.append(sv('circle', { cx: X(k1), cy: Y(t.exit), r: 4, style: `fill: ${t.resultTicks >= 0 ? 'var(--pos)' : 'var(--neg)'}` }, sv('title', {}, `Simulated exit ${pts(t.exit).toFixed(2)} at ${etTime(t.exitMs)} ET (${KIND[t.kind] || t.kind})`)));
  }
  if (S.flatBy) svg.append(sv('line', { x1: padL + kOf(S.flatBy) * slot, x2: padL + kOf(S.flatBy) * slot, y1: padT, y2: H - padB, style: 'stroke: var(--muted); stroke-dasharray: 2 3' }, sv('title', {}, `Flat by ${etTime(S.flatBy)} ET`)));
  for (const k of [0, 12, 24, 36, 48, 60, 72]) if (k < n) svg.append(sv('text', { x: X(k) - 12, y: H - 6, style: 'fill: var(--muted); font-size: 10px' }, etTime(S.open + k * 300000)));
  return svg;
}

function render(o) {
  const parts = [h('div', { class: 'hxr-banner', role: 'note' }, h('strong', {}, `${o.running ? o.running[0].toUpperCase() + o.running.slice(1) : 'Running simulated result, not validated'}. `), `${o.label}. ${o.standIn}. `, o.feed ? `${o.feed}. ` : '', 'Phase 1 found no configuration that beats random entries; this account shows the frozen rules running live and is not evidence of an edge. No broker, no order, no real account.')];
  if (o.demo || o.note) { parts.push(notice('info', o.note)); return parts; }
  if (!o.activated) { parts.push(notice('info', 'The live account is not activated yet.')); return parts; }
  const now = o.nowMs, w = o.worker, p = o.polls?.[0];
  parts.push(h('p', { class: 'cell-sub' }, `Trades ${o.traded} on ${o.plan} 50K; the ICT setups ${o.shown.join(', ')} are shown, not traded. Started ${o.activation.startSession}. Worker: ${w?.alive ? `running (pid ${w.pid}, heartbeat ${ago(w.heartbeatAt, now)})` : w?.desired === 'paused' ? 'paused (a gap)' : 'not running (a gap while the market is open)'}. Last data request: ${p ? `${ago(p.at, now)}, ${p.ok ? 'ok' : 'failed'}` : 'none yet'}. Refreshes every 5 seconds.`));
  const a = o.account, st = a?.status;
  if (st) {
    const kpi = (label, value, sub, cls) => h('div', { class: 'card kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: `kpi-value ${cls || ''}` }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
    parts.push(h('div', { class: 'grid kpis' },
      kpi(`Attempt ${st.attempt}`, st.stage, `session ${st.sessionsUsed} of ${st.horizon}, from ${st.started ?? 'the next session'}${st.endedToday ? '; ended today (drawdown)' : ''}`),
      kpi("Today's P/L", usd(st.todayPnl), `open position ${usd(st.openPnl)}`, st.todayPnl > 0 ? 'pos' : st.todayPnl < 0 ? 'neg' : ''),
      kpi('Drawdown left', usd(st.drawdownLeft), `Max Loss Limit ${usd(st.mll)}; balance ${usd(st.balance)}`, st.drawdownLeft < 500 ? 'neg' : ''),
      kpi('Daily loss limit left', st.dailyLimit == null ? 'none on this plan' : usd(st.dailyLimitLeft), st.dailyLimit == null ? 'LucidFlex has no daily loss limit (as recorded)' : `limit ${usd(st.dailyLimit)}`),
      kpi(st.stage === 'evaluation' ? 'Progress to the target' : 'Funded profit', st.stage === 'evaluation' ? pct(st.progress) : usd(st.profit), `${usd(st.profit)} of ${usd(st.profitTarget)}; largest day ${pct(st.largestDayShare)} of the profit (at most ${pct(st.consistency)})`),
      kpi('All attempts', `${a.totals.attempts}`, `${a.totals.passes} passed, ${a.totals.payouts} first payouts; payouts ${usd(a.totals.traderPayouts)} less assumed fees ${usd(a.totals.feesAssumed)} = ${usd(a.totals.netAfterFees)}`)));
  }
  const S = o.session;
  if (!S) { parts.push(empty('No session yet', `The first session is ${o.activation.startSession}; the chart appears when its first bars arrive.`)); return parts; }
  parts.push(h('div', { class: 'card' }, h('div', { class: 'card-title' }, `${S.date} — ${S.final ? 'final' : 'live'}; ${S.observedMinutes} of ${S.judgedMinutes} minutes observed${S.gaps.length ? `; ${S.gaps.length} gap${S.gaps.length > 1 ? 's' : ''}` : ''}`), S.bars.length ? chart(o) : empty('No live bar yet', 'Bars appear a few seconds after each minute.'),
    h('p', { class: 'cell-sub' }, 'Dashed lines: previous day (PDH, PDL) and previous week (PWH, PWL) highs and lows. Diamonds: sweeps of a level. Small triangles: breaks of structure. Dots on top: setups (large: the traded configuration; teal taken, amber skipped, red missed). Red shading: gaps. Prices are NQ stand-in points (41 x QQQ on IEX), not futures.')));
  const all = [...S.decisions.map((x) => ({ ...x, fam: o.traded })), ...Object.entries(S.shown).flatMap(([id, list]) => list.map((x) => ({ ...x, fam: id })))].sort((x, y) => x.t - y.t || (x.fam < y.fam ? -1 : 1));
  const tp = o.tickPoints, P = (t) => (t == null ? '—' : (t * tp).toFixed(2));
  parts.push(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Setups seen this session'), all.length ? table(['Time (ET)', 'Configuration', 'Direction', 'What happened', 'Why', 'Entry', 'Stop'], all.slice(-60).reverse().map((x) => h('tr', {}, td(etTime(x.t)), td(x.fam), td(x.d > 0 ? 'long' : 'short'), td(badge(...(ACTION[x.action] || [x.action, '']))), td(x.reason ? `${x.reason}${x.why ? ` (${x.why})` : ''}` : x.why || ''), td(x.entryType === 'market' ? 'market' : P(x.entry), 'num'), td(P(x.stop), 'num')))) : h('p', { class: 'cell-sub' }, 'No setup yet this session.')));
  const day = a?.day;
  const rows = (day?.items || []).map((it) => { const t = it.trade; return h('tr', {}, td(etTime(t.fillMs)), td(t.d > 0 ? 'long' : 'short'), td(P(t.fill), 'num'), td(P(t.stop), 'num'), td(P(t.target), 'num'), td(`${P(t.exit)} (${KIND[t.kind] || t.kind}, ${etTime(t.exitMs)})`), td(it.contracts ?? '—', 'num'), td(it.counted ? usd(it.pnl) : it.note, it.pnl > 0 ? 'num pos' : it.pnl < 0 ? 'num neg' : 'num')); });
  if (day?.open) { const it = day.open, t = it.trade; rows.push(h('tr', {}, td(etTime(t.fillMs)), td(t.d > 0 ? 'long' : 'short'), td(P(t.fill), 'num'), td(P(t.stop), 'num'), td(P(t.target), 'num'), td(badge(it.breached ? 'failed at the limit' : 'open', it.breached ? 'danger' : 'ok')), td(it.contracts ?? '—', 'num'), td(it.counted ? usd(it.openPnl ?? it.pnl) : it.note, 'num'))); }
  parts.push(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Simulated trades this session (open position last)'), rows.length ? table(['Fill (ET)', 'Side', 'Fill', 'Stop', 'Target', 'Exit', 'Micros', 'Result'], rows) : h('p', { class: 'cell-sub' }, 'No simulated trade this session.')));
  if (a) {
    const list = [...a.attempts, { ...a.current.a, eval: a.current.kind === 'eval' ? 'unfinished' : 'passed', funded: a.current.kind === 'funded' ? 'unfinished' : a.current.a.funded, current: true }].reverse();
    parts.push(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Every attempt (one at a time; the next starts the session after one ends)'), table(['Attempt', 'Started', 'Ended', 'Evaluation', 'Funded stage', 'Sessions', 'Balance', 'Trader payout', 'Assumed fee'], list.map((x) => h('tr', {}, td(x.current ? `${x.n} (current)` : x.n), td(x.start ?? 'next session'), td(x.end ?? '—'), td(OUTCOME[x.eval] || x.eval), td(x.funded ? OUTCOME[x.funded] || x.funded : '—'), td(`${x.evalSessions ?? 0}${x.fundedSessions ? ` + ${x.fundedSessions}` : ''}`, 'num'), td(usd(x.balance), 'num'), td(usd(x.traderPayout), 'num'), td(usd(x.fee), 'num'))))));
  }
  if (o.sessions?.length) parts.push(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Recent sessions'), table(['Session', 'Trades', 'Gaps', 'Minutes observed'], o.sessions.map((s) => h('tr', {}, td(s.date), td(s.trades, 'num'), td(s.gaps, 'num'), td(`${s.observedMinutes} of ${s.minutes}`, 'num'))))));
  return parts;
}

export function propSimLiveSection(api) {
  const title = 'prop-sim live: the simulated funded account (running simulated result, not validated)';
  const body = h('div', { class: 'stack' }, h('p', { class: 'cell-sub' }, 'Loading…'));
  const el = section(title, body);
  let timer = null;
  const tick = async () => {
    if (!el.isConnected || !location.hash.startsWith('#/research')) { if (timer !== null) clearTimeout(timer); return; }
    try { const o = await api('GET', '/api/propsim/live'); body.replaceChildren(...render(o)); }
    catch (e) { body.replaceChildren(empty('Not available', String(e.message || e))); }
    timer = setTimeout(tick, 5000);
  };
  setTimeout(tick, 0);
  return el;
}
