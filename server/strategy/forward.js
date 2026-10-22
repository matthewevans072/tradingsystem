// Simulated forward test (strategy/LAB-ARCHITECTURE.md). Off until the owner
// switches it on for a mode; switching on freezes the strategy version and
// config hash for that forward run. Every new completed 15-minute bar time is
// fed, in order, to the engine restored from its saved snapshot, and the
// snapshot is saved with that bar's journal in one transaction, so no bar time
// is processed twice and past decisions never change. A hypothetical account
// only: nothing here reads the real portfolio or places any order.
import { createEngine } from './engine.js';
import { configHash as hashConfig } from './config.js';
import { normalizeBars } from './data.js';
import { barInfo, sessionBounds, localDate, etClock, tradingDays } from './sessions.js';
import { previousTradingDay } from '../calendar.js';
import { addDays } from '../time.js';
import * as store from './store.js';

const MIN = 60000;
const BAR = 15 * MIN;
export const DEFAULT_MAX_SIGNAL_DELAY_MIN = 5;
export const TIME_EXITS = ['flatten', 'max_hold', 'session_end_fallback'];
const WARMUP_DAYS = 7; // calendar days of history fetched before the start for indicators
const SETTLE_MS = 20000; // a bar is fetched 20 s after its close at the earliest
const RETRY_MS = 2 * MIN;
const MAX_TRIES = 2;
const MAX_CATCH_UP_DAYS = 30;

const toMs = (t) => (typeof t === 'number' ? t : t instanceof Date ? t.getTime() : Date.parse(t));
const iso = (ms) => new Date(ms).toISOString();
const symOf = (s) => (typeof s === 'string' ? s : s.symbol);
const exOf = (s) => (typeof s === 'string' ? 'NYSE' : s.exchange || 'NYSE');

// Start of the latest 15-minute bar that had closed by `now` (exchange calendar).
export function latestCompletedBar(now, exchange = 'NYSE') {
  const ms = toMs(now);
  let date = localDate(ms, exchange);
  for (let i = 0; i < 20; i++) {
    const s = sessionBounds(date, exchange);
    if (s && ms >= s.openMs + BAR) return s.openMs + (Math.floor((Math.min(ms, s.closeMs) - s.openMs) / BAR) - 1) * BAR;
    date = previousTradingDay(date, exchange);
  }
  return null;
}

