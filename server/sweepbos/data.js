// sweep-bos market data (PRE-REGISTRATION.md section 1): the regular-session filter for 5-minute bars, the
// bounded download through the project's Alpaca client, the readiness check (counts only) and the inputs an
// engine run reads. Read-only market data; nothing here reads holdings or cash or prepares an order.
//
// The bar bound (config.js MAX_BAR_DATE): a download request past it is refused before any request is sent,
// the store refuses to write a later bar, and every load is filtered in SQL; loadInputs asserts the result.
import { dayInfo } from '../calendar.js';
import { tradingDays } from '../strategy/sessions.js';
import { MAX_BAR_DATE, WINDOWS, INSTRUMENTS, CODE_REVISION } from './config.js';
import * as store from './store.js';

export const BAR_MINUTES = 5;
export const TIMEFRAME_5M = '5Min';
export const TIMEFRAME_1D = '1Day';

// 78 on a full session, 42 on an early close, 0 on a non-session day.
export function fullCount(date) {
  const i = dayInfo(date, 'NYSE');
  return i.open ? (i.closeMin - i.openMin) / BAR_MINUTES : 0;
}

const validOhlc = (b) => Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.l > 0 && b.h >= b.l && b.o >= b.l && b.o <= b.h && b.c >= b.l && b.c <= b.h;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The regular-session slots of raw intraday bars ({ ms, date, minutes, second, o, h, l, c, v, n, vw } from
// the Alpaca client, one symbol): a bar is kept when its session is an NYSE session, its start is on a
// 5-minute boundary at or after 09:30 and before the close (13:00 on an early close), its OHLC is valid and
// its slot is not already taken. Returns { rows, dropped } with rows as store.insertBars5m expects.
export function sessionSlots(bars) {
  const rows = [];
  const dropped = { outsideSession: 0, misaligned: 0, duplicateSlot: 0, invalidOhlc: 0 };
  const seen = new Set();
  for (const b of bars) {
    const info = dayInfo(b.date, 'NYSE');
    if (!info.open) { dropped.outsideSession++; continue; }
    if (b.second !== 0 || b.minutes % BAR_MINUTES !== 0) { dropped.misaligned++; continue; }
    if (b.minutes < info.openMin || b.minutes >= info.closeMin) { dropped.outsideSession++; continue; }
    if (!validOhlc(b)) { dropped.invalidOhlc++; continue; }
    const idx = (b.minutes - info.openMin) / BAR_MINUTES;
    const key = `${b.date}#${idx}`;
    if (seen.has(key)) { dropped.duplicateSlot++; continue; }
    seen.add(key);
    rows.push({ session: b.date, idx, ts: b.ms, hhmm: hhmm(b.minutes), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? null, n: b.n ?? null, vw: b.vw ?? null });
  }
  return { rows, dropped };
}

// [from, to] split into pieces of about `months` months (exchange-local dates), for progressive storage.
export function chunks(from, to, months = 3) {
  const out = [];
  let a = from;
  while (a <= to) {
    const [y, m] = a.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1 + months, 1));
    const b0 = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const prev = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 0));
    const b = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
    out.push([a, b < to ? b : to]);
    a = b0;
  }
  return out;
}

