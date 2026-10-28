// HXR (simulated): the pre-registered hold / exit / re-enter study
// (strategy/hxr/PREREGISTRATION.md and ENGINE-SPEC.md). Everything here is a
// simulated account: the page never reads or changes your real holdings or
// cash, never sends an order to a broker or paper-trading platform and never
// sends a notification. Every text from the server, third-party news
// included, is rendered as a text node through h(), never as markup. Figures
// come from the server; this page only formats them and, in the side-by-side
// tables, subtracts the hold's figure from HXR's. What the server does not
// return is shown as missing, never estimated.
import { h, mount, fmt, tone, notice, empty, badge, drawer, field, select, toast, errorState, extLink } from '../lib/ui.js';
import { line } from '../lib/charts.js';

const PAGE_SIZE = 50;
const RECENT = 20;
const OUTCOME = {
  PASS: ['PASS', 'ok'], FAIL: ['FAIL', 'danger'], INSUFFICIENT_EVIDENCE: ['INSUFFICIENT EVIDENCE', 'warn'], NOT_COUNTED_CONTAMINATED: ['NOT COUNTED (contaminated)', 'danger'],
};
const CRIT = { pass: ['Pass', 'ok'], fail: ['Fail', 'danger'], not_evaluable: ['Not evaluable', 'muted'] };
const READY = { complete: 'ok', issues: 'danger', 'no data': 'muted' };
const SPLIT = { pass: 'ok', fail: 'danger', 'no data': 'warn', future: 'muted' };
const JOB = { running: 'info', paused: 'warn', failed: 'danger', done: 'ok', done_with_errors: 'warn', pending: 'muted', skipped: 'muted', error: 'danger' };
const PERIODS = [['development', 'Development'], ['validation', 'Validation'], ['final', 'Final'], ['fullList', 'Full-list check'], ['prospective', 'Prospective']];
const BENCH = { hold: 'Hold (fully invested)', holdDayOne: 'Hold the day-one positions' };
const VOUT = { validated: ['Validated', 'ok'], did_not_validate: ['Did not validate', 'danger'], insufficient_evidence: ['Insufficient evidence', 'muted'], not_counted_contaminated: ['Not counted (contaminated)', 'danger'] };
const POLICY = { stay_out: 'A: stay in cash for the rest of the period', fresh_entry_recovery_point: 'B: a fresh entry at the next recovery point, at any price', fresh_entry_after_sessions: 'C: a fresh entry at the next recovery point after the cooling-off period', pending_owner_choice: 'pending your choice' };
const PERIOD_LABEL = Object.fromEntries(PERIODS);
const VARIANT = {
  main: 'Base costs (the judged run)', costs2x: 'Spread and slippage doubled (G5)', delay2: 'Fills two sessions after the decision (G5)',
  vw15: 'First 15-minute VWAP fills (reported)', withholding0: '0% dividend withholding (reported)', fullList: 'Basket B full-list check (reported, not a gate)',
  'fullList-vw15': 'Basket B full-list check, first 15-minute VWAP fills (reported)',
};
const VALUE_LABEL = {
  close: 'close', sma: 'average', smaSessions: 'average length', bandPct: 'band %', lower: 'exit level', upper: 'buy-back level', vol: 'typical daily move',
  volSessions: 'move window', multiple: 'multiple', anchorHigh: 'highest close since buying', anchorLow: 'lowest close since selling', level: 'trigger level',
  exitDrawdownPct: 'exit drop %', reentryRisePct: 'buy-back rise %',
  m: 'typical daily move', exitPrice: 'exit price', recoveryClose: 'recovery-point close', highestAfter: 'highest close after it',
  pivotSessions: 'recovery window', reboundMultiple: 'rebound (× move)', bufferMultiple: 'buffer (× move)', entryPrice: 'buy price',
  givebackPct: 'give-back %', initialLossLevel: 'initial-loss level', ruleLevel: "rule's own level", previousExitPrice: 'previous sale price', sessionsOut: 'sessions out',
  afterMissedRebound: 'after a missed rebound', policy: 'policy', peak: 'account peak', decline: 'decline from the peak', value: 'account value',
};
// Why each rule was chosen (PREREGISTRATION-2.md section 3; C1-C3 from the
// superseded PREREGISTRATION.md section 6); the numbers come from the configs.
const WHY = {
  recovery_break: 'Your idea of a rise that keeps making higher lows: it sells when the price closes below an earlier low from which it rose again. The low only counts 5 sessions after it formed, so no future recovery is used.',
  move_allowance: 'Gives each stock room for its own normal daily movement below its highest close since buying.',
  giveback: 'Your 10% give-back idea, as a comparison only: it is run and shown, but can never be picked.',
  hold: 'The comparison: the same stocks, cash, costs, dividends and whole-share rule, never sold.',
  ma_band: 'The most common trend filter; the band reduces flip-flopping around the average.',
  vol_trail: 'Adjusts to each stock\'s volatility (TSLA and MUU move far more than AMZN); measured on closes, so stray high/low prints cannot trigger it.',
  pct_trail: 'The simplest rule a person could follow by hand.',
};
// The disclosures of PREREGISTRATION.md section 7, restated for PREREGISTRATION-3.md
// (sections 1.5, 3, 4 and 10) and PREREGISTRATION-3a.md; list sizes, G6 and the
// budgets come from the server's universe, criteria and configs.
function disclosures(o) {
  const A = o.universe?.baskets?.A?.symbols || [];
  const g6 = (o.criteria?.criteria || []).find((c) => c.id === 'G6');
  const r = (o.configs || []).find((c) => !c.error && c.assumptions?.risk)?.assumptions;
  return [
    `This is ${o.prereg?.id || 'the active pre-registration'}: pre-registration 3 with amendments 3a and 3b. Basket A is ${A.length ? `${A.length} stocks (${A.join(', ')})` : 'not returned by the server'}: your stocks plus four that lagged (INTC, CSCO, PYPL, SNAP), all chosen with hindsight, so the list is not a random sample of anything and the fully invested hold is deliberately weaker than with your stocks alone.${g6 ? ` G6: ${g6.rule}.` : ''} The earlier candidates (C1–C3, X1–X3 0.2.0) were never run.`,
    `Experimental defaults stand in for your unanswered risk questions: decide after the close, hold through earnings, no news rules, US$0 commission in USD, an initial-loss level ${r?.initialLoss?.multiple ?? '—'} × the typical daily move below every buy, and positions sized from pooled cash with dollar budgets${r?.risk ? ` (planned loss ${usd(r.risk.plannedLossPerTradeUsd)} per trade, ${usd(r.risk.maxPositionUsd)} per position, ${usd(r.risk.totalOpenRiskUsd)} open risk)` : ''}. These untested round numbers shape the result as much as the exit rules do. After a missed rebound, three policies are tested as separate candidates: A stays in cash, B enters at the next recovery point at any price, C does the same after the cooling-off period.`,
    'Risk sizing keeps the candidates partly in cash by construction: that lowers their return in rising markets and their decline in falling ones. The criteria compare return per unit of decline against both benchmarks; the invested fraction and the return on average invested capital are shown as information only.',
    'MU was in the Strategy Lab consolidation-breakout universe: its 15-minute bars for 2021-07 to 2024-12 were run through that strategy (runs 1–12), and its 2025-01-01 to 2026-06-30 bars passed readiness checks only. HXR\'s final period overlaps that strategy\'s untouched holdout window for MU. HXR never reads the Strategy Lab database, never runs that strategy and never writes its holdout ledger. If you want strict separation, MU can be dropped from HXR before any HXR run.',
    'The step 1 checks printed a few daily closes (first and last bars of each stock, and some 2016–2026 closes for SPY, MU, NVDA, AAPL and VRT). No rule outcome was computed under any version.',
    'Hindsight cannot be removed: Claude\'s training data and your own memory cover these stocks\' history up to mid-2026, so no historical period is truly unseen: only the prospective account is clean evidence.',
  ];
}

// Page state that survives re-renders.
const S = { sel: null, ev: null, cand: null, run: null, runTab: 'decisions', runSymbol: '', runPage: 0, showAll: {} };
// A finished run never changes, so its full record is fetched once.
const runCache = new Map();

// Each render gets an epoch; pollers and late responses of an older render stop.
let epoch = 0;
const onPage = () => /^#\/?hxr(\?|$)/.test(location.hash);
const live = (ep) => ep === epoch && onPage();

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
const money = (v) => fmt.money(v);
const sMoney = (v) => fmt.signedMoney(v);
const pct = (v, dp = 2) => fmt.pct(v, dp);
const pctPlain = (v, dp = 2) => (fin(v) ? `${Number(v).toFixed(dp)}%` : '—');
const pts = (v) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} pts` : '—');
const ratio = (v, dp = 3) => (fin(v) ? Number(v).toFixed(dp) : '—');
const int = (v) => (fin(v) ? Number(v).toLocaleString('en-US') : '—');
const bps = (v, dp = 1) => (fin(v) ? `${Number(v).toFixed(dp)} bps` : '—');
const px = (v) => (fin(v) ? fmt.num(v, Math.abs(v) >= 1000 ? 2 : 4) : '—');
const qty = (v) => (fin(v) ? fmt.qty(v) : '—');
const day = (d) => (d ? fmt.date(String(d).slice(0, 10)) : '—');
const shortHash = (s) => (s ? String(s).slice(0, 12) : '—');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const diff = (a, b) => (fin(a) && fin(b) ? a - b : null);
// Long floats in the engine's reason text, shortened for reading.
const tidy = (s) => String(s ?? '').replace(/-?\d+\.\d{5,}/g, (m) => Number(m).toFixed(4));
const ET_FULL = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const valid = (t) => t && !Number.isNaN(new Date(t).getTime());
const when = (t) => (valid(t) ? `${ET_FULL.format(new Date(t))} ET` : t ? String(t) : '—');

function valueText(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(Math.abs(v) >= 100 ? 2 : 3);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${valueText(x)}`).join('; ');
  return String(v);
}

// A value object of numbers only (G1-G4); nested ones (G5, G6) are summarised by the note.
const flat = (v) => v && typeof v === 'object' && Object.values(v).every((x) => x == null || typeof x !== 'object');

function ratioText(r) {
  if (!fin(r)) return '—';
  return r >= 1 ? `${+Number(r).toFixed(4)}-for-1` : `1-for-${+(1 / r).toFixed(4)} (reverse)`;
}

// The rule in plain English, from the config's own numbers (ENGINE-SPEC.md section 5).
function ruleText(rule) {
  switch (rule?.type) {
    case 'hold': return { exit: 'never', back: 'never (initial allocation only)', needs: 'none' };
    case 'ma_band': return {
      exit: `the close is more than ${rule.bandPct}% below its ${rule.smaSessions}-session simple average`,
      back: `the close is more than ${rule.bandPct}% above its ${rule.smaSessions}-session simple average`,
      needs: `${rule.smaSessions} closes`,
    };
    case 'vol_trail': return {
      exit: `the close is more than ${rule.multiple} × the typical daily move below the highest close since the sleeve last bought`,
      back: `the close is more than ${rule.multiple} × the typical daily move above the lowest close since the sleeve last sold`,
      needs: `${rule.volSessions + 1} closes (typical daily move = mean absolute close-to-close change over the last ${rule.volSessions} sessions)`,
    };
    case 'pct_trail': return {
      exit: `the close is ${rule.exitDrawdownPct}% or more below the highest close since the sleeve last bought`,
      back: `the close is ${rule.reentryRisePct}% or more above the lowest close since the sleeve last sold`,
      needs: '1 close',
    };
    case 'recovery_break': return {
      exit: `the close is below the exit level: the close of the latest recovery point since buying (a close lower than the ${rule.pivotSessions} closes before and after it, which then rose by at least ${rule.reboundMultiple} × the typical daily move; known only ${rule.pivotSessions} sessions after it) less ${rule.bufferMultiple} × the typical daily move. The level only rises; there is no exit before the first recovery point`,
      back: buyBackText(rule),
      needs: `${Math.max(rule.volSessions + 1, 2 * rule.pivotSessions + 1)} closes (typical daily move = mean absolute close-to-close change over the last ${rule.volSessions} sessions)`,
    };
    case 'move_allowance': return {
      exit: `the close is more than ${rule.multiple} × the typical daily move below the highest close since the sleeve last bought`,
      back: buyBackText(rule),
      needs: `${Math.max(rule.volSessions + 1, 2 * rule.pivotSessions + 1)} closes (typical daily move = mean absolute close-to-close change over the last ${rule.volSessions} sessions)`,
    };
    case 'giveback': return {
      exit: `once the highest close since buying is at least ${rule.activationMultiple} × the typical daily move above the buy price, the close falls to or below the buy price plus ${100 - rule.givebackPct}% of the gain (gives back ${rule.givebackPct}%). No exit before that`,
      back: buyBackText(rule),
      needs: `${Math.max(rule.volSessions + 1, 2 * rule.pivotSessions + 1)} closes`,
    };
    default: return { exit: `unknown rule type ${rule?.type ?? '—'}`, back: '—', needs: '—' };
  }
}

// The one buy-back rule of hxr-prereg-2 (PREREGISTRATION-2.md section 3.5).
function buyBackText(rule) {
  const policy = rule.afterMissedRebound === 'fresh_entry_recovery_point' ? 'the stock is treated as never held: it may re-enter at the next recovery point at any price, sized by the risk budget'
    : rule.afterMissedRebound === 'fresh_entry_after_sessions' ? `the stock may re-enter at the next recovery point at any price, but only after ${rule.freshEntryMinSessions} of its sessions out`
      : rule.afterMissedRebound === 'pending_owner_choice' ? 'what happens next is pending your choice' : 'the stock stays in cash for the rest of the period';
  return `a recovery point (${rule.pivotSessions} closes either side, rebound ${rule.reboundMultiple} × the typical daily move) forms after the exit while the close is below the exit price; it fills at the next open only if the fill is below the exit price. If the price closes at or above the exit price first, the rebound is missed and ${policy}${rule.entryWhenNeverHeld ? '. A stock never held, or whose buy lapsed for budget reasons, enters at the next recovery point at any price' : ''}`;
}

// The initial-loss rule and sizing of hxr-prereg-3 (from the config's own numbers).
function riskText(a) {
  if (!a?.risk || !a?.initialLoss) return null;
  const r = a.risk, il = a.initialLoss;
  return `Every holding has an initial-loss level ${il.multiple} × the typical daily move below its buy price; the exit level is the higher of that and the rule's own level. Positions are sized from pooled cash: planned loss ${usd(r.plannedLossPerTradeUsd)} per trade, at most ${usd(r.maxPositionUsd)} per position, ${usd(r.totalOpenRiskUsd)} of open risk in total and ${usd(r.maxTechAiExposureUsd)} in tech/AI stocks; new entries pause after a ${usd(r.pauseDeclineUsd)} decline from the account's peak and resume at ${usd(r.resumeDeclineUsd)}. Sale proceeds return to the pool and are never reinvested in full automatically. Experimental defaults, not your approved limits.`;
}

// ---------- building blocks ----------

function sec(id, title, ...children) {
  return h('section', { class: 'card lab-sec hxr-sec', id: `hxr-${id}` }, h('h3', { class: 'card-title' }, title), ...children);
}

function spinnerLine(text) {
  return h('div', { class: 'lab-loading muted small' }, h('span', { class: 'spinner' }), text);
}

// A block that loads its own data; a failure stays inside the block.
function lazy(ep, load) {
  const host = h('div', { class: 'lab-lazy' }, spinnerLine('Loading…'));
  const run = () => {
    mount(host, spinnerLine('Loading…'));
    Promise.resolve().then(load).then(
      (node) => { if (ep === epoch) mount(host, node); },
      (e) => { if (ep === epoch) mount(host, errorState(e, run)); },
    );
  };
  run();
  return host;
}

function tile(label, value, sub) {
  return h('div', { class: 'lab-tile' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'lab-tile-value num' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

function table(head, rows, { cls = '', numeric = [] } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: `lab-table hxr-table ${cls}` },
    h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: numeric.includes(i) ? 'num' : '' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: numeric.includes(i) ? 'num' : '' }, c)))))));
}

