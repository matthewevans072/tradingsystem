// Strategy Lab: the consolidation-breakout rules run on a hypothetical
// simulated account (strategy/LAB-ARCHITECTURE.md). It is separate from the
// real portfolio, and nothing on this page places, routes or prepares an
// order anywhere. Every text that comes from the server is rendered as a text
// node through h(), never as markup. No bar, price or figure is made up here:
// what the server does not return is shown as missing.
import { h, mount, fmt, tone, notice, empty, badge, drawer, field, select, toast, loading, errorState } from '../lib/ui.js';
import { line, candles, histogram } from '../lib/charts.js';

const MODES = [['intraday', 'Intraday'], ['swing', 'Swing']];
const MODE_LABEL = Object.fromEntries(MODES);
const SPLITS = [['development', 'Development'], ['validation', 'Validation'], ['stress', 'Stress'], ['walk_forward', 'Walk-forward']];
const EVENT = {
  setup_eligible: ['Setup eligible', 'info'], setup_expired: ['Setup expired', 'muted'], setup_invalidated: ['Setup cancelled', 'muted'],
  signal: ['Signal', 'info'], signal_rejected: ['Rejected', 'danger'], order_placed: ['Accepted: order', 'ok'], entry_skipped: ['Skipped', 'warn'],
  entry_filled: ['Entry filled', 'ok'], exit_order: ['Exit order', ''], exit_filled: ['Exit filled', ''], data_warning: ['Data warning', 'warn'], operational_error: ['Error', 'danger'],
};
const DECISION_FILTERS = [['all', 'All', null], ['accepted', 'Accepted', ['order_placed', 'entry_filled']], ['rejected', 'Rejected', ['signal_rejected']], ['skipped', 'Skipped', ['entry_skipped', 'setup_expired', 'setup_invalidated']], ['setups', 'Setups', ['setup_eligible']]];
const EXIT = { stop: 'Stop', target: 'Target', flatten: 'Session-end exit', max_hold: 'Time exit (max hold)', session_end_fallback: 'Session-end fallback', end_of_data: 'End of data' };
const FORWARD = { off: ['Off', 'muted'], running: ['Running', 'ok'], stopped: ['Stopped', 'muted'], error: ['Error', 'danger'], replay: ['Synthetic replay', 'warn'] };
const OUTCOME = { not_eligible: ['Not eligible', 'danger'], inconclusive: ['Inconclusive', 'warn'], eligible_for_review: ['Eligible for review (not permission to trade)', 'ok'] };
const CRIT = { pass: ['Pass', 'ok'], fail: ['Fail', 'danger'], not_evaluable: ['Not evaluable', 'muted'], inconclusive: ['Inconclusive', 'warn'] };
const RESOLVED = { stop_first: 'stop first (conservative default)', target_first: 'target first (sensitivity only)', lower_timeframe: 'lower-timeframe bars', lower_timeframe_stop_first: 'lower-timeframe bars, stop first', tv_path: "TradingView's assumed path" };
const SMALL_SAMPLE = 30;
const MAX_CSV_BYTES = 20 * 1024 * 1024;

function stored(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  return null;
}

// Page state that survives re-renders (mode, chart and journal choices).
const S = {
  mode: stored('sd.lab.mode') === 'swing' ? 'swing' : 'intraday',
  chart: { symbol: null, sessions: null, focus: null },
  journal: { source: 'forward', symbol: '' },
  perfRun: {},
  decisions: 'all',
};

// Each render gets an epoch; pollers and late responses of an older render stop.
let epoch = 0;
let resizers = [];
let resizeTimer = null;
const onLab = () => /^#\/?lab(\?|$)/.test(location.hash);
const live = (ep) => ep === epoch && onLab();
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { for (const fn of resizers) fn(); }, 150);
});

function poll(ep, ms, fn) {
  const tick = async () => {
    if (!live(ep)) return;
    let again = true;
    try { again = await fn(); } catch { again = true; }
    if (again && live(ep)) setTimeout(tick, ms);
  };
  setTimeout(tick, ms);
}

// ---------- formatting ----------

const fin = (v) => v != null && Number.isFinite(Number(v));
const px = (v, dp = 2) => fmt.num(v, dp);
const money = (v) => fmt.money(v);
const sMoney = (v) => fmt.signedMoney(v);
const rTxt = (v) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}R` : '—');
const share = (x, dp = 0) => (fin(x) ? `${(x * 100).toFixed(dp)}%` : '—');
const shortHash = (s) => (s ? String(s).slice(0, 12) : '—');
const ET_FULL = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ET_SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const valid = (t) => t && !Number.isNaN(new Date(t).getTime());
const when = (t) => (valid(t) ? `${ET_FULL.format(new Date(t))} ET` : t ? String(t) : '—');
const whenShort = (t) => (valid(t) ? `${ET_SHORT.format(new Date(t))} ET` : '—');
const etDate = (t) => (valid(t) ? ET_DATE.format(new Date(t)) : null);
const day = (d) => (d ? fmt.date(String(d).slice(0, 10)) : '—');
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ageDays = (t) => (valid(t) ? (Date.now() - new Date(t).getTime()) / 86400000 : null);
const times = (list, ref) => (list?.length ? list.map((t) => (etDate(t) === etDate(ref) ? ET_TIME.format(new Date(t)) : ET_SHORT.format(new Date(t)))).join(', ') : 'none recorded');
const humanKey = (k) => String(k).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2')
  .split(' ').map((w) => (w.length === 1 ? w : w.toLowerCase())).join(' ').replace(/ pct\b/g, ' %');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function valueText(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(Math.abs(v) >= 100 ? 1 : 3);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return whenShort(v);
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${humanKey(k)}: ${valueText(x)}`).join('; ');
  return String(v);
}

function eventBadge(type) {
  const [l, k] = EVENT[type] || [String(type).replace(/_/g, ' '), ''];
  return badge(l, k);
}

// ---------- building blocks ----------

function labSection(id, title, ...children) {
  return h('section', { class: 'card lab-sec', id: `lab-${id}` }, h('h3', { class: 'card-title' }, title), ...children);
}

// A block that loads its own data; a failure stays inside the block.
function lazy(ep, load) {
  const host = h('div', { class: 'lab-lazy' }, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Loading…'));
  const run = () => {
    mount(host, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Loading…'));
    Promise.resolve().then(load).then(
      (node) => { if (ep === epoch) mount(host, node); },
      (e) => { if (ep === epoch) mount(host, errorState(e, run)); },
    );
  };
  run();
  return host;
}

function tile(label, value, sub, extra) {
  return h('div', { class: 'lab-tile' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'lab-tile-value num' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null, extra || null);
}

function meter(frac, warnAt = 0.8) {
  const f = fin(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  return h('div', { class: `lab-meter ${f >= 1 ? 'full' : f >= warnAt ? 'high' : ''}`, role: 'img', 'aria-label': `${Math.round(f * 100)}% of the limit` }, h('span', { style: { width: `${f * 100}%` } }));
}

function table(head, rows, { cls = '', numeric = [] } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: `lab-table ${cls}` },
    h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: numeric.includes(i) ? 'num' : '' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: numeric.includes(i) ? 'num' : '' }, c)))))));
}

function confirmDialog(title, body, { confirmLabel, onConfirm, ready = () => true }) {
  const err = h('div', { role: 'alert' });
  const ok = h('button', { class: 'btn primary', type: 'button' }, confirmLabel);
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const content = h('div', { class: 'stack lab-dialog' }, body, err, h('div', { class: 'row' }, ok, cancel));
  const d = drawer(title, content);
  cancel.addEventListener('click', () => d.close());
  ok.addEventListener('click', async () => {
    const problem = ready();
    if (problem !== true) { mount(err, notice('warn', problem)); return; }
    ok.disabled = true;
    mount(err);
    try {
      await onConfirm();
      d.close();
    } catch (e) {
      mount(err, notice('danger', e.message));
      ok.disabled = false;
    }
  });
  return d;
}

function scrollToSection(id) {
  document.getElementById(`lab-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- page ----------

export async function renderLab(view, ctx) {
  const ep = ++epoch;
  resizers = [];
  const o = await ctx.api('GET', `/api/lab/overview?mode=${S.mode}`);
  if (!live(ep)) return;
  const reload = () => renderLab(view, ctx).catch((e) => { if (onLab()) mount(view, errorState(e, reload)); });
  const L = { api: ctx.api, app: ctx.app, o, ep, view, reload, demo: o.workspace === 'demo', universe: (o.data?.symbols || []).map((s) => s.symbol) };

  if (L.demo && o.status === 'preparing') {
    mount(view, h('div', { class: 'stack lab' }, header(L, { freshness: false }), preparing(L)));
    poll(ep, 2500, async () => {
      const n = await ctx.api('GET', `/api/lab/overview?mode=${S.mode}`);
      if (n.status !== 'preparing') { reload(); return false; }
      return true;
    });
    return;
  }

  const needsData = o.status === 'needs_data';
  const blocks = [header(L, { freshness: true })];
  if (needsData) {
    blocks.push(jumpNav([['data', 'Data needed'], ['account', 'Simulated account'], ['runs', 'Runs & versions']]));
    blocks.push(dataSection(L), accountSection(L), waitingSection(), runsSection(L));
  } else {
    blocks.push(jumpNav([['account', 'Account'], ['setups', 'Setups'], ['chart', 'Chart'], ['journal', 'Journal'], ['perf', 'Performance'], ['runs', 'Runs & versions'], ['data', 'Data']]));
    blocks.push(accountSection(L), setupsSection(L), chartSection(L), journalSection(L), perfSection(L), runsSection(L), dataSection(L));
  }
  mount(view, h('div', { class: 'stack lab' }, blocks));
}

function jumpNav(items) {
  return h('nav', { class: 'lab-jump', 'aria-label': 'Strategy Lab sections' },
    items.map(([id, label]) => h('button', { class: 'chip-btn', type: 'button', onclick: () => scrollToSection(id) }, label)));
}

function setMode(L, m) {
  if (m === S.mode) return;
  S.mode = m;
  stored('sd.lab.mode', m);
  S.chart.focus = null;
  L.reload();
}

// ---------- 1. header strip ----------

function header(L, { freshness }) {
  const { o } = L;
  const start = o.account?.startingEquity ?? 100000;
  const v = o.version || {};
  const syms = o.data?.symbols || [];
  const withBars = syms.filter((s) => s.bars > 0);
  const last = o.data?.lastBar || null;
  const provider = o.settings?.marketProvider;
  const fw = o.forward || {};
  const warns = [];
  if (o.synthetic) warns.push(['warn', `${o.syntheticLabel}. Every price, trade and figure on this page comes from generated data.`]);
  for (const w of o.warnings || []) warns.push(['warn', w]);
  if (!freshness) return headerView(L, start, v, warns, null);
  if (!L.demo && last && ageDays(last) > 4) warns.push(['warn', `Stale data: the newest stored bar is from ${when(last)} (${fmt.ago(last)}). Results stop there, and the forward test needs current bars.`]);
  if (fw.status === 'off' || fw.status === 'stopped') warns.push(['info', `Forward test ${fw.status === 'off' ? 'off' : 'stopped'} for ${MODE_LABEL[S.mode]}: no forward evidence is being collected.${fw.canRun === false && fw.reason ? ` ${fw.reason}` : ''}`]);
  if (fw.status === 'replay') warns.push(['info', 'The forward section shows a synthetic replay of the last sessions, not a live forward test.']);
  if (fw.note) warns.push([fw.enabled ? 'warn' : 'info', `Delayed data: ${fw.note}`]);

  const providerText = provider === 'synthetic' ? 'synthetic (generated for the demo)' : !provider || provider === 'none' ? 'no market-data provider connected' : provider;
  return headerView(L, start, v, warns, freshnessLine(syms, withBars, last, providerText, L));
}

function headerView(L, start, v, warns, freshness) {
  const { o } = L;
  return h('div', { class: 'stack lab-head', style: { gap: '10px' } },
    h('div', { class: 'lab-banner', role: 'note' },
      h('strong', {}, 'SIMULATION ONLY'), ` — hypothetical US$${Number(start).toLocaleString('en-US')} account, separate from your portfolio. Nothing here places orders.`,
      o.realPortfolio ? h('div', { class: 'lab-banner-sub' }, o.realPortfolio) : null),
    o.synthetic ? h('div', { class: 'lab-synth', role: 'note' }, o.syntheticLabel || 'SYNTHETIC') : null,
    h('section', { class: 'card lab-strip' },
      h('div', { class: 'spread' },
        h('div', { class: 'lab-version' },
          h('span', { class: 'lab-vname' }, v.label || v.strategy || 'Strategy'),
          badge(`v${v.version || '?'}`, 'info'),
          h('span', { class: 'small muted', title: v.configHash ? `Config hash ${v.configHash} (${v.file})` : '' }, `config ${shortHash(v.configHash)}`)),
        h('div', { class: 'row' },
          h('div', { class: 'tabs lab-modes', role: 'tablist', 'aria-label': 'Mode' },
            MODES.map(([m, l]) => h('button', { class: `tab ${m === S.mode ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(m === S.mode), onclick: () => setMode(L, m) }, l))),
          h('span', { class: 'small muted' }, 'separate results'))),
      freshness,
      warns.length ? h('ul', { class: 'lab-warns' }, warns.map(([k, t]) => h('li', { class: k }, t))) : null));
}