// Downloads daily and 5-minute bars of the symbols for [from, to] into a new data version. Refuses, before
// any request, a `to` after MAX_BAR_DATE. `source` is the Alpaca client (dailyBars, intradayBars). Progress
// lines carry counts only, never prices.
export async function downloadBars(db, source, {
  symbols = INSTRUMENTS, from = WINDOWS.warmupFrom, to = WINDOWS.development.end, label = 'warmup-development',
  now = () => new Date(), log = () => {}, preregCommit = null, preregSha256 = null, chunkMonths = 3,
} = {}) {
  store.assertWithinBound(to, 'the requested download end');
  if (!(from <= to)) throw new Error('download: from must be on or before to');
  if (!source?.configured) throw new Error('Alpaca keys are not set in .env (ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY): nothing downloaded');
  const downloadedAt = now().toISOString();
  const id = store.createDataVersion(db, { label, symbols, from, to, feed: source.feed, adjustment: source.adjustment, source: source.id, timeframes: [TIMEFRAME_1D, TIMEFRAME_5M], downloadedAt, preregCommit, preregSha256, codeRevision: CODE_REVISION });
  const dropped = { daily: {}, intraday: {} };
  let bars5m = 0, bars1d = 0;
  try {
    for (const sym of symbols) {
      const daily = await source.dailyBars(sym, { from, to });
      const late = daily.filter((b) => b.date > to);
      if (late.length) throw new store.BarBoundError(`the source returned ${late.length} daily bar(s) of ${sym} after ${to}; nothing stored`);
      bars1d += store.insertBars1d(db, id, sym, daily.map((b) => ({ date: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw })));
      dropped.daily[sym] = daily.dropped;
      log(`${sym}: ${daily.length} daily bars stored (${daily.pages} page(s); dropped ${JSON.stringify(daily.dropped)})`);
      const d5 = { outsideSession: 0, misaligned: 0, duplicateSlot: 0, invalidOhlc: 0, source: { unreadable: 0, outOfRange: 0, nonTradingDay: 0, incomplete: 0, invalid: 0, duplicates: 0 } };
      let returned = 0;
      for (const [a, b] of chunks(from, to, chunkMonths)) {
        const raw = await source.intradayBars(sym, TIMEFRAME_5M, { from: a, to: b });
        const lateBars = raw.filter((x) => x.date > to);
        if (lateBars.length) throw new store.BarBoundError(`the source returned ${lateBars.length} intraday bar(s) of ${sym} after ${to}; nothing stored`);
        for (const k of Object.keys(raw.dropped)) d5.source[k] += raw.dropped[k];
        const { rows, dropped: dr } = sessionSlots(raw);
        for (const k of Object.keys(dr)) d5[k] += dr[k];
        bars5m += store.insertBars5m(db, id, sym, rows);
        returned += raw.length;
        log(`${sym}: ${a} to ${b}: ${rows.length} session bars stored of ${raw.length} returned (${raw.pages} page(s))`);
      }
      d5.returned = returned;
      dropped.intraday[sym] = d5;
    }
    const dataHash = store.dataHashOf(db, id);
    const finishedAt = now().toISOString();
    store.completeDataVersion(db, id, { finishedAt, bars5m, bars1d, dropped, dataHash });
    store.appendLedger(db, { kind: 'data_version', dataVersionId: id, note: `${label}: ${symbols.join(', ')} ${from} to ${to}, ${source.feed} ${source.adjustment}, ${bars1d} daily and ${bars5m} 5-minute bars, hash ${dataHash}`, at: finishedAt });
    return { id, bars5m, bars1d, dropped, dataHash, downloadedAt, finishedAt };
  } catch (e) {
    store.failDataVersion(db, id, { finishedAt: now().toISOString(), error: e.message });
    throw e;
  }
}

const tally = (dates) => { const t = {}; for (const d of dates) { const y = d.slice(0, 4); t[y] = (t[y] || 0) + 1; } return t; };