function selectEl(label, options, value, onChange) {
  const el = select(label, options, value);
  el.setAttribute('aria-label', label);
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function legend(items) {
  return h('div', { class: 'lab-legend small' }, items.map(([cls, text]) => h('span', { class: 'lab-leg' }, h('span', { class: `sw ${cls}` }), text)));
}

function ack(text) {
  const box = h('input', { type: 'checkbox' });
  return { box, el: h('label', { class: 'check hxr-ack' }, box, h('span', {}, text)) };
}

// A confirmation drawer; the action runs only from its button.
function confirmDialog(title, body, { confirmLabel, onConfirm, ready = () => true, runningText = null, danger = false }) {
  const err = h('div', { role: 'alert' });
  const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button' }, confirmLabel);
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  let open = true;
  const d = drawer(title, h('div', { class: 'stack lab-dialog' }, body, err, h('div', { class: 'row' }, ok, cancel)), { wide: true, onClose: () => { open = false; } });
  cancel.addEventListener('click', () => d.close());
  ok.addEventListener('click', async () => {
    const problem = ready();
    if (problem !== true) { mount(err, notice('warn', problem)); return; }
    ok.disabled = true;
    cancel.disabled = true;
    mount(err, runningText ? notice('info', h('span', { class: 'spinner lab-inline-spin' }), ` ${runningText}`) : null);
    try {
      await onConfirm();
      if (open) d.close();
    } catch (e) {
      mount(err, notice('danger', e.message));
      ok.disabled = false;
      cancel.disabled = false;
    }
  });
  return d;
}

function scrollToSection(id) {
  document.getElementById(`hxr-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function jumpBtn(id, label) {
  return h('button', { class: 'linklike lab-link', type: 'button', onclick: () => scrollToSection(id) }, label);
}

async function getRun(P, id) {
  if (runCache.has(id)) return runCache.get(id);
  const r = await P.api('GET', `/api/hxr/runs/${id}`);
  if (r.run?.status !== 'running') runCache.set(id, r);
  return r;
}

const basketList = (o, name) => [...(o.universe?.baskets?.[name]?.symbols || []), ...(o.universe?.baskets?.[name]?.addWhenConfirmed || []).map((s) => `${s} (once confirmed)`)];
const startingCash = (o) => (o.configs || []).find((c) => !c.error && c.rule?.type === 'hold')?.assumptions?.account?.startingCash;
const usd = (v) => (fin(v) ? `US$${Number(v).toLocaleString('en-US')}` : 'the pre-registered');

// ---------- page ----------

export async function renderHxr(view, ctx) {
  const ep = ++epoch;
  if (ctx.app.workspace === 'demo') {
    mount(view, h('div', { class: 'stack hxr' }, banner(),
      notice('info', h('strong', {}, 'Not available in the demo workspace. '), 'HXR runs on real market data in your own workspace only; the demo workspace holds synthetic data, and HXR is never synthetic. Use "Switch to my portfolio" at the top of the page.')));
    return;
  }
  const o = await ctx.api('GET', '/api/hxr/overview');
  if (!live(ep)) return;
  const reload = () => renderHxr(view, ctx).catch((e) => { if (onPage()) mount(view, errorState(e, reload)); });
  const P = derive(ctx, o, ep, reload);
  // The judged evaluation run carries the outcome shown in the status strip.
  if (P.evalEntry) {
    try { P.evalRuns = await evaluationRuns(P, P.evalEntry); } catch (e) { P.evalError = e; }
    if (!live(ep)) return;
  }
  const results = P.selEntries.length > 0 || P.evalEntries.length > 0;
  const nav = [['prereg', 'Pre-registration'], ['data', 'Data'], ['actions', 'Actions'], ...(results ? [['results', 'Results'], ['run', 'Trades & decisions']] : []), ['prospective', 'Prospective account'], ['log', 'Experiment log']];
  mount(view, h('div', { class: 'stack lab hxr' },
    banner(), statusSection(P), jumpNav(nav),
    preregSection(P), dataSection(P), actionsSection(P),
    results ? resultsSection(P) : null, results ? runSection(P) : null,
    prospectiveSection(P), logSection(P)));
  if (o.busy) {
    // A run started elsewhere: refresh once it has finished.
    poll(ep, 3000, async () => {
      const n = await ctx.api('GET', '/api/hxr/overview');
      if (n.busy) return true;
      reload();
      return false;
    });
  }
}

function derive(ctx, o, ep, reload) {
  const prereg = o.prereg?.id ?? null;
  const ledger = (o.ledger || []).filter((e) => e.prereg === prereg);
  const selEntries = ledger.filter((e) => e.kind === 'selection');
  const frozen = (o.versions || []).find((v) => v.prereg === prereg) || null;
  const evalEntries = ledger.filter((e) => e.kind === 'evaluation');
  const valEntries = ledger.filter((e) => e.kind === 'validation');
  const cleanEval = evalEntries.find((e) => !e.contaminated && frozen && e.version === frozen.version && e.configHash === frozen.configHash) || null;
  const cleanVal = valEntries.find((e) => !e.contaminated && frozen && e.version === frozen.version && e.configHash === frozen.configHash) || null;
  return {
    api: ctx.api, app: ctx.app, o, ep, reload, prereg, ledger, frozen, selEntries, evalEntries, cleanEval, valEntries, cleanVal,
    validation: o.validation || null, pickRule: o.pickRule || null,
    cleanSel: selEntries.find((e) => !e.contaminated) || null, evalEntry: cleanEval || evalEntries[0] || null, evalRuns: null, evalError: null,
  };
}

function banner() {
  return h('div', { class: 'hxr-banner', role: 'note' },
    h('strong', {}, 'Simulated account.'), ' Not your real holdings or cash. No order is sent to any broker or paper-trading platform. No notifications.');
}

function jumpNav(items) {
  return h('nav', { class: 'lab-jump', 'aria-label': 'HXR sections' },
    items.map(([id, label]) => h('button', { class: 'chip-btn', type: 'button', onclick: () => scrollToSection(id) }, label)));
}

// ---------- 2. status strip ----------

// The file the frozen version is recorded as (the server names it).
const frozenFile = (f) => f?.file || 'its config file in strategy/hxr/configs';

// Whether the frozen version is also recorded as a config file in strategy/hxr/configs.
function recordedInRepo(P) {
  return !!P.frozen && (P.o.configs || []).some((c) => !c.error && c.version === P.frozen.version && c.hash === P.frozen.configHash);
}

function periodReady(o, keys) {
  return keys.every((k) => o.readiness?.periods?.[k]?.usable && o.readiness.periods[k].costsCalibrated);
}

function evaluationOutcome(P) {
  return P.evalRuns?.hxr?.run?.details?.evaluation || null;
}

function statusSection(P) {
  const { o } = P;
  const per = o.readiness?.periods || {};
  const ev = evaluationOutcome(P);
  const sel = P.selEntries;
  const step = (state, label, detail) => h('div', { class: `setup-item hxr-step ${state}` },
    h('span', { class: 'tick', 'aria-hidden': 'true' }, state === 'done' ? '✓' : state === 'stop' ? '✕' : ''),
    h('div', { class: 'hxr-step-text' }, h('div', {}, label), detail ? h('div', { class: 'cell-sub' }, detail) : null));
  const readyText = ['development', 'validation', 'final', 'fullList'].map((k) => `${PERIOD_LABEL[k].toLowerCase()} ${per[k]?.usable ? (per[k].costsCalibrated ? 'ready' : 'no cost calibration') : 'not ready'}`).join(' · ');
  const val = P.validation;
  const [vl, vk] = VOUT[val?.outcome] || [val?.outcome, 'muted'];
  const [ol, ok] = OUTCOME[ev?.outcome] || [ev?.outcome, 'muted'];
  const p = o.prospective;
  const steps = [
    step('done', `Pre-registration ${P.prereg || '—'}`, `${plural(o.prereg?.files?.length ?? 0, 'file')} fixed before any result · hash ${shortHash(o.prereg?.hash)}`),
    step(o.settings?.alpacaKeys ? 'done' : '', 'Market-data keys', o.settings?.alpacaKeys ? 'Alpaca keys set in .env (read-only market data)' : 'not set in .env'),
    step(periodReady(o, ['development', 'validation', 'final', 'fullList']) ? 'done' : '', 'Data ready', o.fetch?.running ? 'download running…' : readyText),
    step(P.pickRule && P.pickRule !== 'pending_owner_choice' ? 'done' : '', 'Pick rule (amendment 3b)', P.pickRule === 'pending_owner_choice' ? 'pending your choice: most profit, or best return per unit of fall' : P.pickRule ? `${P.pickRule.replace(/_/g, ' ')}` : '—'),
    step(P.cleanSel ? 'done' : '', 'Development pick (once)', P.cleanSel ? `run ${when(P.cleanSel.at)}${sel.length > 1 ? ` · ${plural(sel.length - 1, 'contaminated repeat')}` : ''}` : 'not run'),
    step(P.frozen ? 'done' : P.cleanSel ? 'stop' : '', 'Frozen version', P.frozen ? `${P.frozen.version} from ${P.frozen.basedOn} · ${when(P.frozen.frozenAt)}` : P.cleanSel ? 'none: no candidate worth validating (HXR stops)' : 'after the development pick'),
    step(val?.outcome === 'validated' ? 'done' : val ? 'stop' : '', 'Validation run (once)', val ? h('span', {}, badge(vl, vk), ` ${when(val.at)}`) : P.cleanVal ? 'outcome not recorded' : 'not run'),
    step(P.cleanEval ? 'done' : '', 'Final run (once)', P.evalEntry
      ? h('span', {}, ev ? badge(ol, ok) : P.evalError ? 'outcome could not be loaded' : 'outcome not recorded', ` ${when(P.evalEntry.at)}${P.evalEntries.length > 1 ? ` · ${plural(P.evalEntries.length - (P.cleanEval ? 1 : 0), 'contaminated repeat')}` : ''}`,
        ev && o.historicalCaveat ? h('div', { class: 'hxr-caveat' }, o.historicalCaveat) : null)
      : 'not run'),
    step(p ? 'done' : '', 'Prospective account', p ? `${p.status} · started ${day(p.startDate)} · processed through ${day(p.lastProcessed)}` : 'not started'),
  ];
  const [text, target] = nextAction(P);
  return h('section', { class: 'card lab-strip hxr-status', id: 'hxr-status' },
    h('div', { class: 'spread' },
      h('div', { class: 'lab-version' }, h('span', { class: 'lab-vname' }, 'HXR · hold, exit, re-enter'), badge(P.prereg || 'no pre-registration', 'info'), badge('SIMULATED', 'warn')),
      h('span', { class: 'small muted' }, o.notice || 'Simulated only.')),
    h('div', { class: 'setup hxr-steps' }, steps),
    h('div', { class: 'hxr-next', role: 'status' }, h('strong', {}, 'Next owner action: '), text, target ? [' ', jumpBtn(target, 'Go there')] : null));
}

function nextAction(P) {
  const { o } = P;
  const per = o.readiness?.periods || {};
  if (o.busy) return [`Wait: a ${o.busy.kind} run is in progress (started ${when(o.busy.startedAt)}). This page refreshes when it has finished.`, null];
  if (o.fetch?.running) return ['Wait for the data download to finish, then check the readiness table.', 'data'];
  if (!P.cleanSel) {
    const anyBars = (o.data || []).some((d) => d.bars?.count > 0);
    if (!o.settings?.alpacaKeys && !anyBars) return ['Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (a free Alpaca market-data account) to .env, restart Signal Desk, then download the data.', 'data'];
    if (!periodReady(o, ['development'])) return ['Download or refresh the data, then check the readiness table: the development period is not ready.', 'data'];
    const mu = o.decisions?.mu?.choice;
    if (mu === 'drop') return ['You chose to drop MU from the evaluation: the pre-registration has to be restated as a new version before any run (or record "keep MU" instead).', 'prereg'];
    if (mu !== 'keep') return ['Decide whether MU stays in the final period (pre-registration disclosure 1). The choice is possible only before any HXR run; then run the development pick (once).', 'prereg'];
    if (P.pickRule === 'pending_owner_choice') return ['Choose the development pick rule (amendment 3b): most profit, or best return per unit of fall. Record it in criteria-hxr-v3a.json and EXPERIMENT-LOG.md before any run.', 'prereg'];
    return ['Read the pre-registration, then run the development pick (once).', 'prereg'];
  }
  if (!P.frozen) return ['None: the development pick found no candidate worth validating, so HXR stops here and the validation and final periods stay unused. Any change to the rules would be a new pre-registered version.', 'results'];
  if (!P.validation) {
    if (!recordedInRepo(P)) return [`Record ${P.frozen.version} as ${frozenFile(P.frozen)} (the frozen JSON under Actions, unchanged) and add an EXPERIMENT-LOG.md entry, then run the validation (once).`, 'actions'];
    if (!periodReady(o, ['validation'])) return ['Refresh the data: the validation period is not ready yet.', 'data'];
    return ['Run the validation (once).', 'actions'];
  }
  if (P.validation.outcome !== 'validated') return [`None: ${P.frozen.version} did not pass the validation gate (${P.validation.outcome.replace(/_/g, ' ')}), so HXR stops here and the final period is never used for this or any other candidate.`, 'results'];
  if (!P.cleanEval) {
    if (!periodReady(o, ['final'])) return ['Refresh the data: the final period is not ready yet.', 'data'];
    return ['Run the final run (once).', 'actions'];
  }
  if (!o.prospective) return ['Review the final result. The prospective account is the only clean evidence; start it if you want that forward record.', 'actions'];
  if (o.prospective.status === 'paused') return ['Resume the prospective account: it is paused, and sessions processed late count against P2.', 'prospective'];
  return ['Nothing required. After each close, "Process now" or the scheduler records the session. The prospective criteria P1–P4 are judged later, separately.', 'prospective'];
}

// ---------- 3. pre-registration ----------

function preregSection(P) {
  const { o } = P;
  const configs = o.configs || [];
  const statuses = [...new Set(configs.filter((c) => !c.error && c.status).map((c) => c.status))];
  const prFile = (o.prereg?.files || []).find((f) => f.file === 'PREREGISTRATION.md');
  return sec('prereg', `Pre-registration ${P.prereg || ''} (fixed before any result)`,
    h('p', { class: 'small' }, 'These rules, periods and criteria were written down before any HXR backtest or result existed, and are shown here before any result. ',
      'Historical results test the price rules only; they are never evidence for a news-informed HXR. Every number marked experimental is a labelled research assumption, not your approved preference.'),
    statuses.map((s) => notice('warn', h('strong', {}, 'Config status: '), s)),
    h('h4', { class: 'lab-h4' }, 'The six candidates, your comparison and the two benchmarks'),
    h('p', { class: 'small' }, `Exit rules X1 and X2 are each combined with the three fresh-entry policies after a missed rebound (A stay in cash, B a fresh entry at the next recovery point at any price, C the same after a cooling-off period counted from the sale): six candidates. X3, your 10% give-back, is run with the same policies as a comparison and can never be picked. Benchmarks: ${BENCH.hold.toLowerCase()} (equal money in every stock, never sold) and ${BENCH.holdDayOne.toLowerCase()} (the exact positions the candidates open on day one, never sold); every pass/fail test must beat both.`),
    riskText((o.configs || []).find((c) => !c.error && c.assumptions?.risk)?.assumptions) ? h('p', { class: 'small' }, h('strong', {}, 'Sizing and the initial-loss rule. '), riskText((o.configs || []).find((c) => !c.error && c.assumptions?.risk)?.assumptions)) : null,
    armsTable(P),
    assumptionsBlock(o),
    h('h4', { class: 'lab-h4' }, 'Periods'),
    periodsTable(o),
    excludedList(o.periods?.excludedSessions),
    h('h4', { class: 'lab-h4' }, 'Disclosure of previously examined data'),
    h('ol', { class: 'bullets small hxr-disclose' }, disclosures(o).map((d) => h('li', {}, d))),
    muBlock(P),
    o.universe?.selectedBy ? h('p', { class: 'small muted' }, `Stock list chosen by ${o.universe.selectedBy} on ${day(o.universe.selectedAt)}${o.universe.selectedBefore ? `, before ${o.universe.selectedBefore}` : '.'}`) : null,
    h('p', { class: 'small muted' }, `Restated from PREREGISTRATION.md section 7${prFile ? ` (sha256 ${shortHash(prFile.sha256)})` : ''}, PREREGISTRATION-3.md sections 1.5, 3, 4 and 10, and PREREGISTRATION-3a.md.`),
    h('h4', { class: 'lab-h4' }, 'Choosing one candidate (development period only)'),
    selectionRule(o),
    h('h4', { class: 'lab-h4' }, 'Pass/fail criteria (final period, against both benchmarks)'),
    criteriaRules(o),
    h('h4', { class: 'lab-h4' }, 'Prospective criteria (judged later, separately)'),
    table(['', 'Criterion', 'Rule'], (o.criteria?.prospective || []).map((c) => [h('span', { class: 'mono' }, c.id), h('strong', {}, c.name), h('span', { class: 'small' }, c.rule)]), { cls: 'hxr-rules' }),
    filesBlock(o));
}

// The pending MU decision (disclosure 1): recorded before any run, then fixed.
function muBlock(P) {
  const d = P.o.decisions?.mu;
  const locked = (P.ledger || []).length > 0;
  const btn = (choice, label, cls) => actionButton(label, null, () => muDialog(P, choice), cls);
  return h('div', { class: 'lab-panel mt' },
    h('h4', { class: 'lab-h4 first' }, 'Your decision: MU in the evaluation'),
    h('div', { class: 'row small' }, d ? badge(d.choice === 'keep' ? 'keep MU' : 'drop MU', d.choice === 'keep' ? 'ok' : 'warn') : badge('pending', 'warn'),
      h('span', { class: 'muted' }, d ? `recorded ${when(d.at)}` : 'not recorded yet; the development pick waits for it')),
    h('p', { class: 'small' }, 'Disclosure 4: MU can be dropped from HXR for strict separation from the Strategy Lab holdout window (which the final period overlaps), but only before any HXR run. Keeping it leaves the overlap disclosed.'),
    h('p', { class: 'small muted' }, `Dropping MU changes basket A, the benchmarks and G6, which this pre-registration states for ${(P.o.universe?.baskets?.A?.symbols || []).length || 'its'} stocks${(P.o.criteria?.criteria || []).find((c) => c.id === 'G6') ? ` (G6: ${(P.o.criteria.criteria.find((c) => c.id === 'G6')).rule})` : ''}, so it needs a restated pre-registration (a new version); nothing runs until then.`),
    locked ? h('div', { class: 'small hxr-gate' }, `Fixed as ${d?.choice ? `"${d.choice}"` : 'not recorded'}: an HXR run is already recorded.`)
      : h('div', { class: 'row' }, btn('keep', 'Keep MU…', d?.choice === 'keep' ? '' : 'primary'), btn('drop', 'Drop MU…', 'danger')));
}

function muDialog(P, choice) {
  const keep = choice === 'keep';
  const a = ack(keep ? 'Keep MU in basket A for the evaluation; the overlap with the Strategy Lab holdout window stays disclosed.' : 'Drop MU: I understand nothing runs until the pre-registration is restated as a new version.');
  confirmDialog(keep ? 'Keep MU in the evaluation?' : 'Drop MU from the evaluation?', h('div', { class: 'stack', style: { gap: '10px' } },
    notice('warn', 'This choice is possible only before any HXR run. It is recorded with its time in the experiment log; earlier choices are kept.'),
    h('div', { class: 'small' }, disclosures(P.o)[3]),
    a.el), {
    confirmLabel: keep ? 'Keep MU' : 'Drop MU', danger: !keep,
    ready: () => (a.box.checked ? true : 'Tick the box to confirm.'),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/mu-decision', { choice, confirm: true });
      toast(r.note || 'Recorded.');
      P.reload();
    },
  });
}

function armsTable(P) {
  // Only the arms of the active pre-registration; superseded C1-C3 are never run.
  const active = (P.o.configs || []).filter((c) => c.role !== 'superseded');
  return table(['Arm', 'Exit to cash when…', 'Buy back when…', 'History needed', 'Why this rule', 'Config'], active.map((c) => {
    if (c.error) return [h('span', { class: 'mono small' }, c.file), h('span', { class: 'small neg' }, `Invalid config: ${c.error}`), '', '', '', ''];
    const t = ruleText(c.rule);
    const isFrozen = P.frozen && c.version === P.frozen.version;
    return [
      h('div', {}, h('strong', {}, c.label || c.version), h('div', { class: 'cell-sub' }, c.version),
        isFrozen ? badge('frozen', 'info') : c.rule?.type === 'hold' ? badge('comparison arm', 'muted') : c.role === 'comparison' ? badge('your comparison: never picked', 'muted') : badge('experimental', 'warn')),
      h('span', { class: 'small' }, t.exit), h('span', { class: 'small' }, t.back), h('span', { class: 'small' }, t.needs),
      h('span', { class: 'small muted' }, WHY[c.rule?.type] || ''),
      h('span', { class: 'mono small', title: `${c.file} · sha256 ${c.hash}` }, shortHash(c.hash)),
    ];
  }), { cls: 'hxr-arms' });
}

function assumptionsBlock(o) {
  const valid = (o.configs || []).filter((c) => !c.error && c.assumptions);
  const base = valid.find((c) => c.rule?.type === 'hold') || valid[0];
  if (!base) return null;
  const pooledArms = valid.filter((c) => c.role !== 'superseded' && c.assumptions?.account?.allocation === 'risk_sized');
  // Compared without the account and sizing sections, which differ by design between the hold and the candidates.
  const common = (x) => JSON.stringify({ ...x, account: { ...x.account, allocation: null }, risk: null, initialLoss: null });
  const same = valid.every((c) => common(c.assumptions) === common(base.assumptions));
  const { account: a = {}, execution: x = {}, costs: c = {}, dividends: d = {}, cash = {} } = base.assumptions;
  const hs = c.halfSpread === 'calibrated'
    ? `calibrated per stock and calendar year: the median quoted half-spread (SIP) in the first minute after the open on six sampled days a year, floored at ${c.halfSpreadFloorBps} bps; the floor applies before a stock's first sampled day. A fill uses only that year's samples dated on or before it (the previous year's value until the year's first sample), so no later quote reaches an earlier fill`
    : `${c.halfSpread} bps (floor ${c.halfSpreadFloorBps} bps)`;
  return h('div', { class: 'lab-panel mt' },
    h('h4', { class: 'lab-h4 first' }, `Account, execution and cost assumptions (experimental${same ? ', the same for every arm' : '; they differ between arms, shown for the hold'})`),
    h('dl', { class: 'kv small lab-kv' },
      h('dt', {}, 'Account'), h('dd', {}, `${usd(a.startingCash)} simulated, ${a.currency || 'USD'}; ${pooledArms.length ? `the candidates and comparisons (${pooledArms.map((c) => c.version).join(', ')}) use one pool of risk-sized cash (below); the fully invested hold uses equal sleeves (each stock gets 1/N of the cash and its own sleeve; no rotation, no rebalancing)` : 'equal sleeves (each stock gets 1/N of the cash and its own sleeve; no rotation, no rebalancing)'}; ${a.wholeShares ? 'whole shares only' : 'fractional shares'}; ${a.allowMargin ? 'margin allowed' : 'no borrowing'}; ${a.allowShort ? 'short selling allowed' : 'no short selling'}; cash never below zero`),
      ...(pooledArms.length && riskText(pooledArms[0].assumptions) ? [h('dt', {}, 'Sizing (candidates)'), h('dd', {}, riskText(pooledArms[0].assumptions))] : []),
      h('dt', {}, 'Decisions'), h('dd', {}, `after the close (${x.decision}), from completed daily bars only; signals use split-adjusted closes up to and including the decision session`),
      h('dt', {}, 'Fills'), h('dd', {}, `at the open ${x.delaySessions === 1 ? 'of the next session' : `${x.delaySessions} sessions later`} (${x.fill}), fill model "${x.fillModel}": the open plus (buy) or minus (sell) half-spread + slippage; a gap is taken at the gapped open; no intraday stop`),
      h('dt', {}, 'Realistic fill (reported)'), h('dd', {}, 'the first 15-minute VWAP (09:30–09:45 ET) plus or minus the half-spread; never used for the main result'),
      h('dt', {}, 'Half-spread'), h('dd', {}, hs),
      h('dt', {}, 'Slippage'), h('dd', {}, `${c.slippageBps} bps on every fill`),
      h('dt', {}, 'Commission'), h('dd', {}, `US$${c.commissionPerOrder} per order + US$${c.commissionPerShare} per share`),
      h('dt', {}, 'Sell fees'), h('dd', {}, `SEC ${c.secFeeRate} × sale value; FINRA TAF US$${c.tafPerShare} per share, at most US$${c.tafMaxPerTrade} per trade`),
      h('dt', {}, 'Dividends'), h('dd', {}, `${d.credit === false ? 'not credited' : `credited on the ${String(d.creditOn || 'pay_date').replace('_', ' ')} for shares held at the start of the ex-date session`}; ${d.withholdingPct}% withheld (a 0% variant is reported)`),
      h('dt', {}, 'Cash interest'), h('dd', {}, `${cash.annualInterestPct}% a year`),
      h('dt', {}, 'End of a run'), h('dd', {}, 'holdings marked to market at the last close; no liquidation cost for either arm')));
}

function periodsTable(o) {
  const per = o.periods || {};
  return table(['Period', 'Basket', 'Warm-up from', 'Dates', 'Purpose'], PERIODS.filter(([k]) => per[k]).map(([k, label]) => {
    const p = per[k];
    return [
      h('strong', {}, label),
      h('div', {}, h('span', {}, p.basket), h('div', { class: 'cell-sub' }, basketList(o, p.basket).join(', '))),
      p.warmupFrom ? day(p.warmupFrom) : '—',
      h('span', { class: 'small' }, p.end ? `${day(p.start)} – ${day(p.end)}` : p.start),
      h('span', { class: 'small' }, p.use || ''),
    ];
  }), { cls: 'hxr-periods' });
}

function excludedList(list) {
  if (!list?.length) return null;
  return h('div', { class: 'small mt' }, h('strong', {}, 'Excluded sessions (skipped for every stock): '),
    h('ul', { class: 'bullets' }, list.map((x) => h('li', {}, `${day(x.date)}: ${x.reason}`))));
}

function pickText(s) {
  if (s?.pickRule === 'ending_value') return 'Pick rule (a), most profit: the qualifying candidate with the highest ending account value after costs wins, if its ending value beats both benchmarks\' (the fully invested hold and the day-one hold); its largest decline is reported next to it.';
  if (s?.pickRule === 'return_to_drawdown') return `Pick rule (b), best return per unit of fall: the qualifying candidate with the highest annualised return ÷ largest decline wins, if it reaches at least ${s.pickRules?.return_to_drawdown?.mustReachTimesBenchmarks ?? 1.1} × both benchmarks on that measure; its ending value is reported next to it.`;
  return 'The pick rule is pending your choice: nothing runs until it is recorded.';
}

function selectionRule(o) {
  const s = o.criteria?.selection;
  if (!s) return h('div', { class: 'small muted' }, 'Not returned by the server.');
  return h('ol', { class: 'bullets small' },
    h('li', {}, 'Run the six candidates, the three X3 comparisons and both benchmarks on basket A over the development period, at base costs (each also with first 15-minute VWAP fills, reported). Only the six candidates can be picked.'),
    h('li', {}, `A candidate qualifies if it completes at least ${s.minRoundTrips} exit-and-buy-back round trips (fresh entries do not count).`),
    h('li', {}, s.pickRule === 'ending_value' ? 'Pick rule (a), most profit: the qualifying candidate with the highest ending account value after costs wins, if it beats both benchmarks on ending value; its largest decline is reported next to it.'
      : s.pickRule === 'return_to_drawdown' ? `Pick rule (b), best return per unit of fall: the qualifying candidate with the highest annualised return ÷ largest decline wins, if it reaches at least ${s.pickRules?.return_to_drawdown?.mustReachTimesBenchmarks ?? 1.1} × both benchmarks on that measure; its ending value is reported next to it.`
        : h('span', {}, h('strong', {}, 'Pick rule: pending your choice (amendment 3b). '), 'Either (a) most profit: highest ending value after costs, beating both benchmarks; or (b) best return per unit of fall: highest annualised return ÷ largest decline, at least 1.10 × both benchmarks. Nothing runs until it is recorded.')),
    h('li', {}, 'A tie goes to the smaller largest decline. If no candidate qualifies and beats both benchmarks, stop: HXR has no candidate worth validating, and the validation and final periods are never used.'),
    h('li', {}, 'The pick is frozen as a new version (with its config hash) and logged. Only that one winner goes to validation, then to final; if it fails validation HXR stops, and no runner-up is ever tried. Neighbouring settings of the winner are reported only. Development results are in-sample.'));
}

function criteriaRules(o) {
  const c = o.criteria || {};
  const v = c.validation;
  if (v) {
    return h('div', {},
      h('div', { class: 'small' }, h('strong', {}, 'Validation gate (one run, both benchmarks): '), `V1 ${v.V1?.rule || ''}. V2 ${v.V2?.rule || ''}.`),
      criteriaRulesList(c));
  }
  return criteriaRulesList(c);
}

function criteriaRulesList(c) {
  const outcomes = c.outcomes || {};
  return h('div', { class: 'stack', style: { gap: '8px' } },
    table(['', 'Criterion', 'Rule'], (c.criteria || []).map((x) => [h('span', { class: 'mono' }, x.id), h('strong', {}, x.name), h('span', { class: 'small' }, x.rule)]), { cls: 'hxr-rules' }),
    h('dl', { class: 'kv small lab-kv' }, Object.entries(outcomes).map(([k, v]) => [h('dt', {}, badge((OUTCOME[k] || [k])[0], (OUTCOME[k] || [k, ''])[1])), h('dd', {}, v)])),
    notice('info', h('strong', {}, 'PASS means: '), c.passMeaning || '—', '. A positive account balance is not a pass; a gain smaller than the hold\'s, or a gain bought with a similar decline, fails.'));
}

function filesBlock(o) {
  const files = o.prereg?.files || [];
  const later = o.prereg?.later || [];
  if (!files.length) return null;
  return h('details', { class: 'more mt' }, h('summary', {}, `Pre-registered files and their hashes (${files.length}; combined ${shortHash(o.prereg.hash)})`),
    table(['File', 'sha256'], files.map((f) => [h('span', { class: 'mono small' }, f.file), h('span', { class: 'mono small hxr-hash' }, f.sha256)])),
    later.length ? h('div', { class: 'mt' }, h('div', { class: 'small' }, h('strong', {}, 'Recorded after the pre-registration (not part of it or its hash): ')),
      table(['File', 'Version', 'Frozen', 'sha256'], later.map((f) => [h('span', { class: 'mono small' }, f.file), f.error ? h('span', { class: 'small neg' }, f.error) : (f.version || '—'),
        f.frozenAt ? when(f.frozenAt) : h('span', { class: 'small muted' }, 'not a stored frozen version'), h('span', { class: 'mono small hxr-hash' }, f.sha256)]))) : null);
}

// ---------- 4. data readiness ----------

function dataSection(P) {
  const { o } = P;
  return sec('data', 'Data readiness (market data for the simulation)',
    o.settings?.alpacaKeys ? null : notice('warn', h('strong', {}, 'No Alpaca market-data keys. '), 'Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env (a free Alpaca market-data account; no trading or paper-trading API is used) and restart Signal Desk. The keys stay in .env and are never shown here.'),
    fetchBlock(P),
    lazy(P.ep, async () => readinessView(P, await P.api('GET', '/api/hxr/readiness'))),
    h('div', { class: 'grid two mt' }, spcxBlock(P), calibrationBlock(o)));
}

function fetchBlock(P) {
  const { o, ep } = P;
  const out = h('div', { 'aria-live': 'polite' });
  const err = h('div', { role: 'alert' });
  const block = !o.settings?.alpacaKeys ? 'Needs the Alpaca market-data keys in .env.'
    : o.fetch?.running ? 'A download is running.'
      : o.busy ? `A ${o.busy.kind} run is in progress; download when it has finished.` : null;
  const btn = h('button', { class: 'btn primary small', type: 'button', disabled: block ? true : null, title: block }, 'Download / refresh data');
  let polling = false;
  const show = (job) => mount(out, job ? fetchJobView(job) : h('div', { class: 'small muted' }, 'No download has been run yet.'));
  const follow = () => {
    if (polling) return;
    polling = true;
    poll(ep, 3000, async () => {
      const r = await P.api('GET', '/api/hxr/fetch');
      show(r.job);
      if (r.running) return true;
      polling = false;
      toast(`HXR data download ${String(r.job?.status || 'finished').replace(/_/g, ' ')}`);
      P.reload();
      return false;
    });
  };
  btn.addEventListener('click', async () => {
    mount(err);
    btn.disabled = true;
    try {
      const r = await P.api('POST', '/api/hxr/fetch', {});
      show(r.job);
      if (r.note) mount(err, h('div', { class: 'small muted' }, r.note));
      follow();
    } catch (e) {
      mount(err, notice('danger', `Download not started: ${e.message}`));
      btn.disabled = false;
    }
  });
  show(o.fetch?.job);
  if (o.fetch?.running) follow();
  return h('div', { class: 'lab-panel' },
    h('div', { class: 'spread' }, h('h4', { class: 'lab-h4 first' }, 'Download / refresh'), btn),
    h('div', { class: 'small muted' }, 'Read-only Alpaca market data (SIP, unadjusted): daily bars, the first 15-minute bar of each session, corporate actions and opening quotes for the spread calibration, from each listing date to the last completed session. Progress is saved and resumes after a restart. Nothing is filled in or shortened automatically, and no rule is run.'),
    block && !o.fetch?.running ? h('div', { class: 'small hxr-gate' }, block) : null,
    err, out);
}

function fetchJobView(job) {
  const syms = Object.entries(job.symbols || {});
  const active = syms.filter(([, s]) => s.status !== 'skipped');
  const done = active.filter(([, s]) => ['done', 'error'].includes(s.status)).length;
  const f = active.length ? done / active.length : 0;
  return h('div', { class: 'stack mt', style: { gap: '8px' } },
    h('div', { class: 'row small' }, badge(String(job.status).replace(/_/g, ' '), JOB[job.status] || ''),
      `${done} of ${active.length} stocks done · through ${day(job.through)} · started ${when(job.startedAt)} · updated ${fmt.ago(job.updatedAt)}`),
    job.status === 'running' ? h('div', { class: 'lab-meter', role: 'img', 'aria-label': `${Math.round(f * 100)}% done` }, h('span', { style: { width: `${f * 100}%` } })) : null,
    job.error ? notice(job.status === 'failed' ? 'danger' : 'warn', job.error) : null,
    h('div', { class: 'small' }, `Corporate actions: ${job.corporateActions?.status || '—'}${fin(job.corporateActions?.rows) ? ` (${int(job.corporateActions.rows)} rows)` : ''}${job.corporateActions?.error ? ` · ${job.corporateActions.error}` : ''}`),
    h('div', { class: 'lab-symgrid' }, syms.map(([sym, s]) => h('div', { class: `lab-symcell ${s.status === 'error' ? 'missing' : ''}` },
      h('span', { class: 'row' }, h('span', { class: 'sym' }, sym), badge(s.status, JOB[s.status] || '')),
      s.status === 'skipped' ? h('span', { class: 'cell-sub' }, s.note || 'skipped')
        : h('span', { class: 'cell-sub' }, `${int(s.bars ?? 0)} daily bars · ${int(s.first15 ?? 0)} first-15 · ${int(s.spreads ?? 0)}/${int(s.spreadDays ?? 0)} spread days${s.step && s.status === 'running' ? ` · step ${s.step}` : ''}`),
      s.error ? h('span', { class: 'cell-sub neg' }, s.error) : null))));
}

function readinessView(P, r) {
  const { o } = P;
  const data = new Map((o.data || []).map((d) => [d.symbol, d]));
  const uni = new Map((o.universe?.symbols || []).map((s) => [s.symbol, s]));
  const periodRows = ['development', 'validation', 'final', 'fullList'].filter((k) => r.periods?.[k]).map((k) => {
    const p = r.periods[k];
    const why = p.reasons || [];
    return [
      h('strong', {}, PERIOD_LABEL[k]),
      h('span', {}, p.basket, h('div', { class: 'cell-sub' }, (p.members || []).map((m) => m.symbol).join(', '))),
      h('span', { class: 'small' }, `${day(p.start)} – ${day(p.end)}`, h('div', { class: 'cell-sub' }, `warm-up from ${day(p.warmupFrom)}`)),
      badge(p.usable ? 'usable' : 'not usable', p.usable ? 'ok' : 'danger'),
      badge(p.costsCalibrated ? 'calibrated' : 'not calibrated', p.costsCalibrated ? 'ok' : 'warn'),
      why.length ? h('details', { class: 'more' }, h('summary', {}, plural(why.length, 'reason')), h('ul', { class: 'bullets small' }, why.map((x) => h('li', {}, x)))) : h('span', { class: 'small muted' }, 'none'),
    ];
  });
  const head = ['Stock', 'Listing used from', 'Status', 'Sessions present', 'Missing', 'Split checks', 'Split-like moves', 'Dividends', 'Other checks', 'First 15 min · spreads'];
  const tbody = h('tbody');
  for (const s of r.symbols || []) {
    const u = uni.get(s.symbol) || {};
    const d = data.get(s.symbol);
    const scan = s.splitScan?.candidates || [];
    const other = [];
    if (s.zeroVolume?.count) other.push(`${s.zeroVolume.count} zero-volume bars`);
    if (s.invalidOhlc?.count) other.push(`${s.invalidOhlc.count} inconsistent bars`);
    for (const a of s.unhandledActions || []) other.push(`${String(a.type).replace(/_/g, ' ')} ${a.date} (not modelled)`);
    for (const n of s.nameChanges || []) other.push(`renamed ${n.from} → ${n.to} ${n.date || ''}${n.beforeListing ? ' (before the listing)' : ''}`);
    if ((s.cusips || []).length > 1) other.push(`${s.cusips.length} CUSIPs`);
    const cells = [
      h('div', {}, h('span', { class: 'sym' }, s.symbol), h('span', { class: 'exch' }, ` ${s.exchange}`),
        u.name ? h('div', { class: 'cell-sub' }, u.name) : null,
        // An external reference for the owner's manual price cross-check (strategy/range-trend/PRICE-CROSSCHECK.md).
        // A plain link only: nothing in the simulation reads Yahoo; Alpaca stays the sole price source.
        h('div', { class: 'cell-sub' }, extLink(`https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}`, 'Yahoo Finance'), ' (external reference; never read by the simulation)'),
        u.kind === 'leveraged_etf' ? h('div', {}, badge('leveraged ETF', 'lev')) : null,
        u.identity && u.identity !== 'confirmed' ? h('div', {}, badge('identity pending', 'warn')) : null,
        h('div', { class: 'cell-sub' }, (u.baskets || []).map((b) => (b === 'prospective' ? 'prospective only' : `basket ${b}`)).join(' · '))),
      h('span', {}, day(s.listedFrom), s.bars?.beforeListing ? h('div', { class: 'cell-sub' }, `${int(s.bars.beforeListing)} earlier bars ignored`) : null),
      badge(s.status, READY[s.status] || ''),
      h('span', {}, `${int(s.sessions?.present)} of ${int(s.sessions?.expected)}`, h('div', { class: 'cell-sub' }, `${day(s.sessions?.from)} – ${day(s.sessions?.through)}`)),
      h('span', { class: s.sessions?.missing ? 'neg' : '' }, int(s.sessions?.missing),
        s.sessions?.missingSample?.length ? h('div', { class: 'cell-sub' }, `${s.sessions.missingSample.slice(0, 3).join(', ')}${s.sessions.missing > 3 ? ', …' : ''}`) : null),
      (s.splits || []).length ? h('div', { class: 'small' }, s.splits.map((x) => h('div', {}, `${day(x.exDate)} ${ratioText(x.ratio)} `, badge(x.status, SPLIT[x.status] || ''),
        x.overnight ? h('div', { class: 'cell-sub' }, `open/previous close ${x.overnight.ratio} (expected about ${x.expectedOvernight})`) : null))) : h('span', { class: 'small muted' }, 'none recorded'),
      scan.length ? h('div', { class: 'small' }, `${scan.length} found`, scanList(P, s.symbol, scan)) : h('span', { class: 'small muted' }, 'none'),
      h('span', {}, int(s.dividends?.count), h('div', { class: 'cell-sub' }, [s.dividends?.ignoredBeforeListing ? `${s.dividends.ignoredBeforeListing} before the listing ignored` : null, s.dividends?.withoutPayDate ? `${s.dividends.withoutPayDate} without a pay date (paid on the ex-date)` : null].filter(Boolean).join(' · '))),
      other.length ? h('div', { class: 'small' }, other.map((x) => h('div', {}, x))) : h('span', { class: 'small muted' }, 'none'),
      h('span', { class: 'small' }, `${int(s.first15?.present)} of ${int(s.first15?.expected)}`, h('div', { class: 'cell-sub' }, `${int(s.spreads?.sampled)} of ${int(s.spreads?.expectedDays)} spread days${d?.news ? ` · ${int(d.news)} news items` : ''}`)),
    ];
    tbody.append(h('tr', {}, cells.map((c) => h('td', {}, c))));
    const notes = [...(s.notes || []), ...(s.warnings || [])];
    if (notes.length) {
      tbody.append(h('tr', { class: 'hxr-note-row' }, h('td', { colspan: String(head.length) },
        h('div', { class: 'hxr-note' }, h('strong', {}, `${s.symbol}: `), notes.join(' ')))));
    }
  }
  return h('div', { class: 'stack mt', style: { gap: '10px' } },
    h('div', { class: 'small' }, `Sessions are expected through ${day(r.lastCompleteSession)}, the last NYSE session before today (${day(r.today)}). ${r.gate || ''}`),
    table(['Period', 'Basket', 'Dates', 'Usable', 'Spread calibration', 'Why not'], periodRows, { cls: 'hxr-ready-periods' }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'lab-table hxr-table hxr-ready' }, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), tbody)),
    h('div', { class: 'small muted' }, 'Split checks compare the raw overnight move with the recorded ratio; split-like moves are overnight moves within 8% of a common split ratio that no recorded split explains. Bars, corporate actions and dividends dated before a stock\'s listing are never used.'));
}

// Split-like moves, unreviewed first; each can be recorded as reviewed by the owner.
function scanList(P, symbol, scan) {
  const list = [...scan].sort((a, b) => Number(!!a.reviewed) - Number(!!b.reviewed));
  return [
    list.slice(0, 5).map((c) => h('div', { class: 'cell-sub' }, `${c.date}: ${c.looksLike}`,
      c.reviewed ? ' (reviewed: not a split)' : [' ', h('button', { class: 'linklike lab-link', type: 'button', onclick: () => reviewDialog(P, symbol, c) }, 'Mark reviewed…')])),
    list.length > 5 ? h('div', { class: 'cell-sub' }, `and ${list.length - 5} more`) : null,
  ];
}

function reviewDialog(P, symbol, c) {
  const reason = h('textarea', { name: 'reason', maxlength: 2000, rows: 3, placeholder: 'What you checked, and why it is not a split (required)' });
  const a = ack(`I checked ${symbol}'s move on ${c.date} against another source: it is a real price move, not a split.`);
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    notice('warn', `${symbol} opened at ${px(c.open)} on ${day(c.date)} after closing at ${px(c.prevClose)} on ${day(c.prevSession)} (open/previous close ${c.ratio}), which looks like ${c.looksLike}. No recorded split explains it, so every period that includes it is blocked.`),
    h('ul', { class: 'bullets small' },
      h('li', {}, 'Record it only after checking another source (the exchange, the company or another data vendor). A missed split would corrupt every result that includes it.'),
      h('li', {}, 'The record keeps your reason and its time, is logged in the experiment log and cannot be removed.')),
    field('Reason', reason, 'Up to 2,000 characters.'),
    a.el);
  confirmDialog(`Record the ${symbol} move on ${day(c.date)} as reviewed?`, body, {
    confirmLabel: 'Record as reviewed',
    ready: () => (!a.box.checked ? 'Tick the box to confirm.' : !reason.value.trim() ? 'A reason is required.' : true),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/readiness/reviewed-moves', { symbol, date: c.date, reason: reason.value.trim(), confirm: true });
      toast(r.note || 'Recorded.');
      P.reload();
    },
  });
}