// The pure core. bars: Map|object symbol -> bars (may include bars already
// processed; they are skipped). now: the processing clock, a Date/ms or a
// function of the bar start. onStep(step) persists each bar time; if it
// throws, processing stops and that bar time is processed again next time.
export function advanceForward({ config, mode, symbols, state = null, tradeFrom = null, bars, now, maxSignalDelayMin = DEFAULT_MAX_SIGNAL_DELAY_MIN, onStep = null }) {
  const engine = createEngine({ config, mode, symbols, state, tradeFrom });
  const done = engine.lastProcessed ? Date.parse(engine.lastProcessed) : -Infinity;
  const clock = typeof now === 'function' ? now : () => toMs(now);
  const list = symbols.map(symOf);
  const exchange = new Map(symbols.map((s) => [symOf(s), exOf(s)]));
  const byTime = new Map();
  for (const [sym, rows] of bars instanceof Map ? bars : Object.entries(bars || {})) {
    for (const b of rows || []) {
      const ms = toMs(b.t);
      if (!(ms > done)) continue;
      if (!byTime.has(ms)) byTime.set(ms, new Map());
      byTime.get(ms).set(sym, b);
    }
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const steps = [];
  let lateNoted = false;
  for (const T of times) {
    const procMs = clock(T);
    if (T + BAR > procMs) break; // never decide on an unfinished bar
    const map = byTime.get(T);
    const events = [], closedTrades = [];
    const add = (r) => { events.push(...r.events); closedTrades.push(...r.closedTrades); };
    add(engine.processTimestamp(T, map));
    const lateMin = (procMs - (T + BAR)) / MIN;
    const late = lateMin > maxSignalDelayMin;
    for (const sym of list) {
      if (!map.has(sym) && barInfo(T, exchange.get(sym)).inSession) {
        add(engine.journal({ type: 'data_warning', symbol: sym, reason: `no ${etClock(T)} ET bar for ${sym} from the data source; treated as missing`, details: { code: 'missing_bar', t: iso(T) }, at: T }));
      }
    }
    if (late) {
      if (!lateNoted) {
        const n = times.filter((x) => x >= T && x + BAR <= procMs).length;
        const r = engine.journal({
          type: 'data_warning', reason: `${n} bar time${n === 1 ? '' : 's'} processed late, the first ${Math.round(lateMin)} minutes after its close (the app was closed, asleep or offline, or the data arrived late). Signals from late bars expire; resting stops and targets still apply.`,
          details: { code: 'late_bars', bars: n, firstBar: iso(T), lateMinutes: Math.round(lateMin) }, at: T,
        });
        if (r.events.length) lateNoted = true;
        add(r);
      }
      // A live system could not have acted on these in time.
      for (const e of events.filter((x) => x.type === 'order_placed')) {
        add(engine.cancelOrder(e.symbol, {
          code: 'expired', at: T,
          reason: `expired: the signal bar was processed ${Math.round(lateMin)} minutes after its close (limit ${maxSignalDelayMin}); a live system could not have acted on it in time, so the simulated order was cancelled`,
        }));
      }
      for (const tr of closedTrades.filter((x) => TIME_EXITS.includes(x.exit?.reason))) {
        add(engine.journal({ type: 'data_warning', symbol: tr.symbol, reason: `the ${tr.exit.reason.replace(/_/g, ' ')} time exit was simulated while the app was not running; a live system would need a broker-side order for it`, details: { code: 'time_exit_while_asleep', tradeId: tr.id }, at: T }));
      }
    }
    const eq = engine.equityCurve;
    const point = eq.length && eq[eq.length - 1].t === iso(T) ? eq[eq.length - 1] : null;
    const step = { t: iso(T), processedAt: iso(procMs), lateMinutes: lateMin, events, closedTrades, equity: point, state: engine.snapshot() };
    if (onStep) onStep(step);
    steps.push({ t: step.t, lateMinutes: lateMin, events: events.length, closedTrades: closedTrades.length });
  }
  return { engine, steps, processedThrough: engine.lastProcessed };
}

// ---------- persistence ----------

function persistStep(db, mode, runId, step) {
  store.tx(db, () => {
    store.insertEvents(db, runId, 'forward', step.events);
    const ins = store.insertTrades(db, runId, step.closedTrades);
    if (ins.duplicates) {
      store.insertEvents(db, runId, 'forward', [{ at: step.t, type: 'operational_error', reason: `${ins.duplicates} trade${ins.duplicates === 1 ? ' was' : 's were'} already recorded and not stored again`, details: { code: 'duplicate_trade', count: ins.duplicates } }]);
    }
    if (step.equity) store.insertEquity(db, runId, [step.equity]);
    const r = db.prepare("UPDATE lab_forward SET processed_through = ?, state_json = ? WHERE mode = ? AND run_id = ? AND status IN ('running', 'replay')")
      .run(step.t, JSON.stringify(step.state), mode, runId);
    if (!r.changes) throw new Error('The forward run was stopped or replaced while it was processing');
  });
}

// Switching on freezes the version and config hash in a new forward run; the
// forward trade count starts again with every new run.
export function startForward(db, { mode, config, symbols, now, synthetic = false, label = null, status = 'running', maxSignalDelayMin = DEFAULT_MAX_SIGNAL_DELAY_MIN }) {
  const hash = hashConfig(config);
  const runId = store.createRun(db, {
    kind: 'forward', mode, split: 'forward', version: config.version, configHash: hash, config, symbols, from: localDate(toMs(now)),
    synthetic, status: 'running', label, options: { maxSignalDelayMin }, createdAt: iso(toMs(now)),
  });
  store.saveForward(db, mode, { runId, version: config.version, configHash: hash, startedAt: iso(toMs(now)), status, processedThrough: null, state: null });
  return runId;
}

export function stopForward(db, mode, now, { status = 'stopped', error = null } = {}) {
  const f = store.getForward(db, mode);
  if (!f) return null;
  store.tx(db, () => {
    store.saveForward(db, mode, { ...f, status, stoppedAt: iso(toMs(now)), lastError: error ?? f.lastError });
    if (f.runId) store.updateRun(db, f.runId, { status: 'done', finishedAt: iso(toMs(now)), to: localDate(toMs(now)), error: error ?? undefined });
  });
  return store.getForward(db, mode);
}

// Synthetic replay for the demo workspace: each bar is processed one minute
// after its close, so nothing expires. Flagged synthetic everywhere.
export function replayForward(db, { mode, config, symbols, bars, from, label, maxSignalDelayMin = DEFAULT_MAX_SIGNAL_DELAY_MIN }) {
  const fromMs = toMs(from);
  const runId = startForward(db, { mode, config, symbols, now: fromMs, synthetic: true, label, status: 'replay', maxSignalDelayMin });
  const r = advanceForward({
    config, mode, symbols, tradeFrom: fromMs, bars, now: (T) => T + BAR + MIN, maxSignalDelayMin,
    onStep: (step) => persistStep(db, mode, runId, step),
  });
  store.updateRun(db, runId, { status: 'done', finishedAt: r.processedThrough, to: r.processedThrough ? localDate(Date.parse(r.processedThrough)) : null });
  return { runId, processedThrough: r.processedThrough, steps: r.steps.length };
}

// ---------- the live tick ----------

const instOf = (s) => ({ symbol: symOf(s), exchange: exOf(s), currency: 'USD', provider_symbol: null, identity_status: 'confirmed' });

async function fetchSince(provider, s, sinceMs, nowMs) {
  const toDate = localDate(nowMs, exOf(s));
  let fromDate = localDate(sinceMs, exOf(s));
  if (fromDate < addDays(toDate, -MAX_CATCH_UP_DAYS)) fromDate = addDays(toDate, -MAX_CATCH_UP_DAYS);
  if (fromDate < toDate && typeof provider.getIntradayRange === 'function') return provider.getIntradayRange(instOf(s), fromDate, toDate, '15min');
  const out = [];
  for (const d of tradingDays(fromDate, toDate, exOf(s))) out.push(...await provider.getIntradayBars(instOf(s), d, '15min'));
  return out;
}

function journalNow(db, runId, nowMs, items) {
  if (items.length) store.insertEvents(db, runId, 'forward', items.map((x) => ({ at: iso(nowMs), ...x })));
}

// One scheduler tick for one mode. memo (kept by the caller between ticks)
// throttles retries and repeated error entries. clock, when given, is read
// as each bar is processed: fetching can take minutes, and lateness is judged
// at processing time.
export async function forwardTick({ db, mode, provider, now = new Date(), clock = null, maxSignalDelayMin = DEFAULT_MAX_SIGNAL_DELAY_MIN, shouldPause = () => false, memo = new Map(), configFor = null }) {
  const f = store.getForward(db, mode);
  if (!f || f.status !== 'running') return { mode, skipped: 'not running' };
  const nowMs = toMs(now);
  const run = store.getRun(db, f.runId);
  const config = run.config;
  const symbols = run.symbols;
  // Rules are frozen: the stored config must still be the one the run started with.
  if (hashConfig(config) !== f.configHash) {
    stopForward(db, mode, nowMs, { status: 'error', error: 'The stored strategy config no longer matches the frozen config hash' });
    return { mode, error: 'config changed' };
  }
  const onDisk = configFor ? configFor(f.version) : null;
  if (onDisk && hashConfig(onDisk) !== f.configHash && !run.options?.ruleChanged) {
    store.updateRun(db, f.runId, { options: { ...run.options, ruleChanged: true } });
    journalNow(db, f.runId, nowMs, [{ type: 'operational_error', reason: `the config file for version ${f.version} changed after the forward test started; this run keeps the frozen rules, and a changed rule needs a new version and a new forward run`, details: { code: 'rule_changed' } }]);
  }
  const target = latestCompletedBar(nowMs - SETTLE_MS, exOf(symbols[0] || 'NYSE'));
  const processed = f.processedThrough ? Date.parse(f.processedThrough) : null;
  if (target == null || (processed != null && processed >= target)) return { mode, upToDate: true };
  const startMs = Date.parse(f.startedAt);
  const errors = [];
  let fetched = 0, paused = false;
  if (!provider) {
    const k = `noprovider|${target}`;
    if (!memo.has(k)) {
      memo.set(k, nowMs);
      journalNow(db, f.runId, nowMs, [{ type: 'operational_error', reason: 'no market-data provider is configured, so no new bars could be fetched', details: { code: 'no_provider' } }]);
    }
    return { mode, error: 'no provider' };
  }
  for (const s of symbols) {
    const sym = symOf(s);
    const last = store.lastBarTime(db, sym);
    const lastMs = last ? Date.parse(last) : null;
    if (lastMs != null && lastMs >= target) continue;
    // At most two requests per symbol per bar (provider credits are limited);
    // a bar that is still missing then waits for the next bar's round.
    const m = memo.get(sym);
    if (m && m.target === target && (m.tries >= MAX_TRIES || nowMs - m.at < RETRY_MS)) continue;
    if (shouldPause()) { paused = true; break; }
    memo.set(sym, { target, at: nowMs, tries: m && m.target === target ? m.tries + 1 : 1 });
    try {
      const since = Math.max(lastMs != null ? lastMs : -Infinity, processed ?? -Infinity, startMs - WARMUP_DAYS * 86400000);
      const raw = await fetchSince(provider, s, since, nowMs);
      const norm = normalizeBars(raw.map((b) => ({ t: b.ts ?? b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })), { exchange: exOf(s), intervalMinutes: 15, inputIntervalMinutes: 15 }).bars
        .filter((b) => Date.parse(b.t) + BAR <= nowMs);
      // Bars at or before the processed time are never added: the engine has moved past them.
      const fresh = norm.filter((b) => processed == null || Date.parse(b.t) > processed);
      const lateOnes = processed == null ? [] : norm.filter((b) => Date.parse(b.t) <= processed && Date.parse(b.t) >= startMs && !store.getBars(db, sym, { from: b.t, to: b.t }).length);
      if (fresh.length) fetched += store.upsertBars(db, sym, fresh, { source: provider.id || 'provider' }).inserted;
      if (lateOnes.length) {
        journalNow(db, f.runId, nowMs, [{ type: 'data_warning', symbol: sym, reason: `${lateOnes.length} bar${lateOnes.length === 1 ? '' : 's'} for ${sym} arrived after ${lateOnes.length === 1 ? 'its time was' : 'their times were'} processed and ${lateOnes.length === 1 ? 'was' : 'were'} ignored`, details: { code: 'late_bar', bars: lateOnes.map((b) => b.t).slice(0, 20) } }]);
      }
    } catch (e) {
      errors.push({ symbol: sym, kind: e.kind || 'error', message: e.message });
      if (e.kind === 'auth' || e.kind === 'rate_limit') break;
    }
  }
  const noted = errors.filter((e) => {
    const k = `err|${e.symbol}|${e.message}`;
    if (memo.has(k) && nowMs - memo.get(k) < BAR) return false;
    memo.set(k, nowMs);
    return true;
  });
  journalNow(db, f.runId, nowMs, noted.map((e) => ({ type: 'operational_error', symbol: e.symbol, reason: `data provider error for ${e.symbol}: ${e.message}`, details: { code: 'provider_error', kind: e.kind } })));
  if (paused) return { mode, paused: true, fetched, errors };
  // The owner may have switched the test off while the provider answered.
  const stillRunning = () => { const cur = store.getForward(db, mode); return cur?.status === 'running' && cur.runId === f.runId; };
  if (!stillRunning()) return { mode, skipped: 'stopped', fetched, errors };
  const fromIso = processed != null ? iso(processed + 1) : iso(startMs - WARMUP_DAYS * 86400000);
  const bars = store.barsBySymbol(db, symbols.map(symOf), { from: fromIso, to: iso(target) });
  let steps = [];
  try {
    const r = advanceForward({
      config, mode, symbols, state: f.state, tradeFrom: f.startedAt, bars, now: clock ? () => Math.max(nowMs, toMs(clock())) : nowMs, maxSignalDelayMin,
      onStep: (step) => persistStep(db, mode, f.runId, step),
    });
    steps = r.steps;
    if (f.lastError) store.saveForward(db, mode, { ...store.getForward(db, mode), lastError: null });
  } catch (e) {
    if (!stillRunning()) return { mode, skipped: 'stopped', fetched, errors };
    const cur = store.getForward(db, mode);
    store.saveForward(db, mode, { ...cur, lastError: e.message });
    journalNow(db, f.runId, nowMs, [{ type: 'operational_error', reason: `processing stopped: ${e.message}`, details: { code: 'processing_error' } }]);
    return { mode, error: e.message, fetched, errors };
  }
  return { mode, fetched, errors, processed: steps.length, processedThrough: store.getForward(db, mode)?.processedThrough ?? null };
}

// ---------- reading ----------

export function forwardAccount(db, mode) {
  const f = store.getForward(db, mode);
  if (!f?.runId) return null;
  const run = store.getRun(db, f.runId);
  const engine = createEngine({ config: run.config, mode, symbols: run.symbols, state: f.state, tradeFrom: f.startedAt });
  return { forward: f, run, account: engine.account(), activeSetups: engine.activeSetups(), summary: engine.summary() };
}

// The shape validation.evaluateAcceptance expects for F1-F4.
export function forwardResults(db, mode, { now = new Date() } = {}) {
  const f = store.getForward(db, mode);
  if (!f?.runId) return null;
  const run = store.getRun(db, f.runId, { full: false });
  const id = f.runId;
  const stale = store.countEvents(db, id, 'entry_skipped', 'expired') + store.countEvents(db, id, 'entry_skipped', 'no_next_bar') + store.countEvents(db, id, 'operational_error', 'processing_error');
  return {
    runId: id, trades: store.runTrades(db, id), startedAt: f.startedAt, asOf: f.processedThrough || iso(toMs(now)),
    signals: { total: store.countEvents(db, id, 'signal'), staleOrError: stale },
    duplicates: store.countEvents(db, id, 'operational_error', 'duplicate_trade'),
    ruleChanged: !!run.options?.ruleChanged, synthetic: run.synthetic,
  };
}