function freshnessLine(syms, withBars, last, providerText, L) {
  const newest = last ? Date.parse(last) : null;
  const summary = withBars.length
    ? `Data: ${providerText} · ${withBars.length} of ${syms.length} symbols have bars · last bar ${when(last)} (${fmt.ago(last)})`
    : `Data: ${providerText} · no bars stored yet`;
  if (!withBars.length) return h('div', { class: 'small lab-fresh' }, summary);
  return h('details', { class: 'more lab-fresh' },
    h('summary', {}, summary, ' · per symbol'),
    h('div', { class: 'lab-symgrid' }, syms.map((s) => {
      const behind = s.last && newest && newest - Date.parse(s.last) > 86400000;
      return h('div', { class: `lab-symcell ${!s.bars ? 'missing' : behind ? 'behind' : ''}` },
        h('span', { class: 'sym' }, s.symbol),
        h('span', { class: 'small' }, s.bars ? `${whenShort(s.last)} · ${fmt.ago(s.last)}` : 'no bars'),
        h('span', { class: 'cell-sub' }, s.bars ? `${s.bars.toLocaleString('en-US')} bars · ${(s.sources || []).join(', ') || 'unknown source'}${s.synthetic && !L.demo ? ' · synthetic' : ''}${behind ? ' · behind' : ''}` : ''));
    })));
}

function preparing(L) {
  const { o } = L;
  return h('section', { class: 'card' },
    h('div', { class: 'state loading', role: 'status' }, h('span', { class: 'spinner' }), 'Preparing the synthetic demo…'),
    h('p', { class: 'muted small mt' }, 'Generating 15-minute bars for the universe, then running development and validation backtests and a synthetic forward replay in the background. This page updates by itself when it is ready; everything it shows will be labelled SYNTHETIC.'),
    o.demo?.note ? h('p', { class: 'small muted' }, o.demo.note) : null,
    o.jobs?.running ? h('p', { class: 'small muted' }, `Started ${fmt.ago(o.jobs.running.startedAt)}.`) : null);
}

function waitingSection() {
  return labSection('waiting', 'Setups, chart, journal and performance',
    empty('Waiting for market data', 'These sections fill in once 15-minute bars are stored for the universe (see "Data needed" above). Nothing is generated or estimated in your workspace.'));
}

// ---------- 2. simulated account ----------

function accountSection(L) {
  const { o } = L;
  const a = o.account || {};
  const fw = o.forward || {};
  const riskLimit = o.settings?.risk?.maxOpenRiskPct ?? 1;
  const maxPos = o.settings?.risk?.maxPositions ?? 3;
  const positions = a.positions || [];
  const orders = a.pendingOrders || [];
  const riskPct = a.equity > 0 ? (a.openRisk / a.equity) * 100 : null;
  const used = positions.length + orders.length;

  const tiles = h('div', { class: 'lab-tiles' },
    tile('Simulated equity', money(a.equity), h('span', { class: tone(a.equity - a.startingEquity) }, `${sMoney(a.equity - a.startingEquity)} vs ${money(a.startingEquity)} start`)),
    tile('Simulated cash', money(a.cash), a.reservedCash ? `${money(a.reservedCash)} reserved for pending orders` : 'nothing reserved'),
    tile('Open planned risk', fin(riskPct) ? `${riskPct.toFixed(2)}%` : '—', `${money(a.openRisk)} of the ${riskLimit}% limit (${money((a.equity * riskLimit) / 100)})`, meter(riskPct / riskLimit)),
    tile('Positions', `${used} of ${maxPos}`, `${plural(positions.length, 'position')} + ${plural(orders.length, 'pending order')} (both count)`, meter(used / maxPos, 1)));

  const blocks = [tiles, forwardControl(L)];
  blocks.push(h('h4', { class: 'lab-h4' }, 'Open simulated positions'));
  blocks.push(positions.length
    ? table(['Symbol', 'Shares', 'Entry', 'Stop', 'Target', 'Reward/risk', 'Planned risk', 'Unrealized', 'Exit rule'], positions.map((p) => {
      const rr = fin(p.entryPrice) && p.entryPrice > p.stop ? (p.target - p.entryPrice) / (p.entryPrice - p.stop) : null;
      return [
        h('span', { class: 'sym' }, p.symbol),
        fmt.qty(p.shares),
        h('div', {}, px(p.entryPrice), h('div', { class: 'cell-sub' }, whenShort(p.entryAt))),
        h('span', { title: px(p.stop, 4) }, px(p.stop)),
        px(p.target),
        fin(rr) ? `${rr.toFixed(2)} : 1` : '—',
        money(p.plannedRisk),
        h('div', { class: tone(p.unrealized) }, sMoney(p.unrealized), h('div', { class: 'cell-sub' }, `last ${px(p.lastClose)} · ${whenShort(p.lastBarAt)}`)),
        h('div', { class: 'small' }, exitRule(p)),
      ];
    }), { numeric: [1, 2, 3, 4, 5, 6, 7] })
    : h('div', { class: 'muted small' }, 'No open simulated positions in this mode.'));
  blocks.push(h('h4', { class: 'lab-h4' }, 'Pending simulated orders'));
  blocks.push(orders.length
    ? table(['Symbol', 'Signal bar', 'Valid for', 'Max entry', 'Stop', 'Target', 'Shares', 'Worst-case risk', 'Reserved'], orders.map((x) => [
      h('span', { class: 'sym' }, x.symbol), whenShort(x.signalAt), h('span', { title: 'The order is valid for this bar\'s open only' }, `open of ${whenShort(x.validFor)}`),
      px(x.maxEntry), px(x.stop), px(x.target), fmt.qty(x.shares), money(x.plannedRiskWorstCase), money(x.reservedCash),
    ]), { numeric: [3, 4, 5, 6, 7, 8] })
    : h('div', { class: 'muted small' }, 'No pending simulated orders.'));
  if (a.note) blocks.push(h('p', { class: 'small muted mt' }, a.note));
  if (a.lastProcessed) blocks.push(h('p', { class: 'small muted' }, `Last bar processed: ${when(a.lastProcessed)}.`));
  return labSection('account', `Simulated account · forward test · ${MODE_LABEL[S.mode]}`, ...blocks);
}

function exitRule(p) {
  const order = p.exitOrder ? ` Exit order placed ${whenShort(p.exitOrder.placedAt)} (${p.exitOrder.reason}).` : '';
  if (S.mode === 'intraday') return `Stop or target; otherwise closed at the open of the session's last 15-minute bar (${day(p.exitBy)}).${order}`;
  return `Stop or target; otherwise time exit on ${day(p.exitBy)} (at most 10 sessions). Overnight gaps can exceed the planned risk.${order}`;
}

function forwardControl(L) {
  const { o } = L;
  const fw = o.forward || {};
  const [label, kind] = FORWARD[fw.status] || [fw.status, ''];
  const trades = o.forwardTradeCount ?? 0;
  const end = fw.processedThrough ? Date.parse(fw.processedThrough) : Date.now();
  const months = fw.startedAt ? (end - Date.parse(fw.startedAt)) / (30.4375 * 86400000) : null;
  const btn = h('button', { class: `btn small ${fw.enabled ? '' : 'primary'}`, type: 'button', disabled: !fw.enabled && !fw.canRun ? true : null, title: !fw.enabled && !fw.canRun ? fw.reason || null : null }, fw.enabled ? 'Stop forward test' : 'Start forward test');
  btn.addEventListener('click', () => forwardDialog(L, !fw.enabled));
  return h('div', { class: 'lab-fwd' },
    h('div', { class: 'spread' },
      h('div', { class: 'row' }, h('strong', {}, 'Forward test'), badge(label, kind),
        fw.version ? h('span', { class: 'small muted' }, `version ${fw.version} · config ${shortHash(fw.configHash)} frozen`) : null),
      btn),
    h('div', { class: 'small lab-fwd-meta' },
      h('span', {}, `Started ${fw.startedAt ? when(fw.startedAt) : '—'}`),
      h('span', {}, `processed through ${fw.processedThrough ? when(fw.processedThrough) : '—'}`),
      h('span', {}, `review milestone: ${trades} of 100 closed trades · ${fin(months) ? months.toFixed(1) : '0'} of 3 months`)),
    !fw.enabled && fw.canRun === false && fw.reason ? h('div', { class: 'small muted' }, fw.reason) : null,
    fw.lastError ? notice('danger', `Last error: ${fw.lastError}`) : null);
}