// Counts only (PRE-REGISTRATION.md 1.2-1.4): sessions expected by the NYSE calendar, stored, complete or
// incomplete (missing slots), unexpected sessions, invalid OHLC, zero-range, odd-range (range over 5% of the
// close) and odd-jump (close-to-close over 3% inside a session) bars, daily bars present and their high/low
// against the 5-minute session high/low (beyond 0.01), the sessions in `excludedSessions`, and the bound.
export function readinessCheck(db, versionId, { excludedSessions = [] } = {}) {
  const v = store.getDataVersion(db, versionId);
  if (!v) throw new Error(`data version ${versionId} does not exist`);
  const out = { versionId, label: v.label, from: v.from, to: v.to, bound: MAX_BAR_DATE, maxStoredDate: store.maxStoredDate(db), barsAfterBound: store.countBarsAfterBound(db), status: v.status, dataHash: v.dataHash, symbols: {} };
  const expected = tradingDays(v.from, v.to);
  const expectedSet = new Set(expected);
  for (const sym of v.symbols) {
    const counts = store.sessionCounts5m(db, versionId, sym);
    const bySession = new Map(counts.map((c) => [c.session, c]));
    const daily = store.loadBars1d(db, versionId, sym);
    const dailyMap = new Map(daily.map((d) => [d.date, d]));
    let complete = 0, incomplete = 0, missingSessions = 0, missingSlots = 0, earlyCloses = 0;
    const incompleteList = [];
    for (const d of expected) {
      const full = fullCount(d);
      if (dayInfo(d, 'NYSE').earlyClose) earlyCloses++;
      const c = bySession.get(d);
      if (!c) { missingSessions++; missingSlots += full; incompleteList.push(d); continue; }
      if (c.n === full) complete++;
      else { incomplete++; missingSlots += Math.max(0, full - c.n); incompleteList.push(d); }
    }
    const unexpected = counts.filter((c) => !expectedSet.has(c.session)).length;
    const bars = store.loadBars5m(db, versionId, sym);
    let badOhlcStored = 0, zeroRange = 0, oddRange = 0, oddJump = 0, slotOutOfRange = 0;
    const sessionHL = new Map();
    let prev = null;
    for (const b of bars) {
      if (!validOhlc(b)) badOhlcStored++;
      if (b.h === b.l) zeroRange++;
      if ((b.h - b.l) / b.c > 0.05) oddRange++;
      if (prev && prev.session === b.session && Math.abs(b.c / prev.c - 1) > 0.03) oddJump++;
      if (b.idx < 0 || b.idx >= fullCount(b.session)) slotOutOfRange++;
      const s = sessionHL.get(b.session) || { h: -Infinity, l: Infinity };
      s.h = Math.max(s.h, b.h); s.l = Math.min(s.l, b.l);
      sessionHL.set(b.session, s);
      prev = b;
    }
    let dailyMissing = 0, dailyMismatch = 0, dailyBad = 0;
    for (const d of expected) {
      const row = dailyMap.get(d);
      if (!row) { dailyMissing++; continue; }
      if (!validOhlc(row)) dailyBad++;
      const s = sessionHL.get(d);
      if (s && bySession.get(d)?.n === fullCount(d) && (Math.abs(row.h - s.h) > 0.01 + 1e-9 || Math.abs(row.l - s.l) > 0.01 + 1e-9)) dailyMismatch++;
    }
    const excluded = excludedSessions.filter((x) => x.date >= v.from && x.date <= v.to).map((x) => {
      const n = bySession.get(x.date)?.n ?? 0;
      return { date: x.date, bars: n, full: fullCount(x.date), complete: n === fullCount(x.date), reason: x.reason };
    });
    out.symbols[sym] = {
      expectedSessions: expected.length, earlyCloseSessions: earlyCloses, sessionsStored: counts.length, complete, incomplete, missingSessions, missingSlots, unexpectedSessions: unexpected,
      bars5m: bars.length, badOhlcStored, slotOutOfRange, zeroRangeBars: zeroRange, oddRangeBars: oddRange, oddJumpBars: oddJump,
      daily: { stored: daily.length, missing: dailyMissing, badOhlc: dailyBad, highLowMismatch: dailyMismatch },
      dropped: v.dropped ? { daily: v.dropped.daily?.[sym] ?? null, intraday: v.dropped.intraday?.[sym] ?? null } : null,
      excludedSessions: excluded, incompleteSessionsByYear: tally(incompleteList),
    };
  }
  return out;
}

// The engine's inputs for one symbol: the daily bars and the 5-minute sessions (each { date, full, bars }) of
// [from, to], never past the bound. Sessions are in date order with bars in index order; a session's `full` is
// the calendar's count, so the engine applies the incomplete-session rule itself.
export function loadInputs(db, versionId, symbol, { from = WINDOWS.warmupFrom, to = WINDOWS.development.end } = {}) {
  store.assertWithinBound(to, 'the requested input end');
  const daily = store.loadBars1d(db, versionId, symbol, { from, to });
  const bars = store.loadBars5m(db, versionId, symbol, { from, to });
  for (const b of bars) if (b.session > MAX_BAR_DATE) throw new store.BarBoundError(`a stored bar after ${MAX_BAR_DATE} reached loadInputs`);
  for (const d of daily) if (d.date > MAX_BAR_DATE) throw new store.BarBoundError(`a stored daily bar after ${MAX_BAR_DATE} reached loadInputs`);
  const sessions = [];
  let cur = null;
  for (const b of bars) {
    if (!cur || cur.date !== b.session) { cur = { date: b.session, full: fullCount(b.session), bars: [] }; sessions.push(cur); }
    cur.bars.push({ idx: b.idx, ts: b.ts, hhmm: b.hhmm, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  return { symbol, from, to, daily, sessions };
}