function spcxBlock(P) {
  const { o } = P;
  const pending = (o.universe?.symbols || []).filter((s) => s.identity && s.identity !== 'confirmed');
  if (!pending.length) return h('div', {});
  const rec = o.settings?.spcx;
  const confirmed = rec?.confirmed === true;
  const s = pending[0];
  const btn = h('button', { class: `btn small ${confirmed ? '' : 'primary'}`, type: 'button' }, confirmed ? `Withdraw the ${s.symbol} confirmation…` : `Confirm ${s.symbol}'s identity…`);
  btn.addEventListener('click', () => spcxDialog(P, s, !confirmed));
  return h('div', { class: 'lab-panel' },
    h('h4', { class: 'lab-h4 first' }, `${s.symbol} identity`),
    h('div', { class: 'row small' }, badge(confirmed ? 'confirmed by you' : 'not confirmed', confirmed ? 'ok' : 'warn'), rec ? h('span', { class: 'muted' }, `recorded ${when(rec.at)}`) : h('span', { class: 'muted' }, 'never recorded')),
    h('p', { class: 'small mt' }, o.settings?.spcxIdentity || `${s.symbol}: ${s.name}`),
    h('p', { class: 'small muted' }, confirmed ? `${s.symbol} joins the prospective account when it is started. It is never used in a backtest.` : `Until you confirm it, ${s.symbol} is not downloaded or priced anywhere in HXR.`),
    btn);
}