function forwardDialog(L, enable) {
  const { o } = L;
  const v = o.version || {};
  const body = enable
    ? h('div', { class: 'stack', style: { gap: '10px' } },
      notice('info', `Starts the simulated forward test for ${MODE_LABEL[S.mode]} mode on the hypothetical US$${Number(o.account?.startingEquity ?? 100000).toLocaleString('en-US')} account. Each completed 15-minute bar from your market-data provider is processed in order. No order is placed, routed or prepared anywhere, and paper profits are not buying power.`),
      h('div', {}, h('strong', {}, 'Rules freeze. '), `Version ${v.version} (config ${shortHash(v.configHash)}) is frozen for this forward run. Changing a rule needs a new version, which starts a new forward run and restarts the count.`),
      h('div', {}, h('strong', {}, 'Review milestone. '), 'At least 100 closed forward trades AND at least 3 calendar months since the start, whichever is later. Reaching it means the evidence can be reviewed; it is not permission to trade.'),
      o.forward?.note ? h('div', { class: 'small muted' }, o.forward.note) : null)
    : h('div', { class: 'stack', style: { gap: '10px' } },
      notice('warn', `Stops the ${MODE_LABEL[S.mode]} forward run. Its trades and journal are kept. Starting again begins a new forward run, so the 100-trade / 3-month count restarts.`));
  confirmDialog(enable ? 'Start the forward test?' : 'Stop the forward test?', body, {
    confirmLabel: enable ? 'Start forward test' : 'Stop forward test',
    onConfirm: async () => {
      const r = await L.api('POST', '/api/lab/forward', { mode: S.mode, enabled: enable });
      toast(r.note || (enable ? 'Forward test started (simulation only)' : 'Forward test stopped'));
      L.reload();
    },
  });
}

// ---------- 3. setups and decisions ----------

