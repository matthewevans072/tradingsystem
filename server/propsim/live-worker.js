// The live account's service and worker (LIVE-1.md sections 4 to 8; the news-forward pattern). One step: finalize every
// earlier session that has no report (record its remaining 5-minute buckets, fetch its complete bars as reference for
// later levels, write its report), then, during today's session, ask Alpaca's IEX feed for the bars since the last one
// and record every 5-minute bucket that is due, each with its decision, before anything later is read. The worker
// repeats the step a few seconds after every minute; the database is its checkpoint, so a restart resumes from the
// stored rows and a missed period stays a gap. It never places or prepares an order and has no account, broker or
// login code. Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by
// Lucid.
import { isTradingDay, nextTradingDay } from '../calendar.js';
import { tradingDays } from '../strategy/sessions.js';
import { zonedParts, NY } from '../time.js';
import * as store from './live-store.js';
import { sessionMarket, observation, runLiveSession, chartMarks, liveAccount, dayDetail, bounds, bucketCount, bucketEnd, windowFrom } from './live.js';
import { LIVE_CODE_REVISION, LIVE_ENGINE, RUNNING, STALE_HEARTBEAT_MS, LIVE_PREREG, LIVE_COMMITTED_PATHS, liveSetup, liveFileHashes } from './live-config.js';
import { LABEL, STAND_IN, PREREG, MATRIX_PATH, RULES_PATH, PsError, textSha256, headCommit, isAncestor, uncommitted } from './config.js';
import fs from 'node:fs';

const MIN = 60000;
const etDate = (ms) => zonedParts(new Date(ms), NY).date;
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