function spcxDialog(P, s, confirm) {
  const a = ack(confirm ? `I have checked that ${s.symbol} on ${s.exchange === 'NASDAQ' ? 'Nasdaq' : s.exchange} is ${s.name}, listed ${day(s.listedFrom)}.` : `Withdraw my confirmation of ${s.symbol}.`);
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    notice('warn', h('strong', {}, 'Identity facts. '), P.o.settings?.spcxIdentity || ''),
    s.note ? h('div', { class: 'small' }, s.note) : null,
    h('ul', { class: 'bullets small' },
      h('li', {}, `Under Signal Desk's identity rule an unconfirmed instrument is never priced. Bars, corporate actions and dividends dated before ${day(s.listedFrom)} are never used (they belong to the earlier security).`),
      confirm
        ? h('li', {}, `Confirming lets HXR download ${s.symbol} and add it to the prospective account when the account is started (one more sleeve). An account that already exists keeps the sleeves it started with. ${s.symbol} is never used in a backtest: it has too little history.`)
        : h('li', {}, `Withdrawing stops HXR from pricing ${s.symbol}. If the prospective account holds ${s.symbol}, it is not processed while the confirmation is withdrawn.`),
      h('li', {}, 'The choice is recorded with its time; earlier choices are kept.')),
    a.el);
  confirmDialog(confirm ? `Confirm ${s.symbol}'s identity?` : `Withdraw the ${s.symbol} confirmation?`, body, {
    confirmLabel: confirm ? `Confirm ${s.symbol}` : 'Withdraw', danger: !confirm,
    ready: () => (a.box.checked ? true : 'Tick the box to confirm.'),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/spcx', { confirmed: confirm, confirm: true });
      toast(r.note || 'Recorded.');
      P.reload();
    },
  });
}

function calibrationBlock(o) {
  const c = o.spreadCalibration;
  if (!c) return h('div', {});
  const syms = (o.universe?.symbols || []).map((s) => s.symbol);
  return h('div', { class: 'lab-panel' },
    h('h4', { class: 'lab-h4 first' }, 'Spread calibration (cost input)'),
    h('div', { class: 'small muted' }, `${c.method}; floor ${c.floorBps} bps. Calibration hash ${shortHash(c.hash)}.`),
    h('div', { class: 'small muted' }, 'Each year\'s figure below uses all of that year\'s samples; a fill uses only the samples dated on or before it.'),
    h('details', { class: 'more mt' }, h('summary', {}, 'Half-spread per stock and year (full-year values)'),
      table(['Stock', 'First sampled', 'Samples (usable of stored)', 'Half-spread by year'], syms.map((s) => {
        const t = c.table?.[s] || {};
        const n = c.samples?.[s] || {};
        const years = Object.entries(t);
        return [h('span', { class: 'sym' }, s), day(c.firstSampled?.[s]), `${int(n.usable ?? 0)} of ${int(n.stored ?? 0)}`,
          c.firstSampled?.[s] && years.length ? h('span', { class: 'small' }, years.map(([y, v]) => `${y}: ${bps(v)}`).join(' · ')) : h('span', { class: 'small muted' }, `no usable sample: the ${c.floorBps} bps floor applies`)];
      }), { cls: 'hxr-calib' })));
}

// ---------- 5. actions ----------

function commonBlock(o) {
  if (o.busy) return `Another HXR run is in progress (${o.busy.kind}, started ${when(o.busy.startedAt)}).`;
  if (o.fetch?.running) return 'A data download is running; runs wait until it has finished so they read one consistent data set.';
  return null;
}

function periodBlock(o, keys) {
  for (const k of keys) {
    const p = o.readiness?.periods?.[k];
    if (!p) return `The ${PERIOD_LABEL[k].toLowerCase()} period is unknown to the server.`;
    if (!p.usable) return `The ${PERIOD_LABEL[k].toLowerCase()} period is not ready: ${p.reasons?.[0] || 'see the readiness table'}${p.reasons?.length > 1 ? ` (and ${p.reasons.length - 1} more; see Data readiness)` : ''}.`;
    if (!p.costsCalibrated) return `The ${PERIOD_LABEL[k].toLowerCase()} period has no spread calibration for every stock yet (download the data).`;
  }
  return null;
}

function actionCard(title, what, gate, ...buttons) {
  return h('div', { class: 'lab-panel hxr-action' },
    h('h4', { class: 'lab-h4 first' }, title),
    h('div', { class: 'small' }, what),
    gate ? h('div', { class: 'small hxr-gate' }, gate) : null,
    h('div', { class: 'row' }, buttons));
}

function actionButton(label, reason, onClick, cls = 'primary') {
  const b = h('button', { class: `btn small ${cls}`, type: 'button', disabled: reason ? true : null, title: reason || null }, label);
  b.addEventListener('click', onClick);
  return b;
}

function actionsSection(P) {
  const { o } = P;
  return sec('actions', 'Actions (simulated runs)',
    o.busy ? notice('info', h('span', { class: 'spinner lab-inline-spin' }), ` A ${o.busy.kind} run is in progress (started ${when(o.busy.startedAt)}). This page refreshes when it has finished.`) : null,
    h('div', { class: 'hxr-actions' }, selectionCard(P), validationCard(P), evaluationCard(P), prospectiveCard(P)),
    P.frozen && !recordedInRepo(P) ? frozenRecordBlock(P) : null,
    h('p', { class: 'small muted mt' }, 'Each run replays stored daily bars on simulated accounts. Nothing is ordered, routed or sent anywhere, and no notification is sent.'));
}

// The frozen config, to be saved unchanged in the repository before the evaluation.
function frozenRecordBlock(P) {
  const f = P.frozen;
  return h('div', { class: 'lab-panel mt' },
    h('h4', { class: 'lab-h4 first' }, `Record ${f.version} in the repository`),
    h('div', { class: 'small' }, `Save this JSON, unchanged, as ${frozenFile(f)}, so its hash (${shortHash(f.configHash)}) matches the frozen version, and add an EXPERIMENT-LOG.md entry. Then run the evaluation.`),
    h('details', { class: 'more' }, h('summary', {}, `${frozenFile(f)} (frozen ${when(f.frozenAt)})`),
      h('pre', { class: 'mono small hxr-json' }, JSON.stringify(f.config ?? null, null, 2))));
}

function muBlockReason(o) {
  const mu = o.decisions?.mu?.choice;
  if (mu === 'keep') return null;
  return mu === 'drop' ? 'You chose to drop MU from the evaluation: the pre-registration has to be restated as a new version first.' : 'Record the pending MU decision first (Pre-registration, disclosure 1).';
}

function pickRuleBlock(P) {
  return P.pickRule === 'pending_owner_choice' ? 'The development pick rule is pending your choice (amendment 3b): record it in criteria-hxr-v3a.json and EXPERIMENT-LOG.md first.' : null;
}

function selectionCard(P) {
  const { o } = P;
  const period = o.periods?.development || {};
  const block = commonBlock(o) || muBlockReason(o) || pickRuleBlock(P) || periodBlock(o, ['development']);
  const first = P.selEntries[0];
  const reason = first ? `Already run for ${P.prereg} on ${when(first.at)}. It runs once; a repeat needs a written reason, is marked contaminated and never freezes a version.` : block;
  return actionCard('Run development pick (once)',
    `The six candidates, the three X3 comparisons and both benchmarks on basket ${period.basket || '—'} over ${day(period.start)} – ${day(period.end)}, at base costs. Picks at most one candidate by your pick rule and freezes it; then runs the winner's neighbouring settings (reported only). In-sample.`,
    reason,
    actionButton('Run development pick (once)', reason, () => selectionDialog(P, false)),
    first ? actionButton('Repeat (contaminated)…', block, () => selectionDialog(P, true), 'danger') : null,
    // The pick is stored; only its reported-only neighbouring settings are missing (EXPERIMENT-LOG entry 13, correction 6).
    o.pickNeighbours && o.pickNeighbours.status !== 'done' ? actionButton('Run neighbouring settings…', commonBlock(o), () => neighboursDialog(P), '') : null);
}

function neighboursDialog(P) {
  const n = P.o.pickNeighbours;
  const a = ack('I understand these runs are reported only and never change the pick.');
  confirmDialog('Run the neighbouring settings of the pick?', h('div', { class: 'stack', style: { gap: '10px' } },
    notice('info', `The development pick, its ledger entry and the frozen version are stored. The ten neighbouring settings of ${n.candidate} ${n.status === 'failed' ? `did not finish (${n.error})` : 'have not been run'}. This runs them on the development period, one setting changed at a time. It is not a repeat of the pick and writes no ledger entry.`),
    a.el), {
    confirmLabel: 'Run neighbouring settings',
    runningText: 'Running the neighbouring settings (simulated, reported only)… keep this page open.',
    ready: () => (!a.box.checked ? 'Tick the box to confirm.' : true),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/selection/neighbours', { confirm: true });
      toast(r.note || 'Neighbouring settings finished (simulated).');
      S.sel = null;
      P.reload();
    },
  });
}

function validationCard(P) {
  const { o } = P;
  const period = o.periods?.validation || {};
  const prior = P.frozen ? P.valEntries.filter((e) => e.version === P.frozen.version && e.configHash === P.frozen.configHash) : [];
  const block = commonBlock(o) || (!P.frozen
    ? (P.cleanSel ? 'No frozen version: the development pick found no candidate worth validating, so the validation period stays unused.' : 'Needs the frozen version from the development pick first.')
    : muBlockReason(o) || periodBlock(o, ['validation']));
  const reason = prior.length ? `Already run for ${P.frozen.version} on ${when(prior[0].at)}. It runs once per frozen version; a repeat needs a written reason, is marked contaminated and can never validate.` : block;
  return actionCard('Run validation (once)',
    `${P.frozen ? P.frozen.version : 'The frozen version'} against both benchmarks on basket ${period.basket || '—'} over ${day(period.start)} – ${day(period.end)}. Gate V1–V2: enough round trips, and at least 1.10 × both benchmarks' return per unit of decline. A failure stops HXR; no runner-up is ever tried.`,
    reason,
    actionButton('Run validation (once)', reason, () => validationDialog(P, false)),
    prior.length ? actionButton('Repeat (contaminated)…', block, () => validationDialog(P, true), 'danger') : null);
}

function evaluationCard(P) {
  const { o } = P;
  const period = o.periods?.final || {};
  const prior = P.frozen ? P.evalEntries.filter((e) => e.version === P.frozen.version && e.configHash === P.frozen.configHash) : [];
  const val = P.validation;
  const block = commonBlock(o) || (!P.frozen
    ? (P.cleanSel ? 'No frozen version: the development pick found no candidate worth validating, so the final period stays unused.' : 'Needs the frozen version from the development pick first.')
    : !val ? 'Needs the validation run first: the final period is used only after the validation gate passes.'
      : val.outcome !== 'validated' ? `${P.frozen.version} did not pass the validation gate (${val.outcome.replace(/_/g, ' ')}): HXR stops and the final period is never used.`
        : muBlockReason(o) || periodBlock(o, ['final']));
  const reason = prior.length ? `Already run for ${P.frozen.version} on ${when(prior[0].at)}. It runs once per frozen version; a repeat needs a written reason, is marked contaminated and can never pass.` : block;
  return actionCard('Run final (once)',
    `${P.frozen ? P.frozen.version : 'The frozen version'} against both benchmarks on basket ${period.basket || '—'} over ${day(period.start)} – ${day(period.end)}, with the stress versions, the leave-one-stock-out runs and the full-list check. Judged by G1–G6 against both benchmarks.`,
    reason,
    actionButton('Run final (once)', reason, () => evaluationDialog(P, false)),
    prior.length ? actionButton('Repeat (contaminated)…', block, () => evaluationDialog(P, true), 'danger') : null);
}

function prospectiveCard(P) {
  const { o } = P;
  const reason = !P.frozen ? 'Needs the frozen version from the selection run.'
    : o.prospective ? `Started ${when(o.prospective.startedAt)}. There is only one account; it is never restarted.` : null;
  return actionCard('Start prospective account',
    `${P.frozen ? P.frozen.version : 'The frozen version'} and the fully invested hold side by side on basket B${o.settings?.spcx?.confirmed ? ' plus SPCX' : ''}, from the first session after you start it. The only data nobody has seen. (The day-one hold is a backtest benchmark only.)`,
    reason,
    actionButton('Start prospective account', reason, () => prospectiveDialog(P)));
}