function setupsSection(L) {
  const { o } = L;
  const setups = o.activeSetups || [];
  const decisions = o.recentDecisions || [];
  const boxes = setups.length
    ? h('div', { class: 'stack', style: { gap: '10px' } }, setups.map((s) => setupCard(L, s, decisions)))
    : h('div', { class: 'muted small' }, 'No active boxes right now. A box appears when the last 20 completed bars form a narrow range with at least two touches of the ceiling and two of the floor.');
  const list = h('div', { class: 'list lab-scroll', tabindex: '0', 'aria-label': 'Recent decisions' });
  const draw = () => {
    const f = DECISION_FILTERS.find((x) => x[0] === S.decisions) || DECISION_FILTERS[0];
    const items = f[2] ? decisions.filter((d) => f[2].includes(d.type)) : decisions;
    mount(list, items.length ? items.map(decisionItem) : h('div', { class: 'muted small' }, decisions.length ? 'No decisions of this kind among the most recent 20.' : 'No forward decisions recorded yet.'));
  };
  const filters = h('div', { class: 'tabs lab-filter', role: 'tablist', 'aria-label': 'Filter decisions' });
  const drawFilters = () => mount(filters, DECISION_FILTERS.map(([k, l]) => h('button', {
    class: `tab ${S.decisions === k ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(S.decisions === k),
    onclick: () => { S.decisions = k; drawFilters(); draw(); },
  }, l)));
  drawFilters();
  draw();
  return labSection('setups', `Setups and decisions · ${MODE_LABEL[S.mode]}`,
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, `Active boxes (${setups.length})`), boxes),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Recent decisions (forward test)'), filters, list)));
}

function setupCard(L, s, decisions) {
  const b = s.box || {};
  const p = b.params || {};
  const ev = decisions.find((d) => d.type === 'setup_eligible' && d.symbol === s.symbol && d.details?.box?.eligibleAt === s.eligibleAt);
  return h('div', { class: 'lab-setup' },
    h('div', { class: 'spread' },
      h('div', { class: 'row' }, h('span', { class: 'sym' }, s.symbol), badge(`${s.state} · ${plural(s.barsLeft, 'bar')} left`, 'info')),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => showOnChart(L, { symbol: s.symbol }) }, 'Chart')),
    h('dl', { class: 'kv small lab-kv' },
      h('dt', {}, 'Box'), h('dd', {}, `floor ${px(b.support)} – ceiling ${px(b.resistance)} (height ${px(b.height)})`),
      h('dt', {}, 'Height'), h('dd', {}, `${px(b.heightAtr)} × ATR, within the ${p.maxHeightAtr ?? '—'} × maximum (ATR(${p.atrLength ?? 14}) = ${px(b.atr, 4)})`),
      h('dt', {}, 'Ceiling touches'), h('dd', {}, `${b.touchesUpper} (needs ${p.minTouchesEach ?? '—'}): ${times(b.upperTouchTimes, b.eligibleAt)}`),
      h('dt', {}, 'Floor touches'), h('dd', {}, `${b.touchesLower} (needs ${p.minTouchesEach ?? '—'}): ${times(b.lowerTouchTimes, b.eligibleAt)}`),
      h('dt', {}, 'Tolerance'), h('dd', {}, `${px(b.tolerance, 4)} (${p.touchToleranceAtr ?? '—'} × ATR); counted touches at least ${p.minBarsBetweenTouches ?? '—'} bars apart`),
      h('dt', {}, 'Frozen'), h('dd', {}, `${when(s.eligibleAt)}: a close above ${px(b.resistance)} within ${p.setupExpiryBars ?? '—'} bars is the breakout; a close below ${px(b.support)} cancels it`)),
    ev?.explanation ? h('details', { class: 'more' }, h('summary', {}, 'Why it qualifies (full)'), h('p', { class: 'small lab-explain' }, ev.explanation)) : null);
}

function decisionItem(d) {
  return h('div', { class: 'list-item lab-decision' },
    h('div', { class: 'row' }, eventBadge(d.type), h('span', { class: 'sym' }, d.symbol || '—'), h('span', { class: 'small muted' }, when(d.at))),
    h('div', { class: 'small' }, d.reason || ''),
    d.explanation && d.explanation !== d.reason ? h('details', { class: 'more' }, h('summary', {}, 'Why'), h('p', { class: 'small lab-explain' }, d.explanation)) : null);
}

// ---------- 4. chart ----------

function showOnChart(L, focus) {
  S.chart.symbol = focus.symbol;
  S.chart.focus = focus.trade ? focus : null;
  L.drawChart?.();
  scrollToSection('chart');
}

function chartSection(L) {
  const { o, ep } = L;
  const syms = (o.data?.symbols || []).filter((s) => s.bars > 0);
  if (!syms.length) return labSection('chart', 'Chart', empty('No bars stored', 'The chart shows stored 15-minute bars only; none are stored for this workspace yet.'));
  if (!S.chart.symbol || !syms.some((s) => s.symbol === S.chart.symbol)) S.chart.symbol = (o.activeSetups?.[0]?.symbol) || (o.recentTrades?.[0]?.symbol) || syms[0].symbol;
  if (!S.chart.sessions) S.chart.sessions = window.innerWidth < 600 ? 2 : 5;
  const host = h('div', { class: 'lab-chart-host' });
  const info = h('div', { class: 'small muted lab-chart-info' });
  const below = h('div', {});
  const symSel = select('symbol', syms.map((s) => [s.symbol, s.symbol]), S.chart.symbol);
  symSel.setAttribute('aria-label', 'Symbol');
  symSel.addEventListener('change', () => { S.chart.symbol = symSel.value; S.chart.focus = null; draw(); });
  const range = h('div', { class: 'tabs lab-range', role: 'tablist', 'aria-label': 'Sessions shown' });
  const focusBox = h('div', {});
  let data = null;

  const drawRange = () => mount(range, [2, 5, 10].map((n) => h('button', {
    class: `tab ${!S.chart.focus && S.chart.sessions === n ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(!S.chart.focus && S.chart.sessions === n),
    onclick: () => { S.chart.sessions = n; S.chart.focus = null; draw(); },
  }, `${n} sessions`)));

  const paint = () => {
    if (!data || !host.isConnected) return;
    const w = Math.max(300, Math.round(host.clientWidth || 760));
    mount(host, candles(data.bars, { width: w, height: w < 600 ? 260 : 340, boxes: data.boxes, trades: data.trades, markers: data.markers }));
  };
  resizers.push(paint);

  const draw = () => drawBars().catch((e) => { if (live(ep)) mount(host, errorState(e, draw)); });
  async function drawBars() {
    symSel.value = S.chart.symbol;
    drawRange();
    const f = S.chart.focus;
    mount(focusBox, f ? notice('info', `Showing simulated trade #${f.trade.id} (${f.trade.symbol}, run #${f.trade.runId}). `, h('button', { class: 'linklike lab-link', type: 'button', onclick: () => { S.chart.focus = null; draw(); } }, 'Back to the latest sessions')) : null);
    mount(host, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Loading bars…'));
    mount(info);
    mount(below);
    const sym = syms.find((s) => s.symbol === S.chart.symbol);
    const q = new URLSearchParams({ symbol: S.chart.symbol, mode: S.mode });
    if (f) {
      const t = f.trade;
      q.set('runId', String(t.runId));
      q.set('from', addDays(etDate(t.signalAt || t.entryAt), -1));
      q.set('to', etDate(t.exitAt || t.entryAt) || etDate(t.entryAt));
    } else if (sym?.last) {
      const to = etDate(sym.last);
      q.set('to', to);
      q.set('from', addDays(to, -Math.ceil(S.chart.sessions * 1.6) - 4));
    }
    const want = S.chart.symbol;
    let d;
    try {
      d = await L.api('GET', `/api/lab/bars?${q}`);
    } catch (e) {
      if (live(ep) && want === S.chart.symbol) mount(host, errorState(e, draw));
      return;
    }
    if (!live(ep) || want !== S.chart.symbol) return;
    let bars = d.bars || [];
    if (!f && bars.length) {
      const days = [...new Set(bars.map((b) => etDate(b.t)))];
      const keep = new Set(days.slice(-S.chart.sessions));
      bars = bars.filter((b) => keep.has(etDate(b.t)));
    }
    data = { bars, boxes: d.boxes || [], trades: d.trades || [], markers: d.markers || [] };
    if (!bars.length) { mount(host, empty('No bars', d.note || 'No bars are stored for this symbol and range.')); return; }
    paint();
    const firstT = bars[0].t, lastT = bars[bars.length - 1].t;
    const inView = (b) => Date.parse(b.endedAt || lastT) >= Date.parse(firstT) && Date.parse(b.windowStart) <= Date.parse(lastT);
    const shownBoxes = data.boxes.filter(inView);
    mount(info,
      d.synthetic ? badge('SYNTHETIC', 'warn') : null, ' ',
      `${d.symbol} · ${d.exchange} · ${plural(bars.length, '15-minute bar')} · ${when(firstT)} to ${when(lastT)}`,
      d.run ? ` · overlays from run #${d.run.id} (${d.run.kind}${d.run.split && d.run.split !== d.run.kind ? ` ${d.run.split}` : ''}, ${d.run.mode})` : ' · no run covers these bars, so no boxes or trades are drawn',
      d.truncated ? ` · only the last ${d.maxBars} bars of the range are shown` : '');
    mount(below,
      shownBoxes.length ? h('details', { class: 'more' }, h('summary', {}, `Boxes in view (${shownBoxes.length}): why each qualified`),
        h('div', { class: 'stack', style: { gap: '8px' } }, shownBoxes.map((b) => h('div', { class: 'small' },
          h('div', { class: 'row' }, badge(b.outcome, b.outcome === 'breakout' ? 'info' : b.outcome === 'open' ? 'ok' : 'muted'), `eligible ${when(b.eligibleAt)} · ${px(b.support)}–${px(b.resistance)} · ${px(b.heightAtr)} × ATR`),
          h('p', { class: 'lab-explain' }, b.why || ''))))) : null,
      data.trades.length ? h('div', { class: 'small muted' }, `Simulated trades in view: ${data.trades.map((t) => `${t.symbol} ${whenShort(t.entryAt)} ${rTxt(t.r)}`).join(' · ')}`) : null);
  }
  L.drawChart = draw;
  setTimeout(draw, 0);

  const legend = h('div', { class: 'lab-legend small' },
    [['sw-up', 'Up bar'], ['sw-down', 'Down bar'], ['sw-box', 'Frozen box (ceiling/floor)'], ['sw-entry', 'Entry'], ['sw-stop', 'Stop'], ['sw-target', 'Target'],
      ['sw-mk-entry', 'Simulated entry'], ['sw-mk-win', 'Exit (gain)'], ['sw-mk-loss', 'Exit (loss)'], ['sw-dot-signal', 'Signal / order'], ['sw-dot-rejected', 'Rejected'], ['sw-dot-skipped', 'Skipped']]
      .map(([c, l]) => h('span', { class: 'lab-leg' }, h('span', { class: `sw ${c}` }), l)));
  return labSection('chart', `Chart · 15-minute bars · ${MODE_LABEL[S.mode]}`,
    h('div', { class: 'row lab-controls' }, h('div', { style: { width: '120px' } }, symSel), range),
    focusBox, info, host, legend,
    h('p', { class: 'small muted' }, 'Only stored bars are drawn. A missing bar leaves an empty slot; it is never filled in. Volume missing for a bar is left blank.'),
    below);
}

// ---------- 5. trade journal ----------

function journalSection(L) {
  const { ep } = L;
  const srcSel = h('select', { name: 'source', 'aria-label': 'Source' },
    h('option', { value: 'forward' }, 'Forward test'),
    h('option', { value: 'backtest' }, 'All backtest runs'));
  const symSel = select('symbol', [['', 'All symbols'], ...L.universe.map((s) => [s, s])], S.journal.symbol);
  symSel.setAttribute('aria-label', 'Symbol');
  const listHost = h('div', {});
  const count = h('span', { class: 'small muted' });
  const PAGE = 50;
  let offset = 0;

  L.api('GET', `/api/lab/runs?mode=${S.mode}&limit=50`).then((r) => {
    if (ep !== epoch) return;
    for (const run of r.runs.filter((x) => x.status === 'done' && ['backtest', 'holdout', 'walk_forward', 'forward'].includes(x.kind))) {
      srcSel.append(h('option', { value: `run:${run.id}` }, `Run #${run.id} · ${run.kind === 'backtest' ? run.split : run.kind.replace('_', '-')} · ${run.from} to ${run.to || 'now'}`));
    }
    srcSel.value = S.journal.source;
    if (srcSel.value !== S.journal.source) { S.journal.source = 'forward'; srcSel.value = 'forward'; }
  }).catch(() => { /* the run list is optional here */ });
  srcSel.value = S.journal.source.startsWith('run:') ? 'forward' : S.journal.source;

  const query = (off) => {
    const q = new URLSearchParams({ mode: S.mode, limit: String(PAGE), offset: String(off) });
    if (S.journal.source.startsWith('run:')) q.set('runId', S.journal.source.slice(4));
    else q.set('source', S.journal.source);
    if (S.journal.symbol) q.set('symbol', S.journal.symbol);
    return `/api/lab/trades?${q}`;
  };

  async function load(reset) {
    if (reset) { offset = 0; mount(listHost, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Loading trades…')); }
    let r;
    try { r = await L.api('GET', query(offset)); } catch (e) { if (ep === epoch) mount(listHost, errorState(e, () => load(true))); return; }
    if (ep !== epoch) return;
    mount(count, `${r.total} simulated trade${r.total === 1 ? '' : 's'}`);
    if (reset) {
      if (!r.trades.length) { mount(listHost, h('div', { class: 'muted small' }, S.journal.source === 'forward' ? 'No closed forward-test trades yet.' : 'No trades for this choice.')); return; }
      mount(listHost, h('div', { class: 'lab-trades', role: 'list' },
        h('div', { class: 'lab-trow lab-thead', 'aria-hidden': 'true' }, ['Symbol', 'Entry', 'Exit', 'Reason', 'R', 'Net'].map((t, i) => h('span', { class: i >= 4 ? 'num' : '' }, t)))));
    }
    const wrap = listHost.querySelector('.lab-trades');
    listHost.querySelector('.lab-more')?.remove();
    for (const t of r.trades) wrap.append(tradeRow(L, t));
    offset += r.trades.length;
    if (offset < r.total) {
      listHost.append(h('button', { class: 'btn small lab-more mt', type: 'button', onclick: () => load(false) }, `Show more (${r.total - offset} left)`));
    }
  }
  srcSel.addEventListener('change', () => { S.journal.source = srcSel.value; load(true); });
  symSel.addEventListener('change', () => { S.journal.symbol = symSel.value; load(true); });
  load(true);
  return labSection('journal', `Trade journal · ${MODE_LABEL[S.mode]}`,
    h('div', { class: 'row lab-controls' }, h('div', { style: { minWidth: '200px', flex: '1 1 220px', maxWidth: '360px' } }, srcSel), h('div', { style: { width: '150px' } }, symSel), count),
    listHost);
}

function tradeRow(L, t) {
  const detail = h('div', { class: 'lab-tdetail', hidden: true });
  const flags = [];
  if (t.gapThrough) flags.push(badge('gap-through', 'warn'));
  if (t.ambiguous) flags.push(badge('ambiguous bar', 'warn'));
  if ((t.flags || []).includes('intrabar_limit_entry')) flags.push(badge('intrabar limit fill', 'info'));
  if (t.endOfData) flags.push(badge('end of data', 'muted'));
  const row = h('button', { class: 'lab-trow', type: 'button', 'aria-expanded': 'false' },
    h('span', { class: 'sym' }, t.symbol, t.source === 'backtest' ? h('span', { class: 'cell-sub' }, ` #${t.runId}`) : null),
    h('span', {}, `${px(t.entryPrice)}`, h('span', { class: 'cell-sub' }, ` ${whenShort(t.entryAt)}`)),
    h('span', {}, t.exitAt ? `${px(t.exitPrice)}` : 'open', t.exitAt ? h('span', { class: 'cell-sub' }, ` ${whenShort(t.exitAt)}`) : null),
    h('span', {}, EXIT[t.exitReason] || t.exitReason || '—', flags.length ? ' ' : null, flags),
    h('span', { class: `num ${tone(t.r)}` }, rTxt(t.r)),
    h('span', { class: `num ${tone(t.net)}` }, sMoney(t.net)));
  let loaded = false;
  row.addEventListener('click', async () => {
    const open = detail.hidden;
    detail.hidden = !open;
    row.setAttribute('aria-expanded', String(open));
    row.classList.toggle('open', open);
    if (!open || loaded) return;
    loaded = true;
    mount(detail, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Loading the trade record…'));
    try {
      mount(detail, tradeDetail(L, await L.api('GET', `/api/lab/trades/${t.id}`)));
    } catch (e) {
      loaded = false;
      mount(detail, errorState(e));
    }
  });
  return h('div', { class: 'lab-titem', role: 'listitem' }, row, detail);
}

function tradeDetail(L, d) {
  const t = d.trade;
  const rec = t.record || {};
  const en = rec.entry || {}, ex = rec.exit || {};
  const x = d.explanation || {};
  const pts = (p) => (p?.points?.length ? h('ul', { class: 'bullets small' }, p.points.map((s) => h('li', {}, s))) : h('div', { class: 'small muted' }, p?.text || 'Not recorded.'));
  const flags = [];
  if (t.gapThrough) flags.push(`Gap-through: the bar opened beyond the ${ex.reason === 'target' ? 'target' : 'stop'}, so the exit filled at the open${fin(t.r) && t.r < -1 ? `; the loss (${rTxt(t.r)}) is larger than the planned risk` : ''}.`);
  if (t.ambiguous) flags.push(`Ambiguous bar: it touched both the stop and the target; resolved by ${RESOLVED[ex.resolvedBy] || ex.resolvedBy || 'the default assumption'}.`);
  if ((t.flags || []).includes('intrabar_limit_entry')) flags.push('Intrabar limit fill: the entry filled inside the bar at the limit rather than at the open.');
  if (t.endOfData) flags.push('End of data: the position was still open when the data ended and was closed at the last close; it counts in P/L but not in per-trade statistics.');
  for (const f of t.flags || []) if (f !== 'intrabar_limit_entry') flags.push(humanKey(f));
  if (ex.note) flags.push(ex.note);
  const costRows = [
    ['Entry commission', money(en.commission)], ['Entry spread + slippage', money(en.spreadSlippage)],
    ['Exit commission', money(ex.commission)], ['Exit spread + slippage', money(ex.spreadSlippage)],
    ['Currency conversion', money((en.fx || 0) + (ex.fx || 0))], ['Total costs', money(t.costs)],
    ['Gross P/L', sMoney(rec.pnl?.gross)], ['Net P/L', sMoney(t.net)],
  ];
  return h('div', { class: 'stack', style: { gap: '10px' } },
    h('div', { class: 'row small' },
      d.synthetic ? badge('SYNTHETIC', 'warn') : null,
      badge(`run #${t.runId} · ${d.run?.kind || t.kind}${d.run?.split && d.run.split !== d.run.kind ? ` ${d.run.split}` : ''}`, 'info'),
      h('span', { class: 'muted' }, `version ${t.version} · config ${shortHash(t.configHash)} · ${fmt.qty(t.shares)} shares · stop ${px(t.stop)} · target ${px(t.target)}${fin(en.rewardRisk) ? ` · ${en.rewardRisk.toFixed(2)} : 1 at entry` : ''}${fin(en.plannedRisk) ? ` · planned risk ${money(en.plannedRisk)}` : ''}`)),
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Why it triggered'), pts(x.signal),
        h('details', { class: 'more' }, h('summary', {}, 'The box it broke out of'), pts(x.setup))),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'What ended it'), pts(x.exit),
        h('h4', { class: 'lab-h4' }, 'Flags'), flags.length ? h('ul', { class: 'bullets small' }, flags.map((f) => h('li', {}, f))) : h('div', { class: 'small muted' }, 'None: no gap-through, no ambiguous bar, no intrabar limit fill.'))),
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Costs (simulated)'), h('dl', { class: 'kv small' }, costRows.map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, v)]))),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Event log'),
        d.events?.length ? h('div', { class: 'list' }, d.events.map((e) => h('div', { class: 'list-item small' },
          h('div', { class: 'row' }, eventBadge(e.type), h('span', { class: 'muted' }, when(e.at))), h('div', {}, e.reason || '')))) : h('div', { class: 'small muted' }, 'No events recorded.'))),
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => showOnChart(L, { symbol: t.symbol, trade: t }) }, 'Show on chart')));
}

// ---------- 6. performance ----------