export function createLive({ db, source = null, cfg, matrix, clock = () => new Date(), checks = true, log = () => {} }) {
  const S = liveSetup(cfg, matrix);
  const T = S.timing;
  const now = () => clock().getTime();
  const activation = () => store.getMeta(db, 'activation');
  const reportsMap = () => new Map(store.sessionReports(db).map((r) => [r.session, r]));

  // ---------- the pins (LIVE-1.md section 8) ----------
  function pinProblems() {
    if (!checks) return [];
    const out = [];
    const h = liveFileHashes();
    if (!LIVE_PREREG.commit) out.push('the live document is not pinned yet (LIVE_PREREG.commit is empty)');
    else {
      if (!isAncestor(LIVE_PREREG.commit)) out.push(`the live document commit ${LIVE_PREREG.commit.slice(0, 7)} is not an ancestor of HEAD`);
      for (const [f, want] of Object.entries(LIVE_PREREG.sha256)) if (h[f] !== want) out.push(`${f} differs from its pin`);
    }
    if (textSha256(fs.readFileSync(MATRIX_PATH, 'utf8')) !== PREREG.sha256['matrix-1.json']) out.push('matrix-1.json differs from its pin');
    if (textSha256(fs.readFileSync(RULES_PATH, 'utf8')) !== PREREG.sha256['LUCID-RULES-2026-11-09.json']) out.push('the rules file differs from its pin');
    const dirty = uncommitted(LIVE_COMMITTED_PATHS);
    if (dirty.length) out.push(`uncommitted changes: ${dirty.slice(0, 5).join(', ')}`);
    return out;
  }
  // The full check spawns git; a step runs it at most every 10 minutes.
  let pinCache = { at: -Infinity, problems: [] };
  const pinProblemsCached = () => { if (now() - pinCache.at > 600000) pinCache = { at: now(), problems: pinProblems() }; return pinCache.problems; };
  function activate() {
    if (activation()) throw new PsError(409, 'the live account is already activated');
    const p = pinProblems();
    if (p.length) throw new PsError(409, `not activated: ${p.join('; ')}`);
    const nowMs = now();
    let start = nextTradingDay(etDate(nowMs));
    while (start < cfg.dataFrom) start = nextTradingDay(start);
    const rec = {
      at: iso(nowMs), startSession: start, codeRevision: LIVE_CODE_REVISION, engine: LIVE_ENGINE, head: checks ? headCommit() : null,
      traded: cfg.traded, shown: cfg.shown, plan: S.plan.plan, feed: cfg.feed.feed, symbol: S.symbol, files: checks ? liveFileHashes() : null,
      documentCommit: LIVE_PREREG.commit, label: LABEL, running: RUNNING,
    };
    store.setMeta(db, 'activation', rec, rec.at);
    store.logLine(db, rec.at, 'info', `activated: start session ${start}`);
    return rec;
  }

  // ---------- one session as recorded ----------
  // The engine's view at nowMs (bars and polls up to it; records in `records` or every stored one).
  function compute(date, nowMs, { records = null, bars = null } = {}) {
    const b = bounds(date);
    const rows = (bars ?? store.barsBetween(db, S.symbol, windowFrom(date), date)).filter((r) => r.fetchedMs <= nowMs);
    const s = sessionMarket(rows, date, S);
    const obs = observation({ open: b.open, close: b.close, polls: store.okPolls(db, date).filter((p) => p <= nowMs), nowMs, graceMs: T.graceMs });
    const recs = records ?? new Map(store.bucketsFor(db, date).filter((r) => r.recordedMs <= nowMs).map((r) => [r.k, { recordedMs: r.recordedMs, status: r.status }]));
    if (!s) return { date, b, s: null, obs, recs, traded: { decisions: [], trades: [], pending: null }, shown: {} };
    const ctx = { s, matrix, records: recs, nowMs, gapMs: obs.gapMs, graceMs: T.graceMs };
    const traded = runLiveSession({ ...ctx, family: S.traded.family });
    const shown = Object.fromEntries(S.shown.map((c) => [c.id, runLiveSession({ ...ctx, family: c.family, act: false })]));
    return { date, b, s, obs, recs, traded, shown };
  }
  function evaluationAt(c, k) {
    const bar = c.s?.m5.find((x) => x.k === k);
    return {
      bar: bar ? { o: bar.o, h: bar.h, l: bar.l, c: bar.c, atr: Math.round(bar.atr * 1e6) / 1e6 } : null,
      traded: c.traded.decisions.filter((x) => x.bucket === k),
      shown: Object.fromEntries(Object.entries(c.shown).map(([id, r]) => [id, r.decisions.filter((x) => x.bucket === k)])),
    };
  }
  // Record every due bucket of `date` in order (LIVE-1.md section 4): all its minutes judged, and its last minute's bar
  // in (or a later bar, or the 45-second wait over, or a gap). Status: gap, late or on time.
  function recordDue(date, nowMs) {
    const b = bounds(date);
    const recs = new Map(store.bucketsFor(db, date).map((r) => [r.k, { recordedMs: r.recordedMs, status: r.status }]));
    const obs = observation({ open: b.open, close: b.close, polls: store.okPolls(db, date).filter((p) => p <= nowMs), nowMs, graceMs: T.graceMs });
    const lastM = store.lastMinute(db, S.symbol, date);
    let n = 0;
    for (let k = 0; k < bucketCount(b); k++) {
      if (recs.has(k)) continue;
      const e = bucketEnd(b, k);
      if (e > nowMs) break;
      const i0 = k * 5, i1 = Math.round((e - b.open) / MIN);
      if (obs.minutes.slice(i0, i1).some((m) => m === 'open')) break;
      const lastMinute = 570 + i1 - 1;
      const gap = obs.gapMs != null && obs.gapMs < e;
      const arrived = store.hasBar(db, S.symbol, date, lastMinute) || (lastM != null && lastM > lastMinute);
      if (!(arrived || gap || nowMs >= e + T.bucketWaitMs)) break;
      const status = gap ? 'gap' : nowMs > e + T.decisionGraceMs ? 'late' : 'on_time';
      const provisional = new Map(recs); provisional.set(k, { recordedMs: nowMs, status });
      const c = compute(date, nowMs, { records: provisional });
      store.insertBucket(db, { session: date, k, endMs: e, recordedMs: nowMs, status, evaluation: evaluationAt(c, k), codeRevision: LIVE_CODE_REVISION });
      recs.set(k, { recordedMs: nowMs, status });
      n++;
    }
    return n;
  }
  async function poll(date, nowMs) {
    const b = bounds(date);
    const lastM = store.lastMinute(db, S.symbol, date);
    const fromMs = lastM == null ? b.open : b.open + (lastM - 570 + 1) * MIN;
    const endMs = Math.min(nowMs, b.close);
    if (!(endMs > fromMs)) { store.insertPoll(db, { session: date, atMs: nowMs, ok: true, detail: { received: 0 } }); return { ok: true, received: 0 }; }
    try {
      const list = await source.bars1m(S.symbol, fromMs, endMs);
      const fetchedMs = now();
      const rows = list.filter((x) => x.date === date && x.ms >= b.open && x.ms < b.close && x.ms + MIN <= fetchedMs).map((x) => ({ date, minute: x.minutes, s: x.ms, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
      const r = store.insertBars(db, S.symbol, rows, { fetchedMs, kind: 'live', graceMs: T.graceMs });
      // The request's start time is the observation time (conservative).
      store.insertPoll(db, { session: date, atMs: nowMs, ok: true, detail: { received: rows.length, stored: r.stored, live: r.live, responseMs: fetchedMs - nowMs } });
      return { ok: true, received: rows.length, ...r };
    } catch (e) {
      store.insertPoll(db, { session: date, atMs: nowMs, ok: false, detail: { error: String(e.message || e).slice(0, 300) } });
      store.logLine(db, iso(now()), 'warn', `poll failed: ${String(e.message || e).slice(0, 300)}`);
      return { ok: false, error: String(e.message || e) };
    }
  }
  function report(date, nowMs) {
    const c = compute(date, nowMs);
    return {
      date, gaps: c.obs.gaps.map((g) => ({ from: iso(g.fromMs), to: iso(g.toMs) })), observedMinutes: c.obs.minutes.filter((m) => m === 'observed').length, minutes: c.obs.minutes.length,
      liveBars: c.s?.m1.length ?? 0, levels: c.s ? c.s.levels : null,
      decisions: c.traded.decisions, trades: c.traded.trades,
      shown: Object.fromEntries(Object.entries(c.shown).map(([id, r]) => [id, r.decisions])),
    };
  }
  async function finalize(date) {
    const nowMs = now();
    recordDue(date, nowMs);
    const b = bounds(date);
    const list = await source.bars1m(S.symbol, b.open, b.close);
    const fetchedMs = now();
    const rows = list.filter((x) => x.date === date && x.ms >= b.open && x.ms < b.close).map((x) => ({ date, minute: x.minutes, s: x.ms, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
    const r = store.insertBars(db, S.symbol, rows, { fetchedMs, kind: 'reference', graceMs: T.graceMs });
    const rep = report(date, now());
    rep.reference = { received: rows.length, stored: r.stored };
    store.insertSession(db, date, iso(now()), rep, LIVE_CODE_REVISION);
    store.logLine(db, iso(now()), 'info', `session ${date} finalized: ${rep.trades.filter((t) => t.status === 'closed').length} closed trades, ${rep.gaps.length} gaps`);
    return rep;
  }

  // One step of the worker at the current time.
  async function step() {
    const act = activation();
    if (!act) throw new PsError(409, 'not activated: npm run psl:activate -- --confirm');
    const p = pinProblemsCached();
    if (p.length) throw new PsError(409, `the live account refuses to run: ${p.join('; ')}`);
    const nowMs = now(), today = etDate(nowMs);
    const out = { finalized: [], poll: null, recorded: 0 };
    if (today < act.startSession) return out;
    const reps = reportsMap();
    for (const d of tradingDays(act.startSession, today)) {
      const b = bounds(d);
      if (nowMs < b.close + T.finalAfterMs) break;
      if (reps.has(d)) continue;
      await finalize(d); // a failed reference fetch throws: today waits (its minutes become a gap) until it succeeds
      out.finalized.push(d);
    }
    if (isTradingDay(today) && !reportsMap().has(today)) {
      const b = bounds(today);
      if (nowMs >= b.open + MIN && nowMs < b.close + T.finalAfterMs) {
        if (now() < b.close + T.graceMs) out.poll = await poll(today, now());
        out.recorded = recordDue(today, now());
      }
    }
    return out;
  }
  // Is the bar of the minute that just ended in (so the worker can stop retrying)?
  function lastMinuteIn(nowMs) {
    const d = etDate(nowMs), b = bounds(d);
    if (!b) return true;
    const ended = Math.floor((Math.min(nowMs, b.close) - b.open) / MIN) - 1;
    return ended < 0 || (store.lastMinute(db, S.symbol, d) ?? -1) >= 570 + ended;
  }

  // ---------- what the dashboard shows ----------
  function sessionOrReport(d, nowMs, reps) {
    const rep = reps.get(d)?.report;
    return rep ? { rep, final: true } : { rep: report(d, nowMs), final: nowMs >= bounds(d).close + T.graceMs };
  }
  function account(nowMs = now()) {
    const act = activation();
    if (!act) return null;
    const today = etDate(nowMs), reps = reportsMap();
    const dates = [], tradesByDate = new Map();
    let finalCount = 0, open = null, current = null;
    for (const d of tradingDays(act.startSession, today < act.startSession ? act.startSession : today)) {
      const b = bounds(d);
      if (nowMs < b.open) break;
      const { rep, final } = sessionOrReport(d, nowMs, reps);
      dates.push(d);
      tradesByDate.set(d, rep.trades.filter((t) => t.status === 'closed').sort((x, y) => x.fillMs - y.fillMs));
      if (final) finalCount++;
      else { open = rep.trades.find((t) => t.status === 'open') ?? null; current = d; break; }
    }
    const acc = liveAccount({ dates, finalCount, tradesByDate, plan: S.plan, tickValue: S.tickValue, exec: matrix.execution, horizons: S.horizons });
    // The shown day: the session in progress, else the last session; its trades item by item with the attempt's state.
    const shownDate = current ?? dates.at(-1) ?? null;
    let day = null;
    if (shownDate) {
      const idx = dates.indexOf(shownDate);
      // The stage holding the shown day: the last stage for the session in progress, else the one whose days include it.
      const stg = current ? acc.stages.at(-1) : acc.stages.find((x) => idx >= x.i0 && idx < x.i0 + x.days.length);
      if (stg && idx >= stg.i0) day = { attempt: stg.n, ...dayDetail({ plan: S.plan, kind: stg.kind, days: stg.days.slice(0, idx - stg.i0), trades: tradesByDate.get(shownDate) || [], open, tickValue: S.tickValue, exec: matrix.execution }) };
    }
    const cur = acc.current;
    const inCurrent = current && dates.indexOf(current) >= cur.i0;
    const st = inCurrent && day ? day : dayDetail({ plan: S.plan, kind: cur.kind, days: cur.days, trades: [], tickValue: S.tickValue, exec: matrix.execution });
    const profit = st.equity - S.plan.size;
    const daysSoFar = [...cur.days, ...(inCurrent ? [st.dayPnl] : [])];
    const bestDay = Math.max(0, ...daysSoFar);
    return {
      ...acc, shownDate, day, inProgress: current,
      status: {
        attempt: cur.a.n, stage: cur.kind === 'eval' ? 'evaluation' : 'funded', started: cur.a.start, sessionsUsed: Math.max(0, (current ? dates.indexOf(current) + 1 : dates.length) - cur.i0),
        horizon: cur.kind === 'eval' ? S.horizons.evaluationSessions : S.horizons.fundedSessions,
        balance: st.balance, equity: st.equity, openPnl: st.openPnl, mll: st.mll, drawdownLeft: st.drawdownLeft, dailyLimit: st.dll, dailyLimitLeft: st.dailyLimitLeft, todayPnl: inCurrent ? st.dayPnl : 0,
        profit: Math.round(profit * 100) / 100, profitTarget: S.plan.profitTarget, progress: cur.kind === 'eval' ? profit / S.plan.profitTarget : null,
        consistency: S.plan.consistency, largestDayShare: profit > 0 ? bestDay / profit : null, contractCap: st.cap, endedToday: st.ended,
      },
    };
  }
  function overview() {
    const nowMs = now(), act = activation();
    const base = { simulated: true, label: LABEL, running: RUNNING, standIn: STAND_IN, feed: cfg.feed.label, traded: cfg.traded, shown: cfg.shown, plan: S.plan.plan, codeRevision: LIVE_CODE_REVISION, nowMs, tickPoints: S.tickPoints, ratio: S.ratio };
    if (!act) return { ...base, activated: false };
    const w = store.worker(db);
    const reps = reportsMap();
    const acc = account(nowMs);
    const d = acc.shownDate;
    let session = null;
    if (d) {
      const c = compute(d, nowMs), b = c.b;
      session = {
        date: d, open: b.open, close: b.close, final: reps.has(d) || nowMs >= b.close + T.graceMs,
        bars: (c.s?.m5 ?? []).map((x) => ({ k: x.k, s: x.s, e: x.e, o: x.o, h: x.h, l: x.l, c: x.c })),
        marks: c.s ? chartMarks(c.s, matrix) : { levels: null, sweeps: [], breaks: [] },
        gaps: c.obs.gaps, windows: c.traded.windows ?? [], flatBy: c.traded.flatBy ?? null,
        decisions: c.traded.decisions, trades: c.traded.trades,
        shown: Object.fromEntries(Object.entries(c.shown).map(([id, r]) => [id, r.decisions])),
        observedMinutes: c.obs.minutes.filter((m) => m === 'observed').length, judgedMinutes: c.obs.minutes.filter((m) => m !== 'open').length,
      };
    }
    return {
      ...base, activated: true, activation: act,
      worker: w ? { desired: w.desired, alive: !!(w.token && w.heartbeat_at && nowMs - Date.parse(w.heartbeat_at) < STALE_HEARTBEAT_MS), pid: w.pid, heartbeatAt: w.heartbeat_at, state: w.state } : null,
      polls: store.lastPolls(db, 3), session, account: acc,
      sessions: [...reps.values()].slice(-20).reverse().map((r) => ({ date: r.session, trades: r.report.trades.filter((t) => t.status === 'closed').length, gaps: r.report.gaps.length, observedMinutes: r.report.observedMinutes, minutes: r.report.minutes })),
      log: store.listLog(db, 10),
    };
  }

  // ---------- verify: re-derive every recorded decision as of its recording ----------
  function verify() {
    const all = store.allBuckets(db);
    const chain = store.verifyChain(all);
    const mismatches = [];
    const bySession = new Map();
    for (const r of all) { if (!bySession.has(r.session)) bySession.set(r.session, []); bySession.get(r.session).push(r); }
    for (const [date, rows] of bySession) {
      const bars = store.barsBetween(db, S.symbol, windowFrom(date), date);
      const recs = new Map();
      for (const r of rows.sort((x, y) => x.seq - y.seq)) {
        recs.set(r.k, { recordedMs: r.recordedMs, status: r.status });
        const c = compute(date, r.recordedMs, { records: new Map(recs), bars });
        if (JSON.stringify(evaluationAt(c, r.k)) !== JSON.stringify(r.evaluation)) mismatches.push(`${date} bucket ${r.k}`);
      }
    }
    return { buckets: all.length, chain, mismatches, before: store.countBefore(db, cfg.dataFrom) };
  }

  return { activate, activation, step, poll, recordDue, finalize, compute, report, account, overview, verify, pinProblems, lastMinuteIn, setup: S };
}

// What the worker does next at `nowMs`: poll a few seconds after each minute during the session (and every few seconds
// until the minute's bar is in, for up to the bucket wait), finalize after the close, otherwise check once a minute.
export function nextWake(nowMs, { timing, lastMinuteIn }) {
  const d = etDate(nowMs), b = isTradingDay(d) ? bounds(d) : null;
  if (b && nowMs >= b.open && nowMs < b.close + timing.graceMs) {
    const intoMinute = (nowMs - b.open) % MIN;
    const minuteStart = nowMs - intoMinute;
    if (intoMinute >= timing.pollAfterMs && intoMinute < timing.bucketWaitMs && !lastMinuteIn) return nowMs + timing.retryMs;
    return intoMinute < timing.pollAfterMs ? minuteStart + timing.pollAfterMs : minuteStart + MIN + timing.pollAfterMs;
  }
  if (b && nowMs < b.open) return Math.min(b.open + MIN + timing.pollAfterMs, nowMs + MIN);
  return nowMs + MIN;
}

export async function runLiveWorker({ db, live, clock = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pid = process.pid, token, maxLoops = Infinity, log = () => {} }) {
  const at = () => clock().toISOString();
  const claim = store.claimWorker(db, { token, pid, at: at(), staleMs: STALE_HEARTBEAT_MS });
  if (!claim.ok) throw new PsError(409, `another prop-sim live worker is alive (pid ${claim.holder.pid}, heartbeat ${claim.holder.heartbeat_at})`);
  store.logLine(db, at(), 'info', `worker started (pid ${pid})`);
  let loops = 0;
  try {
    while (loops++ < maxLoops) {
      const w = store.worker(db);
      if (!w || w.token !== token) { store.logLine(db, at(), 'warn', 'worker lost the control row: exiting'); return { exit: 'taken over' }; }
      if (w.desired === 'stopped') { store.logLine(db, at(), 'info', 'stop requested: exiting'); return { exit: 'stopped' }; }
      if (w.desired === 'paused') { store.heartbeat(db, token, at(), 'paused (a pause is a gap)'); await sleep(60000); continue; }
      store.heartbeat(db, token, at(), 'stepping');
      try { const r = await live.step(); if (r.finalized.length || (r.poll && !r.poll.ok)) log(`step: ${JSON.stringify(r)}`); }
      catch (e) { store.logLine(db, at(), 'error', `step failed: ${String(e.message || e).slice(0, 500)}`); log(`step failed: ${e.message}`); }
      store.heartbeat(db, token, at(), 'waiting');
      const nowMs = clock().getTime();
      const wake = nextWake(nowMs, { timing: live.setup.timing, lastMinuteIn: live.lastMinuteIn(nowMs) });
      await sleep(Math.max(500, Math.min(60000, wake - clock().getTime())));
    }
    return { exit: 'loop limit' };
  } finally { store.releaseWorker(db, token, at()); }
}