function armsList(cands) {
  return h('ul', { class: 'bullets small' }, cands.map((c) => {
    const t = ruleText(c.rule);
    return h('li', {}, h('strong', {}, `${c.label || c.version}: `), c.rule?.type === 'hold' ? 'holds from the first session; never sells.' : `exit to cash when ${t.exit}; buy back when ${t.back}.`);
  }));
}

function selectionDialog(P, repeat) {
  const { o } = P;
  const s = o.criteria?.selection || {};
  const period = o.periods?.development || {};
  const arms = (o.configs || []).filter((c) => !c.error && c.role !== 'superseded' && c.role !== 'later' && !(P.frozen && c.version === P.frozen.version));
  const risk = riskText(arms.find((c) => c.assumptions?.risk)?.assumptions);
  const reason = h('textarea', { name: 'reason', maxlength: 2000, rows: 3, placeholder: 'Why the development pick must be run again (required)' });
  const a = ack(repeat ? 'I understand this repeat is marked contaminated and can never freeze a version.' : 'I have read the pre-registration; this uses the development period once.');
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    repeat
      ? notice('danger', `The development pick was already run ${plural(P.selEntries.length, 'time')} for ${P.prereg} (first ${when(P.selEntries[0]?.at)}). Another run needs a written reason, is recorded in the ledger as contaminated and never freezes a version.`)
      : notice('warn', `The development pick runs once for ${P.prereg}. Its result decides whether HXR continues at all.`),
    h('div', {}, h('strong', {}, 'What runs. '), `Each arm below and the day-one hold on basket ${period.basket} (${basketList(o, period.basket).join(', ')}) from ${day(period.start)} to ${day(period.end)} (warm-up from ${day(period.warmupFrom)}), at base costs, each from a fresh simulated ${usd(startingCash(o))} account. The candidates and comparisons use one pool of risk-sized cash; only the fully invested hold uses equal sleeves (1/N of the cash per stock); the day-one hold keeps the candidates' day-one positions and never sells.`),
    risk ? h('div', { class: 'small' }, risk) : null,
    armsList(arms),
    h('div', { class: 'small' }, 'Each arm also runs with first 15-minute VWAP fills, so assumed and realistically available fills are compared for every run. Those runs are reported only; the pick uses the base-cost runs.'),
    o.decisions?.mu ? h('div', { class: 'small' }, h('strong', {}, 'MU decision: '), `${o.decisions.mu.choice} MU (recorded ${when(o.decisions.mu.at)})`) : null,
    h('div', {}, h('strong', {}, 'How one is picked. '), `A candidate qualifies with at least ${s.minRoundTrips} completed exit-and-buy-back round trips (fresh entries do not count). ${pickText(s)} A tie goes to the smaller largest decline. If no candidate qualifies and beats both benchmarks, HXR stops: nothing is frozen and the validation and final periods are never used. Otherwise the pick is frozen as a new version before the validation run, and its ten neighbouring settings are run and reported only.`),
    h('div', { class: 'small' }, 'Development results are in-sample: they describe the period the pick is made on and are not evidence that the rule works.'),
    repeat ? field('Reason for the repeat', reason, 'Up to 2,000 characters. Stored with the runs and in the ledger.') : null,
    a.el,
    h('div', { class: 'small muted' }, 'Simulation only: stored daily bars replayed on simulated accounts. Nothing is ordered or sent anywhere.'));
  confirmDialog(repeat ? 'Repeat the development pick (contaminated)?' : 'Run the development pick?', body, {
    confirmLabel: repeat ? 'Run again (contaminated)' : 'Run the development pick', danger: repeat,
    runningText: 'Running the simulated development backtests… keep this page open.',
    ready: () => (!a.box.checked ? 'Tick the box to confirm.' : repeat && !reason.value.trim() ? 'A repeat needs a written reason.' : true),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/selection', { confirm: true, ...(repeat ? { reason: reason.value.trim() } : {}) });
      toast(r.note || 'Development pick finished (simulated).');
      S.sel = null;
      S.cand = null;
      S.run = null;
      P.reload();
    },
  });
}

function validationDialog(P, repeat) {
  const { o } = P;
  const period = o.periods?.validation || {};
  const f = P.frozen;
  const base = (o.configs || []).find((c) => !c.error && c.version === f.basedOn);
  const hold = (o.configs || []).find((c) => !c.error && c.rule?.type === 'hold');
  const prior = P.valEntries.filter((e) => e.version === f.version && e.configHash === f.configHash);
  const reason = h('textarea', { name: 'reason', maxlength: 2000, rows: 3, placeholder: 'Why the validation must be run again (required)' });
  const a = ack(repeat ? 'I understand this repeat is marked contaminated and can never validate.' : 'I understand the validation runs once per frozen version; a failure stops HXR and no runner-up is ever tried.');
  const v = o.criteria?.validation || {};
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    repeat
      ? notice('danger', `${f.version} was already validated ${plural(prior.length, 'time')} (first ${when(prior[0]?.at)}). Another run needs a written reason, is recorded as contaminated and can never validate.`)
      : notice('warn', `The validation is the one gate between the development pick and the final period. Only ${f.version} is ever validated; a failure closes HXR.`),
    h('div', {}, h('strong', {}, 'What runs. '), `${f.version} (frozen ${when(f.frozenAt)} from ${f.basedOn}, config ${shortHash(f.configHash)}), the fully invested hold and the day-one hold on basket ${period.basket} (${basketList(o, period.basket).join(', ')}) from ${day(period.start)} to ${day(period.end)}, each from a fresh simulated ${usd(startingCash(o))}; each also with first 15-minute VWAP fills (reported).`),
    armsList([base ? { ...base, label: `${f.version} (= ${base.label})` } : { version: f.version, label: f.version, rule: f.config?.rule }, hold].filter(Boolean)),
    period.use ? h('div', { class: 'small' }, h('strong', {}, 'Disclosed: '), period.use) : null,
    h('div', {}, h('strong', {}, 'Gate. '), h('ul', { class: 'bullets small' }, h('li', {}, h('strong', {}, 'V1: '), v.V1?.rule || '—'), h('li', {}, h('strong', {}, 'V2: '), v.V2?.rule || '—'))),
    repeat ? field('Reason for the repeat', reason, 'Up to 2,000 characters. Stored with the runs and in the ledger.') : null,
    a.el,
    h('div', { class: 'small muted' }, 'Simulation only: stored daily bars replayed on simulated accounts. Nothing is ordered or sent anywhere.'));
  confirmDialog(repeat ? 'Repeat the validation (contaminated)?' : 'Run the validation?', body, {
    confirmLabel: repeat ? 'Run again (contaminated)' : 'Run the validation', danger: repeat,
    runningText: 'Running the simulated validation backtests… keep this page open.',
    ready: () => (!a.box.checked ? 'Tick the box to confirm.' : repeat && !reason.value.trim() ? 'A repeat needs a written reason.' : true),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/validation', { confirm: true, ...(repeat ? { reason: reason.value.trim() } : {}) });
      const [vl] = VOUT[r.outcome] || [r.outcome];
      toast(`Validation finished (simulated): ${vl}. ${r.meaning || ''}`);
      S.val = null;
      S.run = null;
      P.reload();
    },
  });
}

function evaluationDialog(P, repeat) {
  const { o } = P;
  const ev = o.periods?.final || {}, full = o.periods?.fullList || {};
  const f = P.frozen;
  const base = (o.configs || []).find((c) => !c.error && c.version === f.basedOn);
  const hold = (o.configs || []).find((c) => !c.error && c.rule?.type === 'hold');
  const prior = P.evalEntries.filter((e) => e.version === f.version && e.configHash === f.configHash);
  const reason = h('textarea', { name: 'reason', maxlength: 2000, rows: 3, placeholder: 'Why the evaluation must be run again (required)' });
  const a = ack(repeat ? 'I understand this repeat is marked contaminated and can never pass.' : 'I understand the evaluation runs once per frozen version; a repeat is marked contaminated and can never pass.');
  const recorded = recordedInRepo(P);
  // The full-list check is reported, not a gate: without it the evaluation runs only if you say so.
  const fullBlock = periodBlock(o, ['fullList']);
  const without = fullBlock ? ack('Evaluate without the basket B full-list check. It is recorded as not run; adding it later needs a repeat, which is marked contaminated.') : null;
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    repeat
      ? notice('danger', `${f.version} was already evaluated ${plural(prior.length, 'time')} (first ${when(prior[0]?.at)}). Another run needs a written reason, is recorded as contaminated and can never pass.`)
      : notice('warn', `The final run is the one judged run of ${f.version}. Looking at it and then changing the rules turns it into one more backtest.`),
    h('div', {}, h('strong', {}, 'What runs. '), `${f.version} (frozen ${when(f.frozenAt)} from ${f.basedOn}, config ${shortHash(f.configHash)}), the fully invested hold and the day-one hold on basket ${ev.basket} (${basketList(o, ev.basket).join(', ')}) from ${day(ev.start)} to ${day(ev.end)}, each from a fresh simulated ${usd(startingCash(o))}. Also: spread and slippage doubled; fills two sessions after the decision; first 15-minute VWAP fills; 0% withholding; one run leaving out each stock; ${fullBlock ? `but not the basket ${full.basket} full-list check, which is not ready` : `and the basket ${full.basket} full-list check with its VWAP fills (${day(full.start)} to ${day(full.end)}, reported, not a gate)`}.`),
    fullBlock ? notice('warn', h('strong', {}, 'The full-list check is not ready. '), `${fullBlock} It is reported, not a gate, so the evaluation can run without it if you say so below.`) : null,
    armsList([base ? { ...base, label: `${f.version} (= ${base.label})` } : { version: f.version, label: f.version, rule: f.config?.rule }, hold].filter(Boolean)),
    recorded ? null : notice('warn', `${f.version} is not yet recorded as a config file in strategy/hxr/configs with the same hash. The pre-registration asks for it (and an EXPERIMENT-LOG.md entry) before the evaluation run.`),
    ev.use ? h('div', { class: 'small' }, h('strong', {}, 'Disclosed: '), ev.use) : null,
    h('div', {}, h('strong', {}, 'Judged by. '), h('ul', { class: 'bullets small' }, (o.criteria?.criteria || []).map((c) => h('li', {}, h('strong', {}, `${c.id} ${c.name}: `), c.rule)))),
    h('div', { class: 'small' }, `FAIL: ${o.criteria?.outcomes?.FAIL || '—'}. INSUFFICIENT EVIDENCE: ${o.criteria?.outcomes?.INSUFFICIENT_EVIDENCE || '—'}. PASS means ${o.criteria?.passMeaning || '—'}.`),
    repeat ? field('Reason for the repeat', reason, 'Up to 2,000 characters. Stored with the runs and in the ledger.') : null,
    a.el,
    without?.el,
    h('div', { class: 'small muted' }, 'Simulation only: stored daily bars replayed on simulated accounts. Nothing is ordered or sent anywhere.'));
  confirmDialog(repeat ? 'Repeat the final run (contaminated)?' : 'Run the final run?', body, {
    confirmLabel: repeat ? 'Run again (contaminated)' : 'Run the final run', danger: repeat,
    runningText: 'Running the simulated final backtests (base, stress versions, leave-one-out and the full-list check, each with both benchmarks)… keep this page open.',
    ready: () => (!a.box.checked ? 'Tick the box to confirm.' : without && !without.box.checked ? 'Tick the box to evaluate without the full-list check, or refresh the data first.' : repeat && !reason.value.trim() ? 'A repeat needs a written reason.' : true),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/evaluation', { confirm: true, ...(without ? { withoutFullList: true } : {}), ...(repeat ? { reason: reason.value.trim() } : {}) });
      const [ol] = OUTCOME[r.outcome] || [r.outcome];
      toast(`Final run finished (simulated): ${ol}. ${r.meaning || ''} ${r.caveat || ''}`);
      S.ev = null;
      S.run = null;
      P.reload();
    },
  });
}

function prospectiveDialog(P) {
  const { o } = P;
  const f = P.frozen;
  const base = (o.configs || []).find((c) => !c.error && c.version === f.basedOn);
  const hold = (o.configs || []).find((c) => !c.error && c.rule?.type === 'hold');
  const spcx = o.settings?.spcx?.confirmed === true;
  const basket = (o.universe?.baskets?.prospective?.symbols || []).concat(spcx ? o.universe?.baskets?.prospective?.addWhenConfirmed || [] : []);
  const a = ack('I understand there is only one prospective account and it is never restarted.');
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    notice('info', `Starts the one prospective simulated account: ${f.version} and the hold side by side on ${basket.length} stocks (${basket.join(', ')}), each from a simulated ${usd(startingCash(o))}. ${f.config?.account?.allocation === 'risk_sized' ? `${f.version} uses one pool of risk-sized cash (the frozen settings: ${riskText(f.config) || 'see the config'}); the hold uses equal sleeves.` : 'Both use equal sleeves.'} It starts at the open of the first session after now.`),
    armsList([base ? { ...base, label: `${f.version} (= ${base.label})` } : { version: f.version, label: f.version, rule: f.config?.rule }, hold].filter(Boolean)),
    h('ul', { class: 'bullets small' },
      h('li', {}, 'After each close, "Process now" or the scheduler processes the completed session: each decision is recorded with the time it was recorded, and counts as on time only if recorded before the next session\'s open.'),
      h('li', {}, 'Orders fill at the next open on the same basis as the backtest; dividends are credited and splits applied.'),
      h('li', {}, 'News (Alpaca / Benzinga) is recorded with the time Signal Desk first saw it and shown next to each decision. In this version news changes no decision.'),
      h('li', {}, spcx ? 'SPCX is included because you confirmed its identity.' : 'SPCX is not included: its identity is not confirmed. The sleeves are fixed when the account starts.'),
      h('li', {}, 'Everything is a simulated internal ledger. No order is sent to any broker or paper-trading platform, and no notification is sent.')),
    a.el);
  confirmDialog('Start the prospective account?', body, {
    confirmLabel: 'Start prospective account',
    ready: () => (a.box.checked ? true : 'Tick the box to confirm.'),
    onConfirm: async () => {
      const r = await P.api('POST', '/api/hxr/prospective/start', { confirm: true });
      toast(r.note || 'Prospective account started (simulated).');
      P.reload();
    },
  });
}

// ---------- 6. results ----------

// The judged runs of a ledger entry: the HXR arm carries the frozen version, the day-one hold's version ends in ":hold-day-one".
async function judgedRuns(P, entry, kind) {
  const { runs } = await P.api('GET', `/api/hxr/runs?kind=${kind}&limit=1000`);
  const ids = new Set(entry.runIds);
  const set = runs.filter((r) => ids.has(r.id));
  const isDayOne = (r) => /:hold-day-one$/.test(r.version);
  const hx = set.find((r) => r.version === entry.version), d1 = set.find(isDayOne), hd = set.find((r) => r.version !== entry.version && !isDayOne(r));
  const [a, b, c] = await Promise.all([hx ? getRun(P, hx.id) : null, hd ? getRun(P, hd.id) : null, d1 ? getRun(P, d1.id) : null]);
  return { hxr: a, hold: b, holdDayOne: c };
}
const evaluationRuns = (P, entry) => judgedRuns(P, entry, 'evaluation');

function resultsSection(P) {
  return sec('results', 'Results (simulated)',
    P.selEntries.length ? ledgerResults(P, 'sel', P.selEntries, 'Development pick', badge('IN-SAMPLE', 'warn'), selectionView) : null,
    P.valEntries.length ? ledgerResults(P, 'val', P.valEntries, 'Validation', null, validationView) : null,
    P.evalEntries.length ? ledgerResults(P, 'ev', P.evalEntries, 'Final', null, evaluationView) : null);
}