async function allTrades(L, params) {
  const out = [];
  for (let off = 0; off < 5000; off += 500) {
    const q = new URLSearchParams({ ...params, limit: '500', offset: String(off) });
    const r = await L.api('GET', `/api/lab/trades?${q}`);
    out.push(...r.trades);
    if (out.length >= r.total || !r.trades.length) return { trades: out, total: r.total };
  }
  return { trades: out, total: out.length, capped: true };
}

// Plain sums and ratios over the forward test's closed trades (end-of-data
// closes are left out of per-trade statistics, as in the backtest metrics).
function forwardStats(trades) {
  const closed = trades.filter((t) => !t.endOfData && t.exitAt);
  const rs = closed.map((t) => t.r).filter(fin);
  const nets = closed.map((t) => t.net || 0);
  const gp = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = -nets.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  return {
    trades: closed.length, winRate: closed.length ? nets.filter((x) => x > 0).length / closed.length : null,
    meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, profitFactor: gl > 0 ? gp / gl : null,
    netPnl: trades.reduce((a, t) => a + (t.net || 0), 0), maxDrawdownPct: null, meanRCI: null,
  };
}

function perfSection(L) {
  const { o, ep } = L;
  const body = lazy(ep, async () => {
    const all = (await L.api('GET', '/api/lab/runs?limit=200')).runs;
    const mine = all.filter((r) => r.mode === S.mode && r.status === 'done' && r.kind !== 'forward');
    const pick = S.perfRun[S.mode] && mine.some((r) => r.id === S.perfRun[S.mode]) ? S.perfRun[S.mode]
      : (mine.find((r) => r.split === 'validation') || mine.find((r) => r.split === 'development') || mine[0])?.id;
    const runHost = h('div', {});
    const sel = h('select', { 'aria-label': 'Run' }, mine.map((r) => h('option', { value: String(r.id), selected: r.id === pick ? true : null }, `#${r.id} · ${r.kind === 'backtest' ? r.split : r.kind.replace('_', '-')} · ${r.from} to ${r.to}${r.contaminated ? ' · contaminated' : ''}`)));
    const showRun = (id) => {
      S.perfRun[S.mode] = id;
      mount(runHost, lazy(ep, () => runPerformance(L, id)));
    };
    sel.addEventListener('change', () => showRun(Number(sel.value)));
    if (pick) showRun(pick);
    else mount(runHost, empty('No finished backtest yet', 'Run Development or Validation below to see performance for this mode.'));
    return h('div', { class: 'stack' },
      mine.length ? h('div', { class: 'row lab-controls' }, h('span', { class: 'small muted' }, 'Backtest run'), h('div', { style: { minWidth: '220px', flex: '1 1 260px', maxWidth: '440px' } }, sel)) : null,
      runHost,
      h('div', {}, h('h4', { class: 'lab-h4' }, 'Backtest vs forward test, side by side'), comparison(L, all)),
      acceptanceBlock(o));
  });
  return labSection('perf', `Performance · ${MODE_LABEL[S.mode]}`, body);
}

async function runPerformance(L, id) {
  const [{ run }, tr] = await Promise.all([L.api('GET', `/api/lab/runs/${id}`), allTrades(L, { runId: String(id) })]);
  const m = run.metrics || {};
  const hd = run.headline || {};
  const small = fin(hd.trades) && hd.trades < SMALL_SAMPLE;
  const ci = hd.meanRCI;
  const tiles = h('div', { class: 'lab-tiles' },
    tile('Trades', hd.trades ?? '—', `${m.allTrades ?? '—'} incl. ${m.endOfData?.trades ?? 0} end-of-data`),
    tile('Win rate', share(hd.winRate), `${m.wins ?? '—'} wins · ${m.losses ?? '—'} losses`),
    tile('Mean R', rTxt(hd.meanR), ci ? `95% CI ${rTxt(ci.lower)} to ${rTxt(ci.upper)}` : 'no interval'),
    tile('Profit factor', fin(hd.profitFactor) ? hd.profitFactor.toFixed(2) : '—', m.profitFactorNote || null),
    tile('Net P/L (simulated)', h('span', { class: tone(hd.netPnl) }, sMoney(hd.netPnl)), `${fmt.pct(hd.returnPct)} on ${money(m.startingEquity)}`),
    tile('Max drawdown', fin(hd.maxDrawdownPct) ? `${hd.maxDrawdownPct.toFixed(2)}%` : '—', fin(m.maxDrawdownUsd) ? money(m.maxDrawdownUsd) : null));
  const eq = (run.equity || []).map((p) => ({ t: p.date, v: p.equity }));
  const rs = tr.trades.filter((t) => !t.endOfData).map((t) => t.r);
  const groups = run.groups || {};
  const regimeHost = h('div', {});
  const regimeTabs = h('div', { class: 'tabs lab-filter' });
  const drawRegime = (key) => {
    mount(regimeTabs, [['regime', 'Regime'], ['regimeTrend', 'Trend'], ['regimeVolatility', 'Volatility'], ['cluster', 'Cluster'], ['year', 'Year']].filter(([k]) => groups[k]).map(([k, l]) => h('button', { class: `tab ${k === key ? 'active' : ''}`, type: 'button', onclick: () => drawRegime(k) }, l)));
    mount(regimeHost, groupTable(groups[key] || [], 'Group'));
  };
  drawRegime(groups.regime ? 'regime' : 'cluster');
  const out = m.outliers || {};
  const bah = run.details?.buyAndHold;
  const costs = m.costs || {};
  return h('div', { class: 'stack' },
    h('div', { class: 'row small' }, run.synthetic ? badge('SYNTHETIC', 'warn') : null, run.contaminated ? badge('contaminated holdout', 'danger') : null,
      h('span', { class: 'muted' }, `${run.label || ''} · version ${run.version} · config ${shortHash(run.configHash)} · data ${shortHash(run.dataHash)}`)),
    small ? notice('warn', `Small sample: ${plural(hd.trades, 'trade')}. Mean R, win rate and profit factor can swing widely on so few trades; read the confidence interval, not the point estimate.`) : null,
    tiles,
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Equity curve (daily, simulated)'),
        eq.length >= 2 ? line(eq, { height: 190, refLines: [{ v: m.startingEquity ?? 100000, label: 'Starting balance', class: 'cost' }] }) : h('div', { class: 'small muted' }, run.kind === 'walk_forward' || run.kind === 'stress' ? 'This run type stores no equity curve; see the report.' : 'No equity points stored.')),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, `R distribution (${plural(rs.filter(fin).length, 'closed trade')})`),
        rs.length ? histogram(rs, { height: 170 }) : h('div', { class: 'small muted' }, 'No closed trades.'),
        h('div', { class: 'small muted' }, `median ${rTxt(m.medianR)} · best ${rTxt(m.tail?.bestR)} · worst ${rTxt(m.tail?.worstR)} · beyond −1R: ${m.tail?.beyondMinus1R ?? '—'} · gap-throughs: ${m.tail?.gapThroughs ?? '—'} · ambiguous bars: ${m.ambiguous?.count ?? '—'}${tr.capped ? ' · first 5,000 trades only' : ''}`))),
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'By symbol'), groupTable([...(groups.symbol || [])].sort((a, b) => b.net - a.net), 'Symbol')),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'By market regime'), regimeTabs, regimeHost,
        groups.excludingCluster ? h('div', { class: 'small muted' }, Object.entries(groups.excludingCluster).map(([c, s]) => `Excluding ${c}: ${plural(s.trades, 'trade')}, mean ${rTxt(s.meanR)}, net ${sMoney(s.net)}`).join(' · ')) : null)),
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Outlier dependence'),
        h('dl', { class: 'kv small' },
          h('dt', {}, 'Mean R, all closed trades'), h('dd', {}, rTxt(m.meanR)),
          h('dt', {}, 'Without the best trade'), h('dd', {}, `${rTxt(out.meanRWithoutBest)} · net ${sMoney(out.netWithoutBest)}`),
          h('dt', {}, `Without the best 5% (${out.best5PctCount ?? '—'})`), h('dd', {}, `${rTxt(out.meanRWithoutBest5Pct)} · net ${sMoney(out.netWithoutBest5Pct)}`),
          h('dt', {}, `Top 10% (${out.top10PctCount ?? '—'}) share of gross profit`), h('dd', {}, share(out.top10PctShareOfGrossProfit)),
          h('dt', {}, 'Largest symbol'), h('dd', {}, out.largestSymbol ? `${out.largestSymbol.symbol} ${sMoney(out.largestSymbol.net)}${fin(out.largestSymbol.shareOfNet) ? ` (${share(out.largestSymbol.shareOfNet)} of net)` : out.largestSymbol.note ? ` (${out.largestSymbol.note})` : ''}` : '—'))),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Buy-and-hold comparison'),
        bah ? [table(['', 'Return', 'Max drawdown'], [
          ['This strategy (simulated)', fmt.pct(hd.returnPct), fin(hd.maxDrawdownPct) ? `${hd.maxDrawdownPct.toFixed(2)}%` : '—'],
          [`Equal-weight universe (${bah.equalWeight?.symbols?.length ?? 0})`, fmt.pct(bah.equalWeight?.returnPct), fin(bah.equalWeight?.maxDrawdownPct) ? `${bah.equalWeight.maxDrawdownPct.toFixed(2)}%` : '—'],
          [bah.benchmark || 'SPY', fmt.pct(bah.spy?.returnPct), fin(bah.spy?.maxDrawdownPct) ? `${bah.spy.maxDrawdownPct.toFixed(2)}%` : '—'],
        ], { numeric: [1, 2] }),
        h('div', { class: 'small muted' }, `${bah.from} to ${bah.to}; ${bah.basis}.${bah.equalWeightMissing?.length ? ` Missing: ${bah.equalWeightMissing.join(', ')}.` : ''}`)] : h('div', { class: 'small muted' }, 'Not stored for this run type.'),
        h('h4', { class: 'lab-h4' }, 'Costs (simulated)'),
        h('dl', { class: 'kv small' },
          h('dt', {}, 'Commission'), h('dd', {}, money(costs.commission)),
          h('dt', {}, 'Spread + slippage'), h('dd', {}, money(costs.spreadSlippage)),
          h('dt', {}, 'Currency conversion'), h('dd', {}, money(costs.fx)),
          h('dt', {}, 'Total'), h('dd', {}, `${money(costs.total)}${fin(costs.perTrade) ? ` · ${money(costs.perTrade)} per trade` : ''}`)))));
}

function groupTable(rows, keyLabel) {
  if (!rows.length) return h('div', { class: 'small muted' }, 'No trades.');
  return table([keyLabel, 'Trades', 'Win rate', 'Mean R', 'Net', 'PF'], rows.map((g) => [
    h('span', {}, g.key, g.trades < 10 ? h('span', { class: 'cell-sub' }, ' (few)') : null), g.trades, share(g.winRate), h('span', { class: tone(g.meanR) }, rTxt(g.meanR)), h('span', { class: tone(g.net) }, sMoney(g.net)), fin(g.profitFactor) ? g.profitFactor.toFixed(2) : '—',
  ]), { numeric: [1, 2, 3, 4, 5] });
}

function comparison(L, runs) {
  const host = h('div', { class: 'stack lab-cmps' });
  const latest = (mode, test) => runs.find((r) => r.mode === mode && r.status === 'done' && test(r)) || null;
  Promise.all(MODES.map(async ([mode]) => {
    const f = await allTrades(L, { source: 'forward', mode });
    return [mode, forwardStats(f.trades), f.trades.length];
  })).then((fwd) => {
    if (L.ep !== epoch) return;
    mount(host, fwd.map(([mode, fs]) => {
      const cols = [
        ['Development', latest(mode, (r) => r.kind === 'backtest' && r.split === 'development')],
        ['Validation', latest(mode, (r) => r.kind === 'backtest' && r.split === 'validation')],
        ['Walk-forward (out of sample)', latest(mode, (r) => r.kind === 'walk_forward')],
        ['Holdout', latest(mode, (r) => r.kind === 'holdout' && !r.contaminated) || latest(mode, (r) => r.kind === 'holdout')],
      ].map(([label, r]) => [label, r?.headline || null, r]);
      cols.push(['Forward test', fs.trades ? fs : null, null]);
      const row = (label, fn) => [label, ...cols.map(([, x]) => (x ? fn(x) : '—'))];
      const rows = [
        row('Trades (sample)', (x) => h('span', {}, String(x.trades ?? '—'), fin(x.trades) && x.trades < SMALL_SAMPLE ? h('span', { class: 'badge warn lab-mini' }, 'small') : null)),
        row('Win rate', (x) => share(x.winRate)),
        row('Mean R', (x) => h('span', { class: tone(x.meanR) }, rTxt(x.meanR))),
        row('Mean R 95% CI', (x) => (x.meanRCI ? `${rTxt(x.meanRCI.lower)} to ${rTxt(x.meanRCI.upper)}` : '—')),
        row('Profit factor', (x) => (fin(x.profitFactor) ? x.profitFactor.toFixed(2) : '—')),
        row('Net P/L', (x) => h('span', { class: tone(x.netPnl) }, sMoney(x.netPnl))),
        row('Max drawdown', (x) => (fin(x.maxDrawdownPct) ? `${x.maxDrawdownPct.toFixed(2)}%` : '—')),
      ];
      const head = ['', ...cols.map(([label, , r]) => h('span', {}, label, r ? h('span', { class: 'cell-sub' }, ` #${r.id}`) : null, r?.contaminated ? h('span', { class: 'badge danger lab-mini' }, 'contaminated') : null))];
      return h('div', { class: mode === S.mode ? 'lab-cmp current' : 'lab-cmp' },
        h('div', { class: 'row' }, h('strong', {}, MODE_LABEL[mode]), mode === S.mode ? badge('selected mode', 'info') : null),
        table(head, rows, { numeric: [1, 2, 3, 4, 5], cls: 'lab-cmp-table' }));
    }), h('p', { class: 'small muted' },
      `"small" marks fewer than ${SMALL_SAMPLE} trades: the figures can swing widely. The acceptance criteria need at least 60 validation trades and 100 holdout and forward trades. Forward-test figures are summed here from its closed trades (end-of-data closes excluded); its drawdown is not computed. "—" means not run yet.`));
  }, (e) => { if (L.ep === epoch) mount(host, errorState(e)); });
  mount(host, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Loading…'));
  return host;
}

function acceptanceBlock(o) {
  const a = o.acceptance;
  if (!a) return h('div', {}, h('h4', { class: 'lab-h4' }, 'Acceptance criteria'), h('div', { class: 'small muted' }, 'Not evaluated (see the warnings at the top).'));
  const [ol, ok] = OUTCOME[a.outcome] || [a.outcome, ''];
  const statusOf = (c) => (c.status === 'not_evaluable' && /inconclusive/i.test(c.note || '') ? 'inconclusive' : c.status);
  return h('div', {},
    h('h4', { class: 'lab-h4' }, `Acceptance criteria (${MODE_LABEL[S.mode]})`),
    h('div', { class: 'row lab-outcome' }, h('span', { class: 'small muted' }, 'Outcome'), badge(ol, ok),
      a.stages ? Object.entries(a.stages).map(([k, v]) => h('span', { class: 'small muted' }, `${k}: ${(OUTCOME[v] || [v])[0].replace(/ \(.*\)$/, '')}`)) : null,
      a.synthetic ? badge('synthetic: nothing counts', 'warn') : null),
    h('p', { class: 'small' }, a.note || '"Eligible for review" only means the evidence may be reviewed; it never means ready to trade.'),
    table(['', 'Criterion', 'Status', 'Value'], (a.criteria || []).map((c) => {
      const st = statusOf(c);
      const [l, k] = CRIT[st] || [st, ''];
      const comp = c.computedStatus && c.computedStatus !== c.status ? h('div', { class: 'cell-sub' }, `computed: ${(CRIT[c.computedStatus] || [c.computedStatus])[0].toLowerCase()} (not counted)`) : null;
      const note = c.note && !(a.synthetic && /^synthetic data/.test(c.note)) ? h('div', { class: 'cell-sub' }, c.note) : null;
      return [h('span', { class: 'mono' }, c.id), h('div', {}, h('strong', {}, c.name), h('div', { class: 'cell-sub' }, c.rule)), h('div', {}, badge(l, k), comp, note), h('span', { class: 'small' }, valueText(c.value))];
    }), { cls: 'lab-crit' }),
    a.synthetic ? h('div', { class: 'small muted' }, 'Synthetic data can neither satisfy nor fail a criterion, so every status above is "not evaluable"; the computed result is shown only to check the evaluator.') : null);
}

// ---------- 7. runs and versions ----------

function runsSection(L) {
  const { o, ep } = L;
  const running = o.jobs?.running;
  const noData = o.status === 'needs_data';
  const status = h('div', { 'aria-live': 'polite' });
  const listHost = h('div', {});
  const buttons = [];
  const setBusy = (busy) => { for (const b of buttons) b.disabled = busy || noData ? true : null; };

  const loadRuns = () => lazy(ep, async () => {
    const r = await L.api('GET', `/api/lab/runs?mode=${S.mode}&limit=50`);
    if (!r.runs.length) return h('div', { class: 'small muted' }, 'No runs yet for this mode.');
    return table(['Run', 'Period', 'Status', 'Trades', 'Mean R', 'PF', 'Net', 'Finished'], r.runs.map((x) => [
      h('button', { class: 'linklike lab-link', type: 'button', onclick: () => openReport(L, x.id) }, `#${x.id} ${x.kind === 'backtest' ? x.split : x.kind.replace('_', '-')}`,
        x.synthetic ? h('span', { class: 'badge warn lab-mini' }, 'synthetic') : null, x.contaminated ? h('span', { class: 'badge danger lab-mini' }, 'contaminated') : null),
      h('span', { class: 'small' }, `${x.from || '—'} to ${x.to || 'now'}`),
      h('div', {}, badge(x.status, x.status === 'done' ? 'ok' : x.status === 'failed' ? 'danger' : 'info'), x.error ? h('div', { class: 'cell-sub neg' }, x.error) : null),
      x.headline?.trades ?? '—', rTxt(x.headline?.meanR), fin(x.headline?.profitFactor) ? x.headline.profitFactor.toFixed(2) : '—',
      h('span', { class: tone(x.headline?.netPnl) }, sMoney(x.headline?.netPnl)), h('span', { class: 'small' }, x.finishedAt ? whenShort(x.finishedAt) : '—'),
    ]), { numeric: [3, 4, 5, 6] });
  });

  const watch = (id, label) => {
    setBusy(true);
    const started = Date.now();
    const show = () => mount(status, notice('info', h('span', { class: 'spinner lab-inline-spin' }), ` Running ${label} (run #${id}) in the background… ${Math.round((Date.now() - started) / 1000)} s. You can keep using the page.`));
    show();
    poll(ep, 2000, async () => {
      const r = await L.api('GET', `/api/lab/runs/${id}`);
      if (r.run.status === 'running') { show(); return true; }
      if (r.run.status === 'failed') {
        mount(status, notice('danger', `Run #${id} failed: ${r.run.error || 'unknown error'}`));
        setBusy(false);
        mount(listHost, loadRuns());
        return false;
      }
      toast(`Run #${id} finished (${plural(r.run.tradeCount ?? 0, 'simulated trade')})`);
      S.perfRun[S.mode] = r.run.kind === 'stress' ? S.perfRun[S.mode] : id;
      L.reload();
      return false;
    });
  };

  for (const [split, label] of SPLITS) {
    const b = h('button', { class: 'btn small', type: 'button' }, label);
    b.addEventListener('click', async () => {
      setBusy(true);
      mount(status);
      try {
        const r = await L.api('POST', '/api/lab/runs', { mode: S.mode, split });
        watch(r.run.id, `${label.toLowerCase()} (${MODE_LABEL[S.mode]})`);
      } catch (e) {
        mount(status, notice('danger', e.message));
        setBusy(false);
      }
    });
    buttons.push(b);
  }
  const hold = h('button', { class: 'btn small danger', type: 'button' }, 'Holdout…');
  hold.addEventListener('click', () => holdoutDialog(L, watch));
  buttons.push(hold);
  setBusy(!!running);
  if (running?.runId) watch(running.runId, running.label);
  else if (running) mount(status, notice('info', `Busy: ${running.label} (started ${fmt.ago(running.startedAt)}). Runs can start when it has finished.`));
  if (noData) mount(status, h('div', { class: 'small muted' }, 'Runs need stored bars for their period; import or download data first.'));
  mount(listHost, loadRuns());

  return labSection('runs', `Runs and versions · ${MODE_LABEL[S.mode]}`,
    h('div', { class: 'row' }, buttons),
    h('p', { class: 'small muted' }, 'Development and validation backtest their pre-registered periods; stress re-runs validation with harsher costs and neighbouring settings; walk-forward re-selects settings in rolling windows. The holdout is the one final evaluation of a version.'),
    status, listHost,
    lazy(ep, () => versionsBlock(L)));
}

async function openReport(L, id) {
  const d = drawer(`Run #${id}`, loading(), { wide: true });
  try {
    const { run } = await L.api('GET', `/api/lab/runs/${id}`);
    mount(d.body,
      run.synthetic ? notice('warn', 'SYNTHETIC — demonstrates the interface, not the strategy.') : null,
      h('div', { class: 'row small' }, badge(run.status, run.status === 'done' ? 'ok' : run.status === 'failed' ? 'danger' : 'info'), h('span', { class: 'muted' }, `${run.label || ''} · version ${run.version} · config ${shortHash(run.configHash)}`)),
      run.reason ? h('div', { class: 'small' }, `Reason given: ${run.reason}`) : null,
      run.error ? notice('danger', run.error) : null,
      run.report ? h('pre', { class: 'lab-report' }, run.report) : h('div', { class: 'small muted' }, 'No report stored for this run.'));
  } catch (e) {
    mount(d.body, errorState(e));
  }
}

async function holdoutDialog(L, watch) {
  const { o } = L;
  const v = o.version || {};
  let versions;
  try { versions = await L.api('GET', '/api/lab/versions'); } catch (e) { toast(e.message, 'error'); return; }
  const prior = (versions.holdoutRuns || []).filter((r) => r.version === v.version && r.config_hash === v.configHash && r.mode === S.mode);
  const reason = h('textarea', { name: 'reason', maxlength: 2000, rows: 3, placeholder: 'Why the holdout must be run again (required for a repeat)' });
  const ack = h('input', { type: 'checkbox', name: 'ack' });
  const end = o.data?.required?.to;
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    notice('warn', `The holdout${end ? ` (the period ending ${day(end)})` : ''} is the one final, untouched evaluation of version ${v.version} (config ${shortHash(v.configHash)}) in ${MODE_LABEL[S.mode]} mode. It runs once per version. Looking at it and then changing the rules turns it into one more backtest.`),
    prior.length
      ? h('div', { class: 'stack', style: { gap: '8px' } },
        notice('danger', `Already run ${plural(prior.length, 'time')} for this version and mode (first on ${when(prior[0].at)}). Another run needs a written reason and will be marked contaminated: it cannot satisfy the acceptance criteria.`),
        field('Reason for running it again', reason, 'Up to 2,000 characters. Stored with the run.'))
      : null,
    h('label', { class: 'check' }, ack, prior.length ? 'I understand this run will be marked contaminated.' : 'I understand this uses the version\'s one clean holdout run.'),
    h('div', { class: 'small muted' }, 'Simulation only: the holdout replays stored bars on the hypothetical account. Nothing is ordered.'));
  confirmDialog('Run the holdout?', body, {
    confirmLabel: prior.length ? 'Run again (contaminated)' : 'Run the holdout',
    ready: () => (!ack.checked ? 'Tick the box to confirm.' : prior.length && !reason.value.trim() ? 'A repeat needs a written reason.' : true),
    onConfirm: async () => {
      const r = await L.api('POST', '/api/lab/holdout', { mode: S.mode, confirm: true, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) });
      watch(r.run.id, `holdout (${MODE_LABEL[S.mode]})${r.run.contaminated ? ', contaminated' : ''}`);
    },
  });
}