// HXR against one benchmark at a time (tabs), with the per-stock table.
function benchmarkComparison(hx, benches, opts) {
  const keys = Object.keys(benches).filter((k) => benches[k]);
  if (!keys.length) return notice('warn', 'No benchmark run was found for this entry.');
  if (!S.bench || !keys.includes(S.bench)) S.bench = keys[0];
  const tabs = h('div', { class: 'tabs lab-filter', role: 'tablist', 'aria-label': 'Benchmark' });
  const host = h('div', {});
  const draw = () => {
    mount(tabs, keys.map((k) => h('button', { class: `tab ${k === S.bench ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(k === S.bench), onclick: () => { S.bench = k; draw(); } }, BENCH[k] || k)));
    mount(host, armComparison(hx, benches[S.bench], { ...opts, benchLabel: BENCH[S.bench] || S.bench, cmp: opts.cmpBy?.[S.bench] ?? opts.cmp, fills: opts.fillsBy ? { hxr: opts.fillsBy.hxr, hold: opts.fillsBy[S.bench] } : opts.fills }));
  };
  draw();
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Compare with:'), tabs), host);
}

// One block per ledger kind; repeats (contaminated) can be picked, the clean run is the default.
function ledgerResults(P, key, entries, title, tag, viewFn) {
  const clean = Math.max(0, entries.findIndex((e) => !e.contaminated));
  if (S[key] == null || !entries[S[key]]) S[key] = clean;
  const host = h('div', {});
  const show = () => mount(host, lazy(P.ep, () => viewFn(P, entries[S[key]])));
  const picker = entries.length > 1 ? h('div', { style: { minWidth: '220px', flex: '1 1 260px', maxWidth: '440px' } },
    selectEl(`${title} run`, entries.map((e, i) => [String(i), `${title} ${i + 1} · ${when(e.at)} · ${e.contaminated ? 'repeat, contaminated' : 'clean'}`]), String(S[key]), (v) => { S[key] = Number(v); show(); })) : null;
  show();
  return h('div', { class: 'hxr-block' },
    h('div', { class: 'row hxr-block-head' }, h('h4', { class: 'lab-h4 first' }, title), tag, picker),
    host);
}

async function selectionView(P, entry) {
  const { o } = P;
  const runs = await Promise.all(entry.runIds.map((id) => getRun(P, id)));
  const hold = runs.find((r) => r.run.details?.role === 'hold');
  const dayOne = runs.find((r) => r.run.details?.role === 'hold_day_one');
  const cands = runs.filter((r) => ['candidate', 'comparison'].includes(r.run.details?.role));
  if (!hold || !cands.length) return notice('danger', 'The runs of this development-pick entry were not found or are incomplete.');
  const period = hold.run.period || {};
  const exp = (o.experiments || []).find((x) => x.at === entry.at && /^development pick|^selection run/.test(x.what));
  const frozen = P.frozen && P.cleanSel === entry ? P.frozen : null;
  if (!S.cand || !cands.some((c) => c.run.version === S.cand)) S.cand = frozen && cands.some((c) => c.run.version === frozen.basedOn) ? frozen.basedOn : cands[0].run.version;
  const tabs = h('div', { class: 'tabs lab-filter', role: 'tablist', 'aria-label': 'Candidate' });
  const host = h('div', {});
  const draw = () => {
    mount(tabs, cands.map((c) => h('button', {
      class: `tab ${c.run.version === S.cand ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(c.run.version === S.cand),
      onclick: () => { S.cand = c.run.version; draw(); },
    }, c.run.version)));
    const c = cands.find((x) => x.run.version === S.cand);
    mount(host, benchmarkComparison(c, { hold, holdDayOne: dayOne }, { hxLabel: c.run.version, fillsBy: { hxr: c.run.details?.fills, hold: hold.run.details?.fills, holdDayOne: dayOne?.run.details?.fills } }));
  };
  draw();
  const sel = o.criteria?.selection || {};
  const nb = (frozen && cands.find((c) => c.run.version === frozen.basedOn)?.run.details?.neighbours) || null;
  const row = (r, tag) => {
    const m = r.run.metrics || {};
    return [h('div', {}, h('strong', {}, r.run.config?.label || r.run.version), tag), int(m.roundTrips), pct(m.annualisedReturnPct), pctPlain(m.maxDrawdownPct), ratio(m.returnToDrawdown), money(m.endValue), int(m.freshEntries?.count), h('span', { class: 'small muted' }, `#${r.run.id}`)];
  };
  return h('div', { class: 'stack' },
    notice('warn', h('strong', {}, 'In-sample. '), `These results come from the period the pick is made on (${day(period.start)} to ${day(period.end)}). They show how the rules behaved there; they are not evidence that HXR works.`),
    entry.contaminated ? notice('danger', `Repeat run (contaminated). Reason given: ${entry.reason || '—'}. A repeat never freezes a version.`) : null,
    h('div', { class: 'small' }, h('strong', {}, 'Pick: '), exp?.note || 'not recorded in the experiment log',
      frozen ? ` Frozen as ${frozen.version} (config ${shortHash(frozen.configHash)}) ${when(frozen.frozenAt)}.` : P.cleanSel === entry ? ' Nothing was frozen.' : ''),
    table(['Arm', `Round trips (needs ${sel.minRoundTrips ?? '—'})`, 'Annualised return', 'Largest decline', 'Return ÷ decline', 'End value (simulated)', 'Fresh entries', 'Run'],
      [row(hold, badge('benchmark', 'muted')), ...(dayOne ? [row(dayOne, badge('benchmark', 'muted'))] : []),
        ...cands.map((r) => row(r, frozen?.basedOn === r.run.version ? badge('picked', 'info') : r.run.details?.role === 'comparison' ? badge('comparison: never picked', 'muted') : null))],
      { numeric: [1, 2, 3, 4, 5, 6] }),
    nb ? h('details', { class: 'more' }, h('summary', {}, `Neighbouring settings of the pick (${nb.neighbours.length}, reported only)`),
      table(['Change', 'Round trips', 'Return ÷ decline', 'End value', 'Same conclusion as the pick'], nb.neighbours.map((n) => [Object.entries(n.change).map(([k, v]) => `${k} = ${v}`).join(', '), int(n.roundTrips), ratio(n.returnToDrawdown), money(n.endValue), n.sameConclusion ? 'yes' : 'no']), { numeric: [1, 2, 3] }),
      h('div', { class: 'small muted' }, 'One setting changed at a time on the development period; never used for the pick.')) : null,
    h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Candidate:'), tabs),
    host);
}

async function validationView(P, entry) {
  const { hxr: hx, hold: hd, holdDayOne: d1 } = await judgedRuns(P, entry, 'validation');
  if (!hx) return notice('danger', 'The judged runs of this validation entry were not found.');
  const g = hx.run.details?.validation, rep = hx.run.details?.reported;
  const [vl, vk] = VOUT[g?.outcome] || [g?.outcome || 'not recorded', 'muted'];
  const period = hx.run.period || {};
  return h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Outcome'), badge(vl, vk), entry.contaminated ? badge('contaminated repeat', 'danger') : null,
      h('span', { class: 'small muted' }, `${entry.version} · config ${shortHash(entry.configHash)} · ${day(period.start)} to ${day(period.end)}`)),
    g ? h('div', { class: 'small' }, g.meaning) : null,
    P.o.historicalCaveat ? notice('warn', P.o.historicalCaveat) : null,
    entry.contaminated ? notice('danger', `Repeat run (contaminated). Reason given: ${entry.reason || '—'}. A contaminated validation can never validate.`) : null,
    g ? table(['', 'Gate', 'Status', 'Result'], g.criteria.map((c) => { const [l, k] = CRIT[c.status] || [c.status, '']; return [h('span', { class: 'mono' }, c.id), c.name, badge(l, k), h('div', { class: 'small' }, c.note || '')]; }), { cls: 'lab-crit hxr-crit' }) : null,
    benchmarkComparison(hx, { hold: hd, holdDayOne: d1 }, { hxLabel: entry.version, cmpBy: rep?.comparisons?.main, fillsBy: rep?.fills ? { hxr: rep.fills.hxr, hold: rep.fills.hold, holdDayOne: rep.fills.hold_day_one } : null }));
}

async function evaluationView(P, entry) {
  const { hxr: hx, hold: hd, holdDayOne: d1 } = entry === P.evalEntry && P.evalRuns ? P.evalRuns : await evaluationRuns(P, entry);
  if (!hx || !hd) return notice('danger', 'The judged runs of this final-run entry were not found.');
  const ev = hx.run.details?.evaluation, rep = hx.run.details?.reported;
  const [ol, ok] = OUTCOME[ev?.outcome] || [ev?.outcome || 'not recorded', 'muted'];
  const period = hx.run.period || {};
  return h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Outcome'), badge(ol, ok), entry.contaminated ? badge('contaminated repeat', 'danger') : null,
      h('span', { class: 'small muted' }, `${entry.version} · config ${shortHash(entry.configHash)} · ${day(period.start)} to ${day(period.end)} · out of sample for the rule choice`)),
    P.o.historicalCaveat ? notice('warn', P.o.historicalCaveat) : null,
    entry.contaminated ? notice('danger', `Repeat run (contaminated). Reason given: ${entry.reason || '—'}. A contaminated final run can never pass.`) : null,
    benchmarkComparison(hx, { hold: hd, holdDayOne: d1 }, { hxLabel: entry.version, cmpBy: rep?.comparisons?.main, fillsBy: rep?.fills ? { hxr: rep.fills.hxr, hold: rep.fills.hold, holdDayOne: rep.fills.holdDayOne } : null }),
    criteriaTable(P, ev),
    variantsTable(rep),
    fullListBlock(P, rep));
}

// The basket B full-list check (reported, not a gate): every report item against its hold, or why it was not run.
function fullListBlock(P, rep) {
  const f = rep?.fullList;
  if (!f) return null;
  const title = `Full-list check: basket ${f.basket || 'B'}, ${day(f.period?.start)} to ${day(f.period?.end)} (reported, not a gate)`;
  if (!f.run) {
    return h('div', {}, h('h4', { class: 'lab-h4' }, title),
      notice('warn', h('strong', {}, 'Not run. '), f.note || '', (f.reasons || []).length ? h('ul', { class: 'bullets small' }, f.reasons.slice(0, 10).map((x) => h('li', {}, x))) : null));
  }
  return h('div', {}, h('h4', { class: 'lab-h4' }, title),
    lazy(P.ep, async () => {
      const [hx, hd, d1] = await Promise.all([getRun(P, f.runIds.hxr), getRun(P, f.runIds.hold), f.runIds.holdDayOne ? getRun(P, f.runIds.holdDayOne) : null]);
      return benchmarkComparison(hx, { hold: hd, holdDayOne: d1 }, { hxLabel: hx.run.version, cmpBy: rep.comparisons?.fullList, fillsBy: f.fills ? { hxr: f.fills.hxr, hold: f.fills.hold, holdDayOne: f.fills.holdDayOne } : null });
    }));
}

function armComparison(hx, hd, opts) {
  const m = hx.run.metrics || {}, n = hd?.run?.metrics || {};
  return h('div', { class: 'stack' },
    hd ? equityChart(hx, hd, opts.hxLabel) : null,
    metricsTable(m, n, opts),
    perStockTable(m, n, opts.hxLabel));
}

function equityChart(hx, hd, label) {
  const a = hx.equity || [];
  const hold = new Map((hd.equity || []).map((p) => [p.date, p.equity]));
  const start = hx.run.metrics?.startValue;
  if (a.length < 2) return h('div', { class: 'small muted' }, 'No equity points stored.');
  return h('div', {},
    h('h4', { class: 'lab-h4 first' }, `Account value at each close, ${label} vs hold (simulated, US$ after costs)`),
    line(a.map((p) => ({ t: p.date, v: p.equity })), {
      height: 210, overlays: [{ points: a.map((p) => ({ t: p.date, v: hold.get(p.date) ?? null })), label: 'Hold (simulated)', class: 'hxr-hold' }],
      refLines: fin(start) ? [{ v: start, label: 'Starting cash (simulated)', class: 'cost' }] : [],
    }),
    legend([['hxr-sw-main', `${label} (simulated)`], ['hxr-sw-hold', 'Hold (simulated)'], ['hxr-sw-start', `Starting cash ${money(start)} (simulated)`]]));
}

const ddText = (m) => (fin(m.maxDrawdownPct) ? `${pctPlain(m.maxDrawdownPct)} (${money(m.maxDrawdownUsd)})` : '—');
const peakText = (m) => (m.troughDate ? `${m.peakIsStartValue ? 'start' : day(m.peakDate)} → ${day(m.troughDate)}` : '—');
const recoveryText = (m) => (m.recoveryDate ? day(m.recoveryDate) : m.troughDate ? 'not by the end' : '—');
const countMoney = (x) => (x ? `${int(x.count)} · ${sMoney(x.dollars)}` : '—');
// Declines avoided as the amount saved (positive); older runs carry only dollars (buy-back minus exit).
const savedText = (x) => (x ? `${int(x.count)} · ${money(x.saved ?? (fin(x.dollars) ? -x.dollars || 0 : null))}` : '—');
const avgText = (amount, p, count) => (fin(count) && count > 0 ? `${sMoney(amount)} · ${pct(p)} (${int(count)})` : `none (${int(count ?? 0)})`);
function riseText(r) {
  if (!r) return 'none';
  return `${r.symbol} ${pct(r.pct)} (exit ${day(r.exitDate)}${r.buyBackDate ? `, bought back ${day(r.buyBackDate)}` : ', still out'})`;
}
const toned = (v, text, invert = false) => h('span', { class: tone(invert && fin(v) ? -v : v) }, text);

// Every item the owner asked for, HXR and hold side by side (PREREGISTRATION.md section 11).
function metricsTable(m, n, { hxLabel = 'HXR', fills = null, cmp = null, benchLabel = 'Hold' } = {}) {
  const em = m.episodes || {}, en = n.episodes || {};
  const fe = m.freshEntries, bb = m.buyBacks, sz = m.sizing, ex = m.exposure, pa = m.pauses;
  const rm = m.missedRebounds || {}, rn = n.missedRebounds || {};
  const lm = m.lossesAfterBuyBack || {}, ln = n.lossesAfterBuyBack || {};
  const cm = m.costs || {}, cn = n.costs || {};
  const dm = m.dividends || {}, dn = n.dividends || {};
  const d = (k) => diff(m[k], n[k]);
  const groups = [
    ['Account value and return after costs', [
      ['Start value', money(m.startValue), money(n.startValue)],
      ['End value', money(m.endValue), money(n.endValue), toned(d('endValue'), sMoney(d('endValue')))],
      ['Total return', pct(m.totalReturnPct), pct(n.totalReturnPct), toned(d('totalReturnPct'), pts(d('totalReturnPct')))],
      ['Annualised return', pct(m.annualisedReturnPct), pct(n.annualisedReturnPct), toned(d('annualisedReturnPct'), pts(d('annualisedReturnPct')))],
    ]],
    ['Largest decline from a previous peak', [
      ['Largest decline', ddText(m), ddText(n), toned(d('maxDrawdownPct'), pts(d('maxDrawdownPct')), true)],
      ['Peak → trough', peakText(m), peakText(n)],
      ['Back to that peak', recoveryText(m), recoveryText(n)],
      ['Annualised return ÷ largest decline', ratio(m.returnToDrawdown), ratio(n.returnToDrawdown)],
    ]],
    ['Number of trades and test length', [
      ['Test length', `${int(m.sessions)} sessions · ${ratio(m.years, 2)} years`, `${int(n.sessions)} sessions · ${ratio(n.years, 2)} years`],
      ['Dates', `${day(m.firstDate)} – ${day(m.lastDate)}`, `${day(n.firstDate)} – ${day(n.lastDate)}`],
      ['Initial buys', int(m.initialBuys), int(n.initialBuys)],
      ['Exits (sells)', int(m.sells), int(n.sells)],
      ['Buy-backs', int(m.buys), int(n.buys)],
      ['Completed exit-and-buy-back round trips', int(m.roundTrips), int(n.roundTrips)],
      ['Exits not bought back by the end', int(m.exitsWithoutBuyBack), int(n.exitsWithoutBuyBack)],
      ['Orders still pending at the end', int(m.pendingAtEnd), int(n.pendingAtEnd)],
    ]],
    ['Average gains and losses per completed holding', [
      ['Holdings (buy to sell, or to the end)', `${int(em.count)} (${int(em.closed)} completed, ${int(em.open)} still open)`, `${int(en.count)} (${int(en.closed)} completed, ${int(en.open)} still open)`],
      ['Completed holdings, winners: average gain', avgText(em.avgGain, em.avgGainPct, em.winners), avgText(en.avgGain, en.avgGainPct, en.winners)],
      ['Completed holdings, losers: average loss', avgText(em.avgLoss, em.avgLossPct, em.losers), avgText(en.avgLoss, en.avgLossPct, en.losers)],
      ['Completed holdings: total P/L', sMoney(em.closedPnl), sMoney(en.closedPnl)],
      ['Still open at the end (marked at the last close, not averaged): count · P/L', `${int(em.open)} · ${sMoney(em.openPnl)}`, `${int(en.open)} · ${sMoney(en.openPnl)}`],
      ['Total P/L of all holdings', sMoney(em.totalPnl), sMoney(en.totalPnl)],
    ]],
    ['Time in cash and missed rebounds', [
      ['Time in cash (weighted by money)', pctPlain(m.timeInCashPct, 1), pctPlain(n.timeInCashPct, 1), pts(d('timeInCashPct'))],
      ['Sleeve-sessions spent out', pctPlain(m.sleeveTimeOutPct, 1), pctPlain(n.sleeveTimeOutPct, 1)],
      ['Missed rebounds (bought back above the exit price)', countMoney(rm.reboundsMissed), countMoney(rn.reboundsMissed)],
      ['Declines avoided (bought back at or below the exit): count · amount saved, exit shares × (exit − buy-back)', savedText(rm.declinesAvoided), savedText(rn.declinesAvoided)],
      ['Largest rise while out (exit to the highest close)', riseText(rm.largestRiseWhileOut), riseText(rn.largestRiseWhileOut)],
      ['Exits still open at the end (at the last close)', countMoney(rm.openExits), countMoney(rn.openExits)],
    ]],
    ['Losses after buying back', [
      ['Holdings that began with a buy-back and ended in an exit below its price', int(lm.count), int(ln.count)],
      ['Their net P/L (after costs and dividends)', sMoney(lm.dollars), sMoney(ln.dollars)],
      ['Their price loss only', sMoney(lm.priceLoss), sMoney(ln.priceLoss)],
    ]],
    ...(m.pooled ? [
      ['Buy-backs below the sale price, apart from fresh entries at or above it', [
        ['Buy-backs (below the previous sale price): holdings · net P/L', `${int(bb?.count)} · ${sMoney(bb?.pnl)}`],
        ['Buy-backs: average change of the buy-back price from the sale price', bb?.avgChangeFromSalePct != null ? pct(bb.avgChangeFromSalePct) : '—'],
        ['Fresh entries (at or above the previous sale price, or never held): holdings · net P/L', `${int(fe?.holdings)} · ${sMoney(fe?.pnl)}`],
        ['Fresh entries after a missed rebound · never held or lapsed', `${int(fe?.afterMissedRebound)} · ${int(fe?.neverHeldOrLapsed)}`],
        ['Average premium of a fresh entry over the previous sale price', fe?.withPreviousExit ? pct(fe.avgPremiumPct) : '—'],
        ['Average sessions out from the sale to a fresh entry after a missed rebound', fe?.avgSessionsToFreshEntry != null ? ratio(fe.avgSessionsToFreshEntry, 0) : '—'],
        ['Missed rebounds (price back at or above the sale price before any buy-back) · stocks retired by policy A', `${int(m.reboundsMissedEvents?.count)} · ${int(m.reboundsMissedEvents?.retired)}`],
        ['Exits at the initial-loss level · exits by the rule', `${int(m.initialLossExits)} · ${int(m.ruleExits)}`],
      ], true],
      ['Position sizing, budgets and the pause', [
        ['Buys: average position · average planned loss', `${money(sz?.avgPositionUsd)} · ${money(sz?.avgPlannedLossUsd)}`],
        ['Which cap bound the size (counts)', sz?.bindingCaps ? Object.entries(sz.bindingCaps).map(([k, v]) => `${k} ${v}`).join(', ') || '—' : '—'],
        ['Signals that lapsed (by reason)', sz?.lapsedSignals ? Object.entries(sz.lapsedSignals).map(([k, v]) => `${k} ${v}`).join(', ') || 'none' : '—'],
        ['Stocks never entered (how long each waited)', (m.neverEnteredWaits || []).length ? m.neverEnteredWaits.map((w) => `${w.symbol}: ${w.sessionsWaited != null ? `waited ${plural(w.sessionsWaited, 'session')}${w.waitingSince ? ` from ${day(w.waitingSince)}` : ''}` : 'no entry rule while never held'}${w.retired ? ' (retired)' : ''}`).join('; ') : (m.neverEntered || []).join(', ') || 'none'],
        ['Open risk: average · maximum', `${money(ex?.avgOpenRiskUsd)} · ${money(ex?.maxOpenRiskUsd)}`],
        ['Tech/AI exposure: average · maximum', `${money(ex?.avgTechAiUsd)} · ${money(ex?.maxTechAiUsd)}`],
        ['Invested fraction (average) · return on average invested capital', `${pctPlain(ex?.investedFractionPct, 1)} · ${pct(ex?.returnOnAvgInvestedPct)}`],
        ['Pauses of new entries: episodes · sessions paused', `${int(pa?.count)} · ${int(pa?.sessions)}`],
        ['Pause episodes (dates · deepest decline from the peak · length)', (pa?.episodes || []).length ? pa.episodes.map((e) => `${day(e.from)} – ${e.to ? day(e.to) : 'still paused at the end'} · ${money(e.deepest)} · ${plural(e.sessions, 'session')}`).join('; ') : 'none'],
      ], true],
    ] : []),
    [`Performance against the benchmark (${benchLabel})`, [
      [`End value, ${hxLabel} − benchmark`, toned(d('endValue'), sMoney(d('endValue')))],
      [`Annualised return, ${hxLabel} − benchmark`, toned(d('annualisedReturnPct'), pts(d('annualisedReturnPct')))],
      ...(cmp?.ratios ? [
        [`Largest decline, ${hxLabel} ÷ benchmark`, ratio(cmp.ratios.maxDrawdown)],
        [`Return ÷ decline, ${hxLabel} ÷ benchmark`, ratio(cmp.ratios.returnToDrawdown)],
      ] : []),
    ], true],
    ['Assumed vs realistically available fills', fills ? [
      ['Fills compared (open-based vs first 15-minute VWAP)', int(fills.hxr?.matched), int(fills.hold?.matched)],
      ['Median difference per fill', bps(fills.hxr?.medianAbsDiffBps), bps(fills.hold?.medianAbsDiffBps)],
      ['Mean difference per fill', bps(fills.hxr?.meanAbsDiffBps), bps(fills.hold?.meanAbsDiffBps)],
      ...(fills.hxr?.basis ? [[`Compared ${fills.hxr.basis}; no VWAP-fill account is run alongside, so no end value is computed for it.`]] : [
        ['End value with VWAP fills', money(fills.hxr?.vw15EndValue), money(fills.hold?.vw15EndValue)],
        ['End value, VWAP − open-based', sMoney(fills.hxr?.endValueDiff), sMoney(fills.hold?.endValueDiff)],
      ]),
      ['Fills without a VWAP (open used)', int(fills.hxr?.fillsWithoutVw15), int(fills.hold?.fillsWithoutVw15)],
    ] : [['Not compared for this run: no first 15-minute VWAP run is stored with it.']], !fills],
    ['Costs and dividends', [
      ['Spread and slippage', money(cm.spreadSlippage), money(cn.spreadSlippage)],
      ['Fees (SEC, FINRA TAF, commission)', money(cm.fees), money(cn.fees)],
      ['Total costs', money(cm.total), money(cn.total), sMoney(diff(cm.total, cn.total))],
      ['Dividends, gross', money(dm.gross), money(dn.gross)],
      ['Withheld', money(dm.withheld), money(dn.withheld)],
      ['Dividends, net (credited)', money(dm.net), money(dn.net), sMoney(diff(dm.net, dn.net))],
      ['Still receivable at the end', money(dm.receivableAtEnd), money(dn.receivableAtEnd)],
    ]],
    ['Data', [
      ['Data warnings (missing bars, waiting orders…)', int(m.warnings), int(n.warnings)],
    ]],
  ];
  const tbody = h('tbody');
  for (const [title, rows, span] of groups) {
    tbody.append(h('tr', { class: 'hxr-group' }, h('th', { colspan: '4', scope: 'colgroup' }, title)));
    for (const [label, ...cells] of rows) {
      if (!cells.length) { tbody.append(h('tr', {}, h('td', { class: 'muted small', colspan: '4' }, label))); continue; }
      // A single value spans the arms (a difference).
      if (span || cells.length === 1) {
        tbody.append(h('tr', {}, h('td', {}, label), h('td', { class: 'num', colspan: '3' }, cells[0])));
        continue;
      }
      tbody.append(h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, cells[0]), h('td', { class: 'num' }, cells[1]), h('td', { class: 'num' }, cells[2] ?? '')));
    }
  }
  return h('div', {},
    h('div', { class: 'table-wrap' }, h('table', { class: 'lab-table hxr-table hxr-metrics' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, `${hxLabel} (simulated)`), h('th', { class: 'num' }, `${benchLabel} (simulated)`), h('th', { class: 'num' }, `${hxLabel} − benchmark`))),
      tbody)),
    h('div', { class: 'small muted' }, 'US dollars, simulated, after costs. Differences are HXR minus the benchmark; "pts" are percentage points. A hold never exits, so its trade and rebound rows are zero.'));
}