async function versionsBlock(L) {
  const v = await L.api('GET', '/api/lab/versions');
  const configs = v.configs || [];
  const opts = configs.filter((c) => c.valid).map((c) => [c.version, `${c.version}${c.active ? ' (active)' : ''}`]);
  const diffHost = h('div', {});
  const fromSel = select('from', opts, opts.length > 1 ? opts[opts.length - 2][0] : opts[0]?.[0]);
  const toSel = select('to', opts, opts[opts.length - 1]?.[0]);
  fromSel.setAttribute('aria-label', 'From version');
  toSel.setAttribute('aria-label', 'To version');
  const compare = async () => {
    mount(diffHost, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), 'Comparing…'));
    try {
      const d = await L.api('GET', `/api/lab/versions/diff?from=${encodeURIComponent(fromSel.value)}&to=${encodeURIComponent(toSel.value)}`);
      mount(diffHost,
        h('div', { class: 'small' }, d.sameRules ? `Versions ${d.from.version} and ${d.to.version} have the same rules (config ${shortHash(d.to.configHash)}).` : `${plural(d.changes.length, 'change')} from ${d.from.version} to ${d.to.version}.`),
        d.changes.length ? table(['Parameter', 'From', 'To', ''], d.changes.map((c) => [h('span', { class: 'mono' }, c.path), valueText(c.from), valueText(c.to), c.descriptive ? badge('descriptive only', 'muted') : badge('rule', 'warn')])) : null);
    } catch (e) {
      mount(diffHost, notice('danger', e.message));
    }
  };
  const cmpBtn = h('button', { class: 'btn small', type: 'button', onclick: compare }, 'Compare');
  return h('div', { class: 'stack mt' },
    h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Strategy versions'),
      table(['Version', 'Label', 'Status', 'Created', 'Config hash', ''], configs.map((c) => [
        h('strong', {}, c.version || c.file), c.label || '—', h('span', { class: 'small' }, c.status || '—'), c.createdAt || '—',
        h('span', { class: 'mono small', title: c.configHash || '' }, shortHash(c.configHash)),
        h('div', {}, c.active ? badge('active', 'ok') : null, !c.valid ? badge('invalid', 'danger') : null, !c.valid ? h('div', { class: 'cell-sub neg' }, (c.errors || []).join('; ')) : null),
      ])),
      v.note ? h('div', { class: 'small muted' }, v.note) : null),
    h('div', {}, h('h4', { class: 'lab-h4' }, 'Parameter diff'),
      opts.length < 2
        ? h('div', { class: 'small muted' }, `Only one version exists (${opts[0]?.[0] || 'none'}), so there is nothing to compare yet. A rule change is always a new version with its own config file.`)
        : h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'row' }, h('div', { style: { width: '140px' } }, fromSel), '→', h('div', { style: { width: '140px' } }, toSel), cmpBtn), diffHost)),
    h('div', {}, h('h4', { class: 'lab-h4' }, 'Parameter change log (PARAMETER-LOG.md)'),
      (v.parameterLog || []).length ? table(['Date', 'Version', 'Change', 'Reason', 'Data seen'], v.parameterLog.map((p) => [p.date, p.versionLabel || p.version, h('span', { class: 'small' }, p.change), h('span', { class: 'small' }, p.reason), h('span', { class: 'small' }, p.dataSeen)])) : h('div', { class: 'small muted' }, 'No entries.')),
    (v.labChanges || []).length ? h('details', { class: 'more' }, h('summary', {}, `Recorded by this Lab (${v.labChanges.length})`),
      table(['When', 'Version', 'Parameter', 'From → to', 'Reason', 'Data seen'], v.labChanges.map((c) => [whenShort(c.at), `${c.fromVersion || '—'} → ${c.toVersion}`, h('span', { class: 'mono small' }, c.path), h('span', { class: 'small' }, `${valueText(c.from)} → ${valueText(c.to)}`), h('span', { class: 'small' }, c.reason || ''), h('span', { class: 'small' }, c.dataSeen ?? '—')]))) : null,
    h('details', { class: 'more' }, h('summary', {}, `Holdout ledger (${(v.holdoutRuns || []).length})`),
      (v.holdoutRuns || []).length ? table(['When', 'Version', 'Mode', 'Run', 'Reason', ''], v.holdoutRuns.map((x) => [whenShort(x.at), x.version, x.mode, `#${x.run_id}`, h('span', { class: 'small' }, x.reason || '—'), x.contaminated ? badge('contaminated', 'danger') : badge('clean', 'ok')]))
        : h('div', { class: 'small muted' }, 'The holdout has not been run for any version.')));
}

// ---------- 8. data ----------

function dataSection(L) {
  const { o } = L;
  const n = o.needs;
  const syms = o.data?.symbols || [];
  const blocks = [];
  if (n) {
    const per = n.dateRange?.periods || {};
    blocks.push(notice('warn', h('strong', {}, 'No market data yet. '), n.what || 'Bars are needed before anything can be simulated.'),
      h('div', { class: 'grid two mt' },
        h('div', {},
          h('h4', { class: 'lab-h4 first' }, '1. A data source'),
          h('ul', { class: 'bullets small' }, (n.dataSources || []).map((s) => h('li', {}, s))),
          n.lowerTimeframe ? h('div', { class: 'small muted' }, n.lowerTimeframe) : null,
          h('h4', { class: 'lab-h4' }, '2. The date range'),
          h('div', { class: 'small' }, `${day(n.dateRange?.from)} to ${day(n.dateRange?.to)}`),
          h('dl', { class: 'kv small' }, Object.entries(per).map(([k, p]) => [h('dt', {}, k[0].toUpperCase() + k.slice(1)), h('dd', {}, `${day(p.from)} – ${day(p.to)}`)]),
            n.dateRange?.forward ? [h('dt', {}, 'Forward test'), h('dd', {}, n.dateRange.forward)] : null),
          n.note ? h('div', { class: 'small muted mt' }, n.note) : null),
        h('div', {},
          h('h4', { class: 'lab-h4 first' }, `3. The universe (${(n.universe || []).length} symbols)`),
          table(['Symbol', 'Exchange', 'Sector', 'Cluster'], (n.universe || []).map((u) => [h('span', { class: 'sym' }, u.symbol), u.exchange, h('span', { class: 'small' }, u.sector || '—'), u.cluster || '—'])))));
  } else if (syms.length) {
    blocks.push(h('details', { class: 'more' }, h('summary', {}, `Coverage per symbol (${syms.filter((s) => s.bars).length} of ${syms.length} with bars; pre-registered range ${day(o.data?.required?.from)} to ${day(o.data?.required?.to)})`),
      table(['Symbol', 'Exchange', 'Bars', 'First', 'Last', 'Source'], syms.map((s) => [h('span', { class: 'sym' }, s.symbol), s.exchange, s.bars ? s.bars.toLocaleString('en-US') : '0', s.first ? whenShort(s.first) : '—', s.last ? whenShort(s.last) : '—',
        h('span', { class: 'small' }, (s.sources || []).join(', ') || '—', s.synthetic ? h('span', { class: 'badge warn lab-mini' }, 'synthetic') : null)]), { numeric: [2] })));
  }
  blocks.push(h('div', { class: 'grid two mt' }, importCard(L), fetchCard(L)));
  blocks.push(webhookCard(L));
  return labSection('data', n ? 'Data needed' : 'Data', ...blocks);
}

function importCard(L) {
  const { o } = L;
  const universe = (o.needs?.universe || o.data?.symbols || []).map((s) => [s.symbol, `${s.symbol} · ${s.exchange}`]);
  const file = h('input', { type: 'file', name: 'file', accept: '.csv,.txt,text/csv', disabled: L.demo ? true : null });
  const sym = select('symbol', universe, universe[0]?.[0]);
  if (L.demo) sym.disabled = true;
  const format = select('format', [['auto', 'Detect automatically'], ['tradingview', 'TradingView chart export'], ['generic', 'Generic CSV (time, open, high, low, close, volume)']], 'auto');
  const out = h('div', { 'aria-live': 'polite' });
  if (L.demo) format.disabled = true;
  const btn = h('button', { class: 'btn primary small', type: 'button', disabled: L.demo ? true : null }, 'Import CSV');
  file.addEventListener('change', () => {
    const name = (file.files[0]?.name || '').toUpperCase();
    const hit = universe.find(([s]) => new RegExp(`(^|[^A-Z])${s}([^A-Z]|$)`).test(name));
    if (hit) sym.value = hit[0];
  });
  btn.addEventListener('click', async () => {
    const f = file.files[0];
    if (!f) { mount(out, notice('warn', 'Choose a CSV file first.')); return; }
    if (f.size > MAX_CSV_BYTES) { mount(out, notice('danger', 'The file is larger than 20 MB; split it into smaller files.')); return; }
    btn.disabled = true;
    mount(out, h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), `Importing ${f.name} for ${sym.value}…`));
    try {
      const text = await f.text();
      const r = await L.api('POST', '/api/lab/import', { symbol: sym.value, text, format: format.value });
      mount(out, importResult(r), h('button', { class: 'btn small mt', type: 'button', onclick: () => L.reload() }, 'Refresh the page with the new data'));
      toast(`${r.symbol}: ${r.stored?.inserted ?? 0} bars added`);
    } catch (e) {
      mount(out, notice('danger', `Import failed: ${e.message}`));
    } finally {
      btn.disabled = L.demo ? true : null;
    }
  });
  return h('div', { class: 'lab-panel' },
    h('h4', { class: 'lab-h4 first' }, 'Import CSV'),
    L.demo ? notice('info', 'The demo workspace holds synthetic data only. Switch to your workspace to import market data.') : null,
    h('div', { class: 'form-grid' }, field('File', file, 'One symbol per file, 15-minute candles (1- or 5-minute files are aggregated), up to 20 MB.'), field('Symbol', sym), field('Format', format)),
    h('div', { class: 'row mt' }, btn, h('span', { class: 'small muted' }, 'Read in your browser and sent only to this Signal Desk.')),
    out);
}

function importResult(r) {
  const q = r.quality || {};
  const rows = r.rows || {};
  return h('div', { class: 'stack mt', style: { gap: '8px' } },
    notice(q.ok ? 'info' : 'warn', `${r.symbol} (${r.exchange}): ${rows.parsed ?? 0} of ${rows.read ?? 0} rows parsed (${rows.rejected ?? 0} rejected) as ${r.format}, ${r.inputIntervalMinutes}-minute input. ${r.stored?.inserted ?? 0} bars added, ${r.stored?.replaced ?? 0} replaced.${r.coverage ? ` Now ${r.coverage.bars.toLocaleString('en-US')} bars, ${when(r.coverage.first)} to ${when(r.coverage.last)}.` : ''}`),
    (r.notes || []).length ? h('ul', { class: 'bullets small' }, r.notes.map((x) => h('li', {}, x))) : null,
    h('div', { class: 'small' }, h('strong', {}, 'Quality report: '), q.ok ? badge('no problems found', 'ok') : badge('check before relying on results', 'warn')),
    h('dl', { class: 'kv small' },
      h('dt', {}, 'Sessions'), h('dd', {}, `${q.sessionsWithBars ?? '—'} of ${q.sessions ?? '—'} with bars (${q.missingSessions ?? 0} missing, ${q.incompleteSessions ?? 0} incomplete)`),
      h('dt', {}, 'Bars'), h('dd', {}, `${q.presentBars ?? '—'} of ${q.expectedBars ?? '—'} expected (${q.missingBars ?? 0} missing)`),
      h('dt', {}, 'Problems'), h('dd', {}, `duplicates ${q.duplicates ?? 0} · unsorted ${q.unsorted ?? 0} · non-positive prices ${q.nonPositivePrices ?? 0} · high below low ${q.highBelowLow ?? 0} · OHLC outside range ${q.ohlcOutsideRange ?? 0} · outside session ${q.outsideSession ?? 0} · misaligned ${q.misaligned ?? 0}`),
      h('dt', {}, 'Volume'), h('dd', {}, `${q.missingVolume ?? 0} bars missing volume (${fin(q.missingVolumePct) ? q.missingVolumePct.toFixed(1) : '0'}%)`),
      h('dt', {}, 'Large moves'), h('dd', {}, `${q.bigMoves ?? 0} closes moved more than ${q.bigMovePct ?? 20}% bar to bar (check for unadjusted splits)`),
      h('dt', {}, 'Dropped'), h('dd', {}, valueText(r.dropped)),
      h('dt', {}, 'Dataset hash'), h('dd', { class: 'mono' }, shortHash(r.dataHash))),
    q.incompleteSessionList?.length ? h('details', { class: 'more' }, h('summary', {}, `Incomplete sessions (${q.incompleteSessions})`),
      h('div', { class: 'small' }, q.incompleteSessionList.slice(0, 50).map((x) => `${x.date}: ${x.present}/${x.expected}${x.earlyClose ? ' (early close)' : ''}`).join(' · '))) : null,
    q.bigMoveList?.length ? h('details', { class: 'more' }, h('summary', {}, `Large moves (${q.bigMoves})`),
      h('div', { class: 'small' }, q.bigMoveList.slice(0, 50).map((x) => `${whenShort(x.t)}: ${px(x.fromClose)} → ${px(x.close)} (${fmt.pct(x.pct, 1)})`).join(' · '))) : null,
    rows.rejectedSample?.length ? h('details', { class: 'more' }, h('summary', {}, `Rejected rows (first ${rows.rejectedSample.length})`),
      h('ul', { class: 'bullets small' }, rows.rejectedSample.map((x) => h('li', {}, typeof x === 'string' ? x : JSON.stringify(x))))) : null);
}

function fetchCard(L) {
  const { o, ep } = L;
  const provider = o.settings?.marketProvider;
  const hasProvider = !L.demo && provider && provider !== 'none';
  const today = ET_DATE.format(new Date());
  const from = h('input', { type: 'date', name: 'from', value: o.needs?.dateRange?.from || o.data?.required?.from || '2021-07-01', max: today });
  const to = h('input', { type: 'date', name: 'to', value: today, max: today });
  const symbols = h('input', { type: 'text', name: 'symbols', placeholder: 'Blank = whole universe', autocomplete: 'off' });
  for (const el of [from, to, symbols]) el.disabled = !hasProvider;
  const btn = h('button', { class: 'btn primary small', type: 'button', disabled: hasProvider ? null : true }, 'Download history');
  const out = h('div', { 'aria-live': 'polite' });
  const err = h('div', { role: 'alert' });
  let polling = false;
  const show = (job) => mount(out, job ? fetchJobView(job) : null,
    job && job.status !== 'running' && job.symbols?.some((x) => x.bars > 0) ? h('button', { class: 'btn small mt', type: 'button', onclick: () => L.reload() }, 'Refresh the page with the new data') : null);
  const follow = () => {
    if (polling) return;
    polling = true;
    poll(ep, 3000, async () => {
      const r = await L.api('GET', '/api/lab/fetch');
      show(r.job);
      if (r.job?.status === 'running') return true;
      polling = false;
      if (r.job && r.job.status !== 'running') toast(`History download ${r.job.status.replace(/_/g, ' ')}`);
      return false;
    });
  };
  btn.addEventListener('click', async () => {
    mount(err);
    btn.disabled = true;
    try {
      const list = symbols.value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      const r = await L.api('POST', '/api/lab/fetch', { from: from.value || undefined, to: to.value || undefined, ...(list.length ? { symbols: list } : {}) });
      show(r.job);
      if (r.note) mount(err, h('div', { class: 'small muted' }, r.note));
      follow();
    } catch (e) {
      mount(err, notice('danger', `Download not started: ${e.message}`));
    } finally {
      btn.disabled = hasProvider ? null : true;
    }
  });
  show(o.fetchJob);
  if (o.fetchJob?.status === 'running') follow();
  return h('div', { class: 'lab-panel' },
    h('h4', { class: 'lab-h4 first' }, 'Download history'),
    L.demo ? notice('info', 'The demo workspace holds synthetic data only. Switch to your workspace to download market data.')
      : !hasProvider ? notice('warn', 'No market-data provider is connected. Set MARKET_DATA_PROVIDER=twelvedata and TWELVEDATA_API_KEY in .env and restart Signal Desk, or import CSV files instead.')
        : h('div', { class: 'small muted' }, `Through ${provider}: one request per symbol per quarter of data, within the provider's rate limits. Progress is saved and resumes after a restart.`),
    h('div', { class: 'form-grid' }, field('From', from), field('To', to), field('Symbols', symbols, 'e.g. NVDA, SPY')),
    h('div', { class: 'row mt' }, btn),
    err, out);
}

function fetchJobView(job) {
  const kind = { running: 'info', paused: 'warn', failed: 'danger', done: 'ok', done_with_errors: 'warn' }[job.status] || '';
  return h('div', { class: 'stack mt', style: { gap: '8px' } },
    h('div', { class: 'row small' }, badge(job.status.replace(/_/g, ' '), kind), `${job.provider} · ${job.from} to ${job.to} · ${job.done} of ${job.total} symbols done · updated ${fmt.ago(job.updatedAt)}`),
    job.status === 'running' ? meter(job.total ? job.done / job.total : 0, 2) : null,
    job.error ? notice(job.status === 'failed' ? 'danger' : 'warn', job.error, job.resumeAfter ? ` Resumes after ${when(job.resumeAfter)}.` : '') : null,
    h('div', { class: 'lab-symgrid' }, (job.symbols || []).map((s) => h('div', { class: `lab-symcell ${s.status === 'error' ? 'missing' : ''}` },
      h('span', { class: 'row' }, h('span', { class: 'sym' }, s.symbol), badge(s.status, { done: 'ok', error: 'danger', running: 'info', pending: 'muted' }[s.status] || '')),
      h('span', { class: 'cell-sub' }, `${(s.bars || 0).toLocaleString('en-US')} bars${s.fetchedThrough ? ` · through ${s.fetchedThrough}` : ''}`),
      s.error ? h('span', { class: 'cell-sub neg' }, s.error) : null))));
}

function webhookCard(L) {
  const { o, ep } = L;
  const wh = o.settings?.webhook || {};
  const status = L.demo
    ? [badge('Not available in the demo', 'muted'), h('div', { class: 'small muted' }, 'The receiver runs only in your own workspace.')]
    : wh.enabled
      ? [badge('Configured', 'ok'), h('div', { class: 'small' }, `Listening on 127.0.0.1:${wh.port}/tradingview. The secret is set in .env and is never shown here.`)]
      : [badge('Not configured', 'muted'), h('div', { class: 'small muted' }, 'Optional. Set LAB_WEBHOOK_SECRET (at least 24 random characters) and LAB_WEBHOOK_PORT in .env and restart; see strategy/TRADINGVIEW-SETUP.md. It needs a tunnel or reverse proxy you set up deliberately.')];
  return h('div', { class: 'lab-panel mt' },
    h('h4', { class: 'lab-h4 first' }, 'TradingView alert receiver'),
    h('div', { class: 'row' }, status[0]), status[1],
    h('div', { class: 'small muted' }, 'Alerts are journalled and compared with Signal Desk\'s own signals. They never drive the simulated account and never place anything.'),
    L.demo ? null : lazy(ep, async () => {
      const j = await L.api('GET', '/api/lab/journal?source=tradingview&limit=20');
      if (!j.items.length) return h('div', { class: 'small muted' }, 'No alerts received.');
      return h('details', { class: 'more' }, h('summary', {}, `Recent alerts (${j.items.length})`),
        h('div', { class: 'list' }, j.items.map((a) => h('div', { class: 'list-item small' },
          h('div', { class: 'row' }, badge(a.status, a.status === 'accepted' ? 'ok' : a.status === 'duplicate' ? 'muted' : 'danger'), h('span', { class: 'sym' }, a.symbol || '—'), h('span', {}, a.type || ''), h('span', { class: 'muted' }, when(a.at))),
          a.reason ? h('div', {}, a.reason) : null,
          a.comparison ? h('div', { class: 'muted' }, a.comparison.matched === true ? `Matches Signal Desk event #${a.comparison.eventId}` : a.comparison.matched === false ? `No match: ${a.comparison.note || ''}` : a.comparison.note || '') : null))));
    }));
}