function perStockTable(m, n, label) {
  const hold = new Map((n?.perStock || []).map((s) => [s.symbol, s]));
  const rows = (m.perStock || []).map((s) => {
    const x = hold.get(s.symbol) || {};
    const dd = diff(s.pnl, x.pnl);
    return [h('span', { class: 'sym' }, s.symbol), money(s.endValue), toned(s.pnl, sMoney(s.pnl)), toned(x.pnl, sMoney(x.pnl)), toned(dd, sMoney(dd)),
      int(s.roundTrips), pctPlain(s.timeOutPct, 1), money(s.costs?.total), money(s.dividendsNet), fin(s.largestRiseWhileOutPct) ? pct(s.largestRiseWhileOutPct) : '—'];
  });
  return h('details', { class: 'more' }, h('summary', {}, `Per stock (${rows.length}, simulated)`),
    table(['Stock', `${label} end value (simulated)`, `${label} P/L (simulated)`, 'Benchmark P/L (simulated)', 'Difference', 'Round trips', 'Time out', 'Costs (simulated)', 'Dividends, net (simulated)', 'Largest rise while out'], rows, { numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    h('div', { class: 'small muted' }, 'US dollars, simulated. With pooled cash a stock\'s P/L is the P/L of its holdings; its end value is its holding at the last close.'));
}

function criteriaTable(P, ev) {
  if (!ev) return notice('warn', 'The criteria were not recorded with this run.');
  const rules = new Map((P.o.criteria?.criteria || []).map((c) => [c.id, c.rule]));
  const [ol, ok] = OUTCOME[ev.outcome] || [ev.outcome, ''];
  return h('div', {},
    h('h4', { class: 'lab-h4 first' }, 'Pre-registered criteria G1–G6'),
    table(['', 'Criterion', 'Status', 'Result'], (ev.criteria || []).map((c) => {
      const [l, k] = CRIT[c.status] || [c.status, ''];
      return [h('span', { class: 'mono' }, c.id), h('div', {}, h('strong', {}, c.name), h('div', { class: 'cell-sub' }, rules.get(c.id) || '')), badge(l, k),
        h('div', { class: 'small' }, c.note || '', flat(c.value) ? h('div', { class: 'cell-sub' }, valueText(c.value)) : null)];
    }), { cls: 'lab-crit hxr-crit' }),
    h('div', { class: `hxr-outcome ${ok}` },
      h('div', { class: 'row' }, h('strong', {}, 'Outcome'), badge(ol, ok), ev.contaminated ? badge('contaminated', 'danger') : null),
      h('div', {}, ev.meaning || ''),
      h('div', { class: 'small' }, `PASS means: ${ev.passMeaning || P.o.criteria?.passMeaning || '—'}. It never connects anything.`),
      P.o.historicalCaveat ? h('div', { class: 'small' }, P.o.historicalCaveat) : null));
}

function variantsTable(rep) {
  const c = rep?.comparisons;
  if (!c) return null;
  const label = (k) => VARIANT[k] || (k.startsWith('loo-') ? `Without ${k.slice(4)} (G6)` : k);
  // Each entry is HXR against both benchmarks ({ hold, holdDayOne }); older entries are a single comparison.
  const pick = (x) => (x?.hold || x?.holdDayOne ? x : { hold: x });
  const tri = (x, f) => { const p = pick(x); return `${f(p.hold?.[0]?.hxr ?? p.hold?.endValue?.hxr)}`; };
  const cell = (x, key, f) => { const p = pick(x); return `${f(p.hold?.[key]?.hxr ?? p.holdDayOne?.[key]?.hxr)} / ${f(p.hold?.[key]?.hold)} / ${f(p.holdDayOne?.[key]?.hold)}`; };
  void tri;
  return h('div', {},
    h('h4', { class: 'lab-h4 first' }, 'Stress versions, leave-one-out and the full-list check'),
    table(['Run', 'End value HXR / hold / day-one hold', 'Annualised', 'Largest decline', 'Return ÷ decline', 'Round trips'], Object.entries(c).map(([k, x]) => [
      h('span', { class: 'small' }, label(k)),
      cell(x, 'endValue', money), cell(x, 'annualisedReturnPct', pct), cell(x, 'maxDrawdownPct', pctPlain), cell(x, 'returnToDrawdown', ratio),
      int(pick(x).hold?.roundTrips?.hxr),
    ]), { numeric: [1, 2, 3, 4, 5] }),
    h('div', { class: 'small muted' }, 'US dollars, simulated. G5 uses the doubled-cost and two-session-delay runs; G6 the leave-one-out runs; each against both benchmarks. The VWAP-fill, 0%-withholding and full-list runs are reported, not judged. Any run\'s full report is under Trades and decisions.'));
}

// ---------- 7. trades and decisions ----------

function runSection(P) {
  const pickHost = h('div', { class: 'row lab-controls' });
  const host = h('div', {});
  const body = lazy(P.ep, async () => {
    const { runs } = await P.api('GET', '/api/hxr/runs?limit=1000');
    const done = runs.filter((r) => r.status === 'done');
    if (!done.length) return h('div', { class: 'small muted' }, 'No finished run.');
    const preferred = P.evalRuns?.hxr?.run?.id ?? done.find((r) => r.kind === 'selection' && r.version === P.frozen?.basedOn)?.id ?? done[0].id;
    if (!done.some((r) => r.id === S.run)) S.run = preferred;
    const show = () => mount(host, lazy(P.ep, () => runDetail(P, S.run)));
    mount(pickHost, h('span', { class: 'small muted' }, 'Run'),
      h('div', { style: { minWidth: '240px', flex: '1 1 320px', maxWidth: '640px' } },
        selectEl('Run', done.map((r) => [String(r.id), `#${r.id} · ${r.kind} · ${r.label || r.version}${r.contaminated ? ' · contaminated' : ''}`]), String(S.run), (v) => { S.run = Number(v); S.runPage = 0; S.runSymbol = ''; show(); })));
    show();
    return h('div', {}, pickHost, host);
  });
  return sec('run', 'Trades and decisions (simulated runs)', body);
}

async function runDetail(P, id) {
  const d = await getRun(P, id);
  const run = d.run;
  const fillsByDecision = new Map((d.fills || []).filter((f) => f.decisionId).map((f) => [f.decisionId, f]));
  const symbols = [...new Set([...(d.fills || []), ...(d.decisions || [])].map((x) => x.symbol))].sort();
  const tabs = h('div', { class: 'tabs lab-filter', role: 'tablist', 'aria-label': 'Table' });
  const host = h('div', {});
  const symSel = selectEl('Stock', [['', 'All stocks'], ...symbols.map((s) => [s, s])], S.runSymbol, (v) => { S.runSymbol = v; S.runPage = 0; draw(); });
  const draw = () => {
    const list = (S.runTab === 'fills' ? d.fills : d.decisions) || [];
    const items = S.runSymbol ? list.filter((x) => x.symbol === S.runSymbol) : list;
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    S.runPage = Math.min(S.runPage, pages - 1);
    const page = items.slice(S.runPage * PAGE_SIZE, (S.runPage + 1) * PAGE_SIZE);
    mount(tabs, [['decisions', `Decisions (${(d.decisions || []).length})`], ['fills', `Trades (${(d.fills || []).length})`]].map(([k, l]) => h('button', {
      class: `tab ${S.runTab === k ? 'active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(S.runTab === k),
      onclick: () => { S.runTab = k; S.runPage = 0; draw(); },
    }, l)));
    mount(host,
      !items.length ? h('div', { class: 'small muted' }, S.runTab === 'fills' ? 'No trades for this choice.' : 'No decisions for this choice (the hold never decides).')
        : S.runTab === 'fills' ? fillsTable(page) : decisionsTable(page, fillsByDecision),
      items.length > PAGE_SIZE ? pager(items.length, pages, () => draw()) : null);
  };
  draw();
  return h('div', { class: 'stack', style: { gap: '10px' } },
    h('div', { class: 'row small' }, badge(run.kind, 'info'), run.contaminated ? badge('contaminated', 'danger') : null,
      h('span', { class: 'muted' }, `${run.label || ''} · ${run.version} · config ${shortHash(run.configHash)} · data ${shortHash(run.dataHash)} · fill model ${run.fillModel} · delay ${run.delay}`)),
    h('details', { class: 'more' }, h('summary', {}, 'Every report item against its hold (simulated)'), lazy(P.ep, () => pairReport(P, run))),
    h('div', { class: 'row lab-controls' }, tabs, h('div', { style: { width: '150px' } }, symSel)),
    host,
    h('div', { class: 'small muted' }, 'Prices are raw (unadjusted) at the fill; rule numbers are in the sleeve\'s share units on the decision date (split-adjusted only with information available then). Money is simulated US$.'));
}

// The run's hold pair from the same ledger entry: a selection candidate against
// the selection hold, an evaluation arm against the other arm of its variant.
async function pairReport(P, run) {
  const entry = (P.o.ledger || []).find((e) => (e.runIds || []).includes(run.id));
  const det = run.details || {};
  if (!entry) return h('div', { class: 'small muted' }, 'This run is in no selection or evaluation record.');
  const others = await Promise.all(entry.runIds.filter((id) => id !== run.id).map((id) => getRun(P, id)));
  let hx = null, hd = null, fills = null;
  if (det.arm === 'hxr' || det.arm === 'hold') {
    const other = others.find((x) => x.run.details?.variant === det.variant && x.run.details?.arm === (det.arm === 'hxr' ? 'hold' : 'hxr'))?.run;
    [hx, hd] = det.arm === 'hxr' ? [run, other] : [other, run];
    const rep = [run, ...others.map((x) => x.run)].find((r) => r?.details?.reported)?.details?.reported;
    fills = det.variant === 'main' ? rep?.fills : det.variant === 'fullList' ? rep?.fullList?.fills : null;
  } else if (det.role === 'candidate') {
    hx = run;
    hd = others.find((x) => x.run.details?.role === 'hold')?.run;
    fills = hx.details?.fills && hd?.details?.fills ? { hxr: hx.details.fills, hold: hd.details.fills } : null;
  }
  if (!hx || !hd) return h('div', { class: 'small muted' }, det.role === 'hold' ? 'This is the hold itself; each candidate is compared with it.' : det.role === 'fills' ? 'This run only supplies the first 15-minute VWAP fills for its base run\'s comparison.' : 'No hold pair is recorded for this run.');
  return metricsTable(hx.metrics || {}, hd.metrics || {}, { hxLabel: hx.version, fills });
}

function pager(total, pages, redraw) {
  const prev = h('button', { class: 'btn small', type: 'button', disabled: S.runPage <= 0 ? true : null, onclick: () => { S.runPage--; redraw(); } }, 'Previous');
  const next = h('button', { class: 'btn small', type: 'button', disabled: S.runPage >= pages - 1 ? true : null, onclick: () => { S.runPage++; redraw(); } }, 'Next');
  const from = S.runPage * PAGE_SIZE + 1, to = Math.min(total, (S.runPage + 1) * PAGE_SIZE);
  return h('div', { class: 'row mt hxr-pager' }, prev, h('span', { class: 'small muted' }, `${int(from)}–${int(to)} of ${int(total)} · page ${S.runPage + 1} of ${pages}`), next);
}

function numbersUsed(values) {
  return h('div', { class: 'small hxr-values' }, Object.entries(values || {}).map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, `${VALUE_LABEL[k] || k}: `), Number.isInteger(v) ? int(v) : typeof v === 'number' ? px(v) : valueText(v))));
}

const actionBadge = (a) => (a === 'exit' ? badge('Exit to cash', 'warn') : a === 'buy_back' ? badge('Buy back', 'info') : badge(a || '—', ''));
const sideText = (f) => (f.initial ? 'Initial buy' : f.side === 'sell' ? 'Sell (exit)' : 'Buy back');

function decisionsTable(items, fillsByDecision) {
  return table(['Date', 'Stock', 'Decision', 'Why (the rule as the engine recorded it)', 'Numbers used', 'Fill', 'Sleeve then (simulated)'], items.map((x) => {
    const f = fillsByDecision.get(x.id);
    return [
      day(x.date), h('span', { class: 'sym' }, x.symbol), actionBadge(x.action),
      h('span', { class: 'small hxr-why' }, tidy(x.reason)),
      numbersUsed(x.values),
      h('span', { class: 'small' }, `scheduled ${day(x.fillDate)} (${plural(x.delaySessions ?? 1, 'session')} later)`,
        h('div', { class: 'cell-sub' }, f ? `filled ${day(f.date)} at ${px(f.price)}${f.waitedSessions ? ` after waiting ${plural(f.waitedSessions, 'session')}` : ''}` : 'not filled in this run')),
      h('span', { class: 'small' }, `${qty(x.shares)} shares · ${money(x.cash)} cash`),
    ];
  }), { cls: 'hxr-decisions' });
}

function fillsTable(items) {
  return table(['Date', 'Stock', 'Side', 'Shares', 'Raw price', 'Effective price', 'Half-spread + slippage', 'Spread cost · fees (simulated)', 'Value (simulated)', 'Cash after (simulated)', 'Decision'], items.map((f) => [
    day(f.date), h('span', { class: 'sym' }, f.symbol), h('span', {}, sideText(f), (f.flags || []).length ? h('div', {}, (f.flags || []).map((x) => badge(String(x).replace(/_/g, ' '), 'warn'))) : null),
    qty(f.shares), h('span', {}, px(f.rawPrice), h('div', { class: 'cell-sub' }, f.basis === 'vw15' ? 'first 15-min VWAP' : 'open')), px(f.price),
    `${bps(f.halfSpreadBps)} + ${bps(f.slippageBps, 0)}`, `${money(f.spreadSlippage)} · ${money(f.fees?.total)}`, money(f.value), money(f.cashAfter),
    h('span', { class: 'small' }, f.initial ? 'initial allocation' : `${day(f.decisionDate)}${f.waitedSessions ? ` (waited ${plural(f.waitedSessions, 'session')})` : ''}`),
  ]), { numeric: [3, 4, 5, 6, 7, 8, 9], cls: 'hxr-fills' });
}

// ---------- 8. prospective account ----------

function prospectiveSection(P) {
  return sec('prospective', 'Prospective simulated account', lazy(P.ep, () => prospectiveView(P)));
}

async function prospectiveView(P) {
  const s = await P.api('GET', '/api/hxr/prospective');
  if (!s.account) {
    return empty('No prospective account yet', s.note || '', s.canStart ? h('button', { class: 'btn small', type: 'button', onclick: () => scrollToSection('actions') }, 'Go to Actions') : null);
  }
  const a = s.account;
  const hx = s.hxr || {}, hd = s.hold || {};
  const eh = hx.equity, eo = hd.equity;
  const op = s.operational || {};
  const tickOut = h('div', { 'aria-live': 'polite' });
  const processBtn = h('button', { class: 'btn small primary', type: 'button', disabled: a.status !== 'active' ? true : null, title: a.status !== 'active' ? `The account is ${a.status}` : null }, 'Process now');
  processBtn.addEventListener('click', async () => {
    processBtn.disabled = true;
    mount(tickOut, notice('info', h('span', { class: 'spinner lab-inline-spin' }), ' Fetching the completed sessions and news, then processing them (simulated)…'));
    try {
      const r = await P.api('POST', '/api/hxr/prospective/tick', {});
      toast(r.skipped ? r.reason : r.processed?.length ? `Processed ${plural(r.processed.length, 'session')} (simulated)` : 'Nothing new to process');
      P.reload();
    } catch (e) {
      mount(tickOut, notice('danger', e.message));
      processBtn.disabled = false;
    }
  });
  const pauseBtn = a.status === 'active'
    ? h('button', { class: 'btn small', type: 'button', onclick: () => pauseDialog(P) }, 'Pause…')
    : h('button', { class: 'btn small primary', type: 'button', onclick: () => setStatus(P, 'resume').catch((e) => toast(e.message, 'error')) }, 'Resume');
  const out = (eh?.sleevesOut ?? 0);
  return h('div', { class: 'stack' },
    h('div', { class: 'spread' },
      h('div', { class: 'row' }, badge(a.status, a.status === 'active' ? 'ok' : 'warn'), badge('SIMULATED', 'warn'),
        h('span', { class: 'small muted' }, `${a.version} vs ${a.holdVersion || 'hold'} · config ${shortHash(a.configHash)} · started ${when(a.startedAt)} · first session ${day(a.startDate)} · processed through ${day(a.lastProcessed)}`)),
      h('div', { class: 'row' }, processBtn, pauseBtn)),
    tickOut,
    !eh ? notice('info', 'No trading session has been processed yet, so there is no account value. Nothing is estimated.') : null,
    h('div', { class: 'lab-tiles' },
      tile('HXR account value (simulated)', eh ? money(eh.equity) : '—', eh ? `close of ${day(eh.date)}` : 'not processed yet'),
      tile('Hold account value (simulated)', eo ? money(eo.equity) : '—', eo ? `close of ${day(eo.date)}` : 'not processed yet'),
      tile('HXR − hold (simulated)', eh && eo ? toned(s.comparison?.endValue?.diff, sMoney(s.comparison?.endValue?.diff)) : '—', eh && eo ? `HXR return ${pct(s.comparison?.totalReturnPct?.hxr)} · hold ${pct(s.comparison?.totalReturnPct?.hold)}` : null),
      tile('HXR cash (simulated)', eh ? money(eh.cash) : '—', eh ? `${out} of ${a.symbols.length} sleeves out` : null),
      tile('Dividends owed (simulated)', eh ? money(eh.receivable) : '—', eo ? `hold ${money(eo.receivable)}; not in the account value until paid` : null)),
    h('div', { class: 'grid two' },
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'HXR sleeves (simulated)'), sleevesTable(hx.sleeves)),
      h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Hold sleeves (simulated)'), sleevesTable(hd.sleeves))),
    (hx.pendingOrders || []).length ? h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Pending simulated orders (HXR)'),
      table(['Stock', 'Side', 'Reason', 'Decided', 'Fills at the open of', 'Waited'], hx.pendingOrders.map((x) => [h('span', { class: 'sym' }, x.symbol), x.side, x.reason, day(x.decisionDate), day(x.fillDate), int(x.waitedSessions)]))) : null,
    eh ? h('details', { class: 'more' }, h('summary', {}, `Every report item, ${a.version} vs hold (simulated, PREREGISTRATION.md section 11)`),
      metricsTable(hx.metrics || {}, hd.metrics || {}, { hxLabel: a.version, fills: s.fillComparison, cmp: s.comparison })) : null,
    h('h4', { class: 'lab-h4' }, 'Decisions, with the news known when each was recorded'),
    s.newsNote ? notice('warn', h('strong', {}, 'Untrusted third-party text. '), s.newsNote) : null,
    recentList('decisions', s.decisions || [], decisionItem, 'No exit or buy-back decision yet (the hold never decides).'),
    h('h4', { class: 'lab-h4' }, 'Fills (simulated)'),
    recentTable('fills', s.fills || [], prospectiveFills, 'No fills yet.'),
    h('h4', { class: 'lab-h4' }, 'Operational record (P1–P3)'),
    operationalBlock(op),
    lastTickBlock(s.lastTick, s.lastError),
    (s.warnings || []).length ? h('details', { class: 'more' }, h('summary', {}, `Warnings and operational events (${s.warnings.length})`),
      table(['Date', 'Arm', 'Stock', 'Recorded', 'What'], [...s.warnings].reverse().slice(0, 200).map((w) => [day(w.date), w.arm || '—', w.symbol || '—', when(w.recordedAt), h('span', { class: 'small' }, w.detail?.message || w.detail?.code || '')]))) : null);
}

function sleevesTable(list) {
  if (!list?.length) return h('div', { class: 'small muted' }, 'No sleeves.');
  return table(['Stock', 'State', 'Shares', 'Last close', 'Value (simulated)', 'Cash (simulated)', 'Sleeve total (simulated)', 'Dividends owed (simulated)'], list.map((s) => [
    h('span', { class: 'sym' }, s.symbol), badge(s.state === 'in' ? 'in' : 'out (cash)', s.state === 'in' ? 'ok' : 'warn'), qty(s.shares),
    h('span', {}, px(s.lastClose), h('div', { class: 'cell-sub' }, day(s.lastBarDate))), money(s.value), money(s.cash), money(s.equity), money(s.receivable),
  ]), { numeric: [2, 3, 4, 5, 6, 7] });
}

const onTimeBadge = (v) => (v === true ? badge('on time', 'ok') : v === false ? badge('late', 'warn') : badge('not judged', 'muted'));

// Newest first; the most recent RECENT, with the rest behind a button.
function recentList(key, items, render, emptyText) {
  if (!items.length) return h('div', { class: 'small muted' }, emptyText);
  const host = h('div', { class: 'list' });
  const draw = () => {
    const list = [...items].reverse();
    const shown = S.showAll[key] ? list : list.slice(0, RECENT);
    mount(host, shown.map(render), list.length > RECENT ? h('button', { class: 'btn small mt', type: 'button', onclick: () => { S.showAll[key] = !S.showAll[key]; draw(); } }, S.showAll[key] ? 'Show the latest only' : `Show all ${list.length}`) : null);
  };
  draw();
  return host;
}

function recentTable(key, items, render, emptyText) {
  if (!items.length) return h('div', { class: 'small muted' }, emptyText);
  const host = h('div', {});
  const draw = () => {
    const list = [...items].reverse();
    mount(host, render(S.showAll[key] ? list : list.slice(0, RECENT)),
      list.length > RECENT ? h('button', { class: 'btn small mt', type: 'button', onclick: () => { S.showAll[key] = !S.showAll[key]; draw(); } }, S.showAll[key] ? 'Show the latest only' : `Show all ${list.length}`) : null);
  };
  draw();
  return host;
}

function decisionItem(x) {
  const d = x.decision || {};
  const news = x.news;
  return h('div', { class: 'list-item hxr-decision' },
    h('div', { class: 'row' }, actionBadge(d.action), h('span', { class: 'sym' }, x.symbol), h('span', { class: 'small' }, `session ${day(x.date)}`),
      h('span', { class: 'small muted' }, `recorded ${when(x.recordedAt)}`), onTimeBadge(x.onTime), x.arm !== 'hxr' ? badge(x.arm, 'muted') : null),
    h('div', { class: 'small hxr-why' }, tidy(d.reason)),
    h('details', { class: 'more' }, h('summary', {}, 'Numbers used'), numbersUsed(d.values),
      h('div', { class: 'small muted' }, `Order fills at the open of ${day(d.fillDate)}. Sleeve then: ${qty(d.shares)} shares, ${money(d.cash)} cash (simulated).`)),
    newsBlock(news));
}

// Third-party headlines: plain text only, with their source and times.
function newsBlock(news) {
  if (!news) return h('div', { class: 'small muted' }, 'No news record linked.');
  const items = news.items || [];
  return h('div', { class: 'hxr-news' },
    h('div', { class: 'small muted' }, `News known when recorded: first seen by ${when(news.window?.firstSeenBy)}, created ${when(news.window?.createdFrom)} – ${when(news.window?.createdTo)}. ${items.length ? '' : 'None.'}`),
    items.map((n) => h('div', { class: 'hxr-news-item' },
      h('div', { class: 'news-title small' }, n.headline || '(no headline)'),
      h('div', { class: 'cell-sub' }, `${n.source || 'unknown source'} · created ${when(n.created_at)} · first seen ${when(n.first_seen_at)}`, n.backfilled ? [' ', badge('backfilled', 'muted')] : null,
        n.url ? [' · ', extLink(n.url, 'source page')] : null))));
}

function prospectiveFills(list) {
  return table(['Arm', 'Session', 'Stock', 'Side', 'Shares', 'Assumed price', 'Realistic price (VWAP ± half-spread)', 'Difference', 'Recorded', ''], list.map((x) => {
    const f = x.fill || {};
    return [x.arm === 'hxr' ? 'HXR' : 'Hold', day(x.date), h('span', { class: 'sym' }, x.symbol), sideText(f), qty(f.shares), px(f.price), px(f.realistic?.price), bps(f.realistic?.diffBps),
      h('span', { class: 'small' }, when(x.recordedAt)), onTimeBadge(x.onTime)];
  }), { numeric: [4, 5, 6, 7] });
}

function operationalBlock(op) {
  const met = (v) => (v === true ? badge('met so far', 'ok') : v === false ? badge('not met yet', 'warn') : badge('not evaluable yet', 'muted'));
  const p1 = op.P1 || {}, p2 = op.P2 || {}, p3 = op.P3 || {};
  return h('div', { class: 'stack', style: { gap: '6px' } },
    h('dl', { class: 'kv small lab-kv' },
      h('dt', {}, 'P1 Enough time and decisions'), h('dd', {}, `${ratio(p1.months, 1)} of ${p1.minMonths ?? '—'} months; ${int(p1.decisions)} of ${int(p1.minDecisions)} exit or buy-back decisions `, met(p1.met)),
      h('dt', {}, 'P2 Operationally clean'), h('dd', {}, `${int(p2.onTime)} of ${int(p2.sessions)} sessions processed on time (${pctPlain(p2.onTimePct, 1)}; at least ${p2.minOnTimePct ?? '—'}% needed); ${int(p2.duplicateOrders)} duplicate orders; ${int(p2.fillsWithoutBar)} fills without a bar `, met(p2.met)),
      h('dt', {}, 'P3 Fill realism'), h('dd', {}, `${int(p3.fillsCompared)} HXR fills compared; median difference ${bps(p3.medianAbsDiffBps)} (at most ${p3.maxMedianBps ?? '—'} bps) `, met(p3.met)),
      h('dt', {}, 'P4 Consistent with history'), h('dd', {}, op.P4?.note || op.P4?.rule || '—')),
    p4Table(op.P4),
    h('div', { class: 'small muted' }, op.note || 'Prospective criteria are judged later and separately; nothing here is permission to trade.'));
}

// P4: prospective HXR minus hold next to the clean evaluation's, never a pass or a fail.
function p4Table(p4) {
  if (!p4?.prospective) return null;
  const x = p4.prospective, y = p4.historical;
  const row = (label, k, f, ptsFmt) => [label, `${f(x[k]?.hxr)} / ${f(x[k]?.hold)}`, ptsFmt(x[k]?.diff), y ? `${f(y[k]?.hxr)} / ${f(y[k]?.hold)}` : '—', y ? ptsFmt(y[k]?.diff) : '—'];
  return h('div', {},
    table(['', 'Prospective HXR / hold', 'HXR − hold', 'Evaluation HXR / hold', 'HXR − hold'], [
      row('Annualised return', 'annualisedReturnPct', pct, pts),
      row('Largest decline', 'maxDrawdownPct', (v) => pctPlain(v), pts),
      row('Annualised return ÷ largest decline', 'returnToDrawdown', (v) => ratio(v), (v) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}` : '—')),
    ], { numeric: [1, 2, 3, 4], cls: 'hxr-p4' }),
    h('div', { class: 'small muted' }, `Prospective: ${int(x.sessions)} sessions${x.firstDate ? ` (${day(x.firstDate)} – ${day(x.lastDate)})` : ''}; annualised figures over a short record swing widely. `,
      y ? `Evaluation: the clean run of ${day(y.period?.start)} – ${day(y.period?.end)} (runs #${y.runIds?.hxr} and #${y.runIds?.hold}), basket ${y.basket || 'A'}; the prospective basket differs.` : 'No clean evaluation of this version is recorded, so there is no historical result to set beside it.'));
}

function lastTickBlock(t, lastError) {
  if (!t && !lastError) return h('div', { class: 'small muted' }, 'Not processed yet.');
  return h('div', { class: 'lab-panel' },
    h('h4', { class: 'lab-h4 first' }, 'Last update'),
    t ? h('dl', { class: 'kv small lab-kv' },
      h('dt', {}, 'Started'), h('dd', {}, when(t.at)),
      t.recordedAt ? [h('dt', {}, 'Stored at'), h('dd', {}, `${when(t.recordedAt)} (on time means stored before the next session's open)`)] : null,
      h('dt', {}, 'Sessions processed'), h('dd', {}, t.processed?.length ? t.processed.map(day).join(', ') : 'none'),
      t.skipped && t.reason ? [h('dt', {}, 'Not stored'), h('dd', {}, `${t.reason}${t.discarded?.length ? ` (${t.discarded.map(day).join(', ')})` : ''}`)] : null,
      t.waiting ? [h('dt', {}, 'Waiting'), h('dd', {}, `${day(t.waiting.session)}: no bar yet for ${(t.waiting.missing || []).join(', ')}${t.waiting.until ? `; processed with what is there after ${when(t.waiting.until)}` : `; ${t.waiting.reason || 'waits for its data'}`}`)] : null,
      t.news ? [h('dt', {}, 'News'), h('dd', {}, `${int(t.news.fetched)} fetched, ${int(t.news.inserted)} new`)] : null,
      t.events ? [h('dt', {}, 'Events stored'), h('dd', {}, `${int(t.events.inserted)} new, ${int(t.events.duplicates)} already recorded`)] : null) : null,
    (t?.errors || []).length ? notice('danger', h('ul', {}, t.errors.map((e) => h('li', {}, e)))) : null,
    lastError ? notice('danger', `Last processing error (${when(lastError.at)}): ${lastError.message}`) : null);
}

function pauseDialog(P) {
  const body = h('div', { class: 'stack', style: { gap: '10px' } },
    notice('warn', 'While paused, no session is processed. Sessions processed after the next session\'s open are recorded as late, which counts against P2 (operationally clean).'),
    h('div', { class: 'small' }, 'Resume at any time; the next update processes every completed session since the last one. Nothing is sent anywhere either way.'));
  confirmDialog('Pause the prospective account?', body, { confirmLabel: 'Pause', onConfirm: () => setStatus(P, 'pause') });
}

async function setStatus(P, what) {
  const r = await P.api('POST', `/api/hxr/prospective/${what}`, {});
  toast(r.note || (what === 'pause' ? 'Paused' : 'Resumed'));
  P.reload();
}

// ---------- 9. experiment log ----------

function logSection(P) {
  const { o } = P;
  const exps = o.experiments || [];
  const ledger = o.ledger || [];
  const file = o.experimentLogFile;
  return sec('log', 'Experiment log',
    file ? h('div', {},
      h('h4', { class: 'lab-h4 first' }, `strategy/hxr/${file.file} (read-only${file.sha256 ? `, sha256 ${shortHash(file.sha256)}` : ''})`),
      h('p', { class: 'small muted' }, 'Kept by hand in the repository. It includes the data touched before this code existed (the step 1 and step 2 checks and the pre-registration), which the table further down cannot show.'),
      file.error ? notice('warn', file.error)
        : file.rows?.length ? table(file.header, file.rows.map((r) => r.map((c) => h('span', { class: 'small' }, c))), { cls: 'hxr-log' }) : h('div', { class: 'small muted' }, 'No entries.')) : null,
    h('h4', { class: 'lab-h4' }, 'Recorded on this machine'),
    h('p', { class: 'small muted' }, 'Append-only: every download, decision, run and freeze, with the data it touched and whether results were seen. Mirrored by hand in strategy/hxr/EXPERIMENT-LOG.md.'),
    exps.length ? table(['#', 'When', 'What', 'Version', 'Data touched', 'Results seen', 'Note'], [...exps].reverse().map((e) => [
      int(e.id), h('span', { class: 'small' }, when(e.at)), h('strong', { class: 'small' }, e.what), h('span', { class: 'small' }, e.version || '—'),
      h('span', { class: 'small' }, e.dataTouched || '—'), h('span', { class: 'small' }, e.resultsSeen || '—'), h('span', { class: 'small' }, e.note || '—'),
    ]), { cls: 'hxr-log' }) : h('div', { class: 'small muted' }, 'Nothing logged yet.'),
    h('h4', { class: 'lab-h4' }, 'Selection and evaluation ledger'),
    ledger.length ? table(['When', 'Kind', 'Pre-registration', 'Version', 'Config', 'Runs', 'Status', 'Reason'], ledger.map((e) => [
      h('span', { class: 'small' }, when(e.at)), e.kind, e.prereg, h('span', { class: 'small' }, e.version), h('span', { class: 'mono small', title: e.configHash }, shortHash(e.configHash)),
      h('span', { class: 'small' }, e.runIds?.length ? `${plural(e.runIds.length, 'run')} (#${e.runIds[0]}–#${e.runIds[e.runIds.length - 1]})` : '—'),
      e.contaminated ? badge('contaminated', 'danger') : badge('clean', 'ok'), h('span', { class: 'small' }, e.reason || '—'),
    ]), { cls: 'hxr-ledger' }) : h('div', { class: 'small muted' }, 'No selection or evaluation has been run.'));
}
