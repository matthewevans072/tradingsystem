// HXR data layer (strategy/hxr/ENGINE-SPEC.md sections 2 and 9): turns stored
// rows into engine inputs (raw daily bars from each listing date, split
// events, dividends, first-15-minute VWAP, the calibrated half-spread table)
// and builds the readiness checklist. It only reads hxr-sim.sqlite: it never
// adjusts a bar, fills a gap, shortens a period or swaps an instrument.
import crypto from 'node:crypto';
import { isTradingDay, previousTradingDay } from '../calendar.js';
import { tradingDays } from '../strategy/sessions.js';
import { addDays, ymd, todayIn, NY } from '../time.js';
import { canonicalJson, deepFreeze } from '../strategy/config.js';
import { universeEntry, basketSymbols, excludedDates, halfSpreadFor, BACKTEST_PERIODS } from './config.js';
import * as store from './store.js';

export const SPREAD_MONTHS = [1, 3, 5, 7, 9, 11];
export const MAX_SPREAD_OF_MID = 0.05;
export const SPREAD_METHOD = 'hxr-spread-2: per symbol and calendar year, the median of the sampled days\' median quoted half-spreads dated on or before the fill (the previous year\'s value until the year\'s first sample), floored';
export const INPUTS_METHOD = 'hxr-inputs-1';
export const SPLIT_TYPES = ['forward_split', 'reverse_split'];
// Corporate actions the engine does not model: inside a period they make it unusable.
export const UNHANDLED_TYPES = ['stock_dividend', 'spin_off', 'cash_merger', 'stock_merger'];
// A split's first raw session should open near previous close / ratio (within 25%, in log terms).
const SPLIT_TOL = Math.log(1.25);
// The unknown-split scan flags overnight ratios within 8% of 1/k or k.
export const SCAN_RATIOS = [2, 3, 4, 5, 10, 20];
const SCAN_TOL = Math.log(1.08);
const SAMPLE = 10;

const round = (x, dp = 6) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ---------- spreads ----------

// The first NYSE trading day of January, March, May, July, September and
// November of each year, from listedFrom to today (both inclusive).
export function sampledSpreadDays(listedFrom, today) {
  const out = [];
  for (let y = Number(listedFrom.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
    for (const m of SPREAD_MONTHS) {
      let d = ymd(y, m, 1);
      while (!isTradingDay(d, 'NYSE')) d = addDays(d, 1);
      if (d >= listedFrom && d <= today) out.push(d);
    }
  }
  return out;
}

// One sampled day's quotes [{ ap, bp, t }] -> the median quoted spread and
// half-spread in bps of mid. Quotes with bid <= 0, ask <= bid or a spread over
// 5% of mid are dropped; with no usable quote the medians are null.
export function spreadSampleFromQuotes(quotes) {
  const spreads = [];
  let dropped = 0;
  for (const q of quotes || []) {
    const bid = Number(q?.bp), ask = Number(q?.ap);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || !(bid > 0) || !(ask > bid)) { dropped++; continue; }
    const mid = (ask + bid) / 2, s = (ask - bid) / mid;
    if (s > MAX_SPREAD_OF_MID) { dropped++; continue; }
    spreads.push(s * 10000);
  }
  const ms = median(spreads);
  return { quotes: spreads.length, dropped, medianSpreadBps: round(ms), medianHalfSpreadBps: ms == null ? null : round(ms / 2) };
}

// { table: { SYM: { YEAR: bps } }, steps: { SYM: [[date, bps], ...] }, firstSampled: { SYM: date|null }, floorBps, hash }.
// table (shown on the page) holds each year's median of its sampled days'
// medians, floored; a year without a sample carries the most recent earlier
// year's value and years before the first sample hold the floor. steps is
// what a fill uses (no look-ahead, ENGINE-SPEC.md section 6): from each
// sampled day, the median of that calendar year's samples dated on or before
// it, floored, until the next sampled day. Before a year's first sample the
// previous year's full value carries; before the first sample, the floor.
// Samples dated before the listing are ignored. Years run from the listing
// year to the last sampled year (or toYear when later).
export function buildSpreadTable(db, universe, { floorBps, toYear = null } = {}) {
  if (!Number.isFinite(floorBps) || floorBps < 0) throw new Error('buildSpreadTable needs floorBps');
  const table = {}, steps = {}, firstSampled = {};
  for (const s of universe.symbols) {
    const samples = store.listSpreadSamples(db, s.symbol).filter((x) => x.date >= s.listedFrom && Number.isFinite(x.medianHalfSpreadBps))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const byYear = new Map(), row = [];
    for (const x of samples) {
      const y = Number(x.date.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(x.medianHalfSpreadBps);
      row.push([x.date, round(Math.max(median(byYear.get(y)), floorBps))]);
    }
    steps[s.symbol] = row;
    firstSampled[s.symbol] = samples[0]?.date ?? null;
    const first = Number(s.listedFrom.slice(0, 4));
    const last = Math.max(first, toYear ?? first, ...byYear.keys());
    const years = {};
    let carry = null;
    for (let y = first; y <= last; y++) {
      if (byYear.has(y)) carry = round(Math.max(median(byYear.get(y)), floorBps));
      years[y] = carry ?? floorBps;
    }
    table[s.symbol] = years;
  }
  const hash = sha(canonicalJson({ method: SPREAD_METHOD, floorBps, table, steps, firstSampled }));
  return deepFreeze({ table, steps, firstSampled, floorBps, hash });
}

// (symbol, date) -> half-spread bps. `spread` is buildSpreadTable's result:
// the latest step dated on or before `date`, so a fill never uses a quote
// sample taken after it; before a symbol's first sampled day the floor
// applies (PREREGISTRATION.md section 5). A bare { SYM: { YEAR: bps } } table
// (tests) is looked up by year, carrying the latest earlier one. An unknown
// symbol throws.
export function halfSpreadFn(spread, floorBps = spread?.floorBps) {
  if (!Number.isFinite(floorBps)) throw new Error('halfSpreadFn needs floorBps');
  if (spread && typeof spread.steps === 'object') {
    return (symbol, date) => {
      const row = spread.steps[symbol];
      if (!row) throw new Error(`No half-spread calibration for ${symbol}`);
      let lo = 0, hi = row.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (row[mid][0] <= date) lo = mid + 1; else hi = mid; }
      return lo ? Math.max(row[lo - 1][1], floorBps) : floorBps;
    };
  }
  const table = spread || {};
  return (symbol, date) => {
    const row = table[symbol];
    if (!row) throw new Error(`No half-spread calibration for ${symbol}`);
    const y = Number(String(date).slice(0, 4));
    let best = null;
    for (const k of Object.keys(row)) if (Number(k) <= y && (best == null || Number(k) > best)) best = Number(k);
    return best == null ? floorBps : Math.max(row[best], floorBps);
  };
}

// ---------- engine inputs ----------

const sessionsFrom = (from, to, excluded) => (from > to ? [] : tradingDays(from, to, 'NYSE').filter((d) => !excluded.has(d)));

// First session on or after a date in a sorted list (or null).
function onOrAfter(sorted, date) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < date) lo = mid + 1; else hi = mid; }
  return lo < sorted.length ? sorted[lo] : null;
}

const exSet = (excludedSessions) => new Set((excludedSessions || []).map((x) => (typeof x === 'string' ? x : x.date)));

// Splits of a symbol from its listing: [{ id, exDate, ratio }] with ratio =
// new shares per old share. Identical duplicates are dropped; two different
// ratios on one date throw.
function splitEvents(db, entry, warnings) {
  const out = new Map();
  for (const a of store.listCorporateActions(db, { symbol: entry.symbol, types: SPLIT_TYPES })) {
    if (a.symbol !== entry.symbol || !a.ex_date || a.ex_date < entry.listedFrom) continue;
    const ratio = a.ratio_new / a.ratio_old;
    if (!Number.isFinite(ratio) || !(ratio > 0) || ratio === 1) { warnings.push(`${entry.symbol}: split ${a.id} on ${a.ex_date} has no usable ratio (${a.ratio_new}/${a.ratio_old}); ignored`); continue; }
    const same = out.get(a.ex_date);
    if (same) {
      if (Math.abs(same.ratio - ratio) > 1e-12) throw new Error(`${entry.symbol}: two different splits on ${a.ex_date} (${same.ratio} and ${ratio})`);
      warnings.push(`${entry.symbol}: duplicate split record ${a.id} on ${a.ex_date} ignored`);
      continue;
    }
    out.set(a.ex_date, { id: a.id, exDate: a.ex_date, ratio });
  }
  return [...out.values()];
}

// buildInputs(db, { universe, symbols, warmupFrom, end, excludedSessions, spreadTable, start, config, confirmed }) ->
// { symbols, sessions, days: Map(date -> { bars: { SYM: { o, h, l, c, v, vw15 } }, splits: [{ symbol, ratio }],
//   dividends: [{ symbol, exDate, payDate, amount, id }] }), coverage, warnings, calibrationHash, dataHash, halfSpreadBps }.
// Sessions are NYSE sessions from warmupFrom to end minus the excluded ones.
// A split or dividend whose ex-date is not one of those sessions applies on
// the next one (its declared date is kept as declaredExDate). halfSpreadBps
// is the table lookup, or with `config` the config's half-spread (fixed or
// calibrated, floor, variant multiplier: config.js halfSpreadFor). A symbol
// whose identity is pending (SPCX) is never priced unless `confirmed` names it.
export function buildInputs(db, { universe, symbols, warmupFrom, end, excludedSessions = [], spreadTable = null, start = null, config = null, confirmed = [] } = {}) {
  if (!universe || !Array.isArray(symbols) || !symbols.length) throw new Error('buildInputs needs the universe and a symbol list');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(warmupFrom || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || warmupFrom > end) throw new Error('buildInputs needs warmupFrom and end dates');
  const entries = symbols.map((s) => universeEntry(universe, typeof s === 'string' ? s : s.symbol));
  if (new Set(entries.map((e) => e.symbol)).size !== entries.length) throw new Error('buildInputs: a symbol is listed twice');
  for (const e of entries) {
    if (e.identity && e.identity !== 'confirmed' && !confirmed.includes(e.symbol)) throw new Error(`${e.symbol}'s identity is pending the owner's confirmation: it is not priced in HXR`);
  }
  if (start) {
    for (const e of entries) if (e.listedFrom > start) throw new Error(`${e.symbol} is listed from ${e.listedFrom}, after the period start ${start}: a period definition error`);
  }
  const excluded = exSet(excludedSessions);
  const sessions = sessionsFrom(warmupFrom, end, excluded);
  const days = new Map(sessions.map((d) => [d, { bars: {}, splits: [], dividends: [] }]));
  const coverage = {}, warnings = [];

  for (const e of entries) {
    const sym = e.symbol;
    const from = e.listedFrom > warmupFrom ? e.listedFrom : warmupFrom;
    const vw15 = new Map(store.getFirst15(db, sym, { from, to: end }).map((r) => [r.date, r.vw]));
    const cov = { listedFrom: e.listedFrom, bars: 0, vw15: 0, missing: 0, excludedSessions: 0, nonSessions: 0, beforeListing: 0, splits: 0, dividends: 0 };
    if (e.listedFrom > warmupFrom) cov.beforeListing = store.getBars(db, sym, { from: warmupFrom, to: addDays(e.listedFrom, -1) }).length;
    for (const b of store.getBars(db, sym, { from, to: end })) {
      if (excluded.has(b.date)) { cov.excludedSessions++; continue; }
      const day = days.get(b.date);
      if (!day) { cov.nonSessions++; continue; }
      const vw = vw15.get(b.date);
      day.bars[sym] = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? null, vw15: Number.isFinite(vw) ? vw : null };
      cov.bars++;
      if (Number.isFinite(vw)) cov.vw15++;
    }
    cov.missing = sessions.filter((d) => d >= e.listedFrom && !days.get(d).bars[sym]).length;
    if (cov.nonSessions) warnings.push(`${sym}: ${cov.nonSessions} stored bar(s) on days that are not NYSE sessions were ignored`);

    for (const s of splitEvents(db, e, warnings)) {
      if (s.exDate < warmupFrom || s.exDate > end) continue;
      const d = onOrAfter(sessions, s.exDate);
      if (!d) continue;
      days.get(d).splits.push({ symbol: sym, ratio: s.ratio, id: s.id, ...(d !== s.exDate ? { declaredExDate: s.exDate } : {}) });
      cov.splits++;
    }

    const seen = new Set();
    for (const a of store.listCorporateActions(db, { symbol: sym, types: ['cash_dividend'] })) {
      if (a.symbol !== sym || seen.has(a.id) || !a.ex_date || a.ex_date < e.listedFrom || a.ex_date < warmupFrom || a.ex_date > end) continue;
      seen.add(a.id);
      if (!(Number.isFinite(a.rate) && a.rate > 0)) { warnings.push(`${sym}: dividend ${a.id} on ${a.ex_date} has no usable amount; ignored`); continue; }
      const d = onOrAfter(sessions, a.ex_date);
      if (!d) continue;
      days.get(d).dividends.push({ symbol: sym, exDate: d, payDate: a.pay_date || a.ex_date, amount: a.rate, id: a.id, ...(d !== a.ex_date ? { declaredExDate: a.ex_date } : {}) });
      cov.dividends++;
    }
    coverage[sym] = cov;
  }

  // Deterministic order within a day: the symbol order given, then id.
  const order = new Map(entries.map((e, i) => [e.symbol, i]));
  const byOrder = (a, b) => order.get(a.symbol) - order.get(b.symbol) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const day of days.values()) { day.splits.sort(byOrder); day.dividends.sort(byOrder); }

  const symbolList = entries.map((e) => ({ symbol: e.symbol, exchange: e.exchange, listedFrom: e.listedFrom }));
  const calibrationHash = spreadTable?.hash ?? null;
  const h = crypto.createHash('sha256');
  h.update(canonicalJson({ method: INPUTS_METHOD, symbols: symbolList, warmupFrom, end, start, excluded: [...excluded].sort(), calibrationHash }));
  for (const d of sessions) {
    const day = days.get(d);
    const bars = entries.map((e) => { const b = day.bars[e.symbol]; return b ? [b.o, b.h, b.l, b.c, b.v, b.vw15] : null; });
    h.update(`\n${canonicalJson([d, bars, day.splits, day.dividends])}`);
  }
  const calibrated = spreadTable ? halfSpreadFn(spreadTable) : null;
  return {
    symbols: symbolList, sessions, days, coverage, warnings, calibrationHash, dataHash: h.digest('hex'),
    halfSpreadBps: config ? halfSpreadFor(config, calibrated) : calibrated,
  };
}

// ---------- readiness ----------

function overnightFn(byDate, excluded) {
  const prevIncluded = (d) => { let x = previousTradingDay(d, 'NYSE'); while (excluded.has(x)) x = previousTradingDay(x, 'NYSE'); return x; };
  return (d) => {
    const prev = prevIncluded(d);
    const a = byDate.get(prev), b = byDate.get(d);
    if (!a || !b || !(a.c > 0) || !(b.o > 0)) return null;
    return { prevSession: prev, prevClose: a.c, open: b.o, ratio: b.o / a.c };
  };
}

const badOhlc = (b) => ![b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0) || b.h < b.l || b.o > b.h || b.o < b.l || b.c > b.h || b.c < b.l;

function checkSymbol(db, entry, { excluded, lastComplete, reviewed }) {
  const sym = entry.symbol, listedFrom = entry.listedFrom;
  const all = store.getBars(db, sym);
  const bars = all.filter((b) => b.date >= listedFrom);
  const byDate = new Map(bars.map((b) => [b.date, b]));
  const expected = sessionsFrom(listedFrom, lastComplete, excluded);
  const expectedSet = new Set(expected);
  const missing = expected.filter((d) => !byDate.has(d));
  const onSessions = bars.filter((b) => expectedSet.has(b.date));
  const zeroVolume = onSessions.filter((b) => !(b.v > 0)).map((b) => b.date);
  const invalid = onSessions.filter(badOhlc).map((b) => b.date);
  const overnight = overnightFn(byDate, excluded);

  const warnings = [];
  const actions = store.listCorporateActions(db, { symbol: sym });
  const splits = splitEvents(db, entry, warnings).map((s) => {
    const session = onOrAfter(expected, s.exDate) ?? (s.exDate > lastComplete ? null : s.exDate);
    const base = { id: s.id, exDate: s.exDate, ratio: round(s.ratio), session, expectedOvernight: round(1 / s.ratio, 4) };
    if (s.exDate > lastComplete) return { ...base, status: 'future' };
    const on = session ? overnight(session) : null;
    if (!on) return { ...base, status: 'no data' };
    const ok = Math.abs(Math.log(on.ratio) - Math.log(1 / s.ratio)) < SPLIT_TOL;
    return { ...base, overnight: { ...on, ratio: round(on.ratio, 4) }, status: ok ? 'pass' : 'fail' };
  });
  const splitSessions = new Set(splits.map((s) => s.session).filter(Boolean));
  const reviewedDates = new Map((reviewed || []).filter((r) => r.symbol === sym).map((r) => [r.date, r]));
  const candidates = [];
  let boundaries = 0;
  for (const d of expected) {
    if (!byDate.has(d)) continue;
    const on = overnight(d);
    if (!on) continue;
    boundaries++;
    if (splitSessions.has(d)) continue;
    const lr = Math.log(on.ratio);
    const k = SCAN_RATIOS.find((x) => Math.abs(lr + Math.log(x)) < SCAN_TOL || Math.abs(lr - Math.log(x)) < SCAN_TOL);
    if (k == null) continue;
    const looksLike = Math.abs(lr + Math.log(k)) < SCAN_TOL ? `a ${k}-for-1 split` : `a 1-for-${k} reverse split`;
    const c = { date: d, prevSession: on.prevSession, prevClose: on.prevClose, open: on.open, ratio: round(on.ratio, 4), looksLike };
    if (reviewedDates.has(d)) c.reviewed = reviewedDates.get(d);
    candidates.push(c);
  }

  const dividends = actions.filter((a) => a.type === 'cash_dividend' && a.symbol === sym);
  const nameChanges = actions.filter((a) => a.type === 'name_change' && (a.old_symbol === sym || a.new_symbol === sym))
    .map((a) => ({ id: a.id, date: a.process_date, from: a.old_symbol, to: a.new_symbol, beforeListing: !!a.process_date && a.process_date < listedFrom }));
  const unhandled = actions.filter((a) => UNHANDLED_TYPES.includes(a.type) && a.symbol === sym && (a.ex_date || a.process_date || '') >= listedFrom)
    .map((a) => ({ id: a.id, type: a.type, date: a.ex_date || a.process_date, oldSymbol: a.old_symbol, newSymbol: a.new_symbol }));

  const first15 = new Set(store.getFirst15(db, sym, { from: listedFrom, to: lastComplete }).filter((r) => Number.isFinite(r.vw)).map((r) => r.date));
  const f15Missing = expected.filter((d) => !first15.has(d));
  const sampleDays = sampledSpreadDays(listedFrom, lastComplete);
  const samples = new Map(store.listSpreadSamples(db, sym).map((s) => [s.date, s]));
  const spreadMissing = sampleDays.filter((d) => !samples.has(d));
  const spreadEmpty = sampleDays.filter((d) => samples.has(d) && !Number.isFinite(samples.get(d).medianHalfSpreadBps));

  const notes = [];
  const beforeListing = all.length - bars.length;
  if (beforeListing) notes.push(`${beforeListing} stored bar(s) before the listing date ${listedFrom} are ignored.`);
  const ignoredDividends = dividends.filter((a) => !a.ex_date || a.ex_date < listedFrom).length;
  if (ignoredDividends) notes.push(`${ignoredDividends} cash dividend(s) dated before the listing date are ignored.`);
  // Alpaca has no pay date for some older dividends: they are credited on the ex-date.
  const noPayDate = dividends.filter((a) => a.ex_date && a.ex_date >= listedFrom && !a.pay_date).length;
  if (noPayDate) notes.push(`${noPayDate} cash dividend(s) have no pay date and are credited on their ex-date.`);
  const cusips = [...new Set(actions.filter((a) => a.symbol === sym && a.cusip && (a.ex_date || a.process_date || '') >= listedFrom).map((a) => a.cusip))].sort();
  if (cusips.length > 1) notes.push(`Corporate actions since the listing carry ${cusips.length} CUSIPs (${cusips.join(', ')}): check that they are one security.`);
  if (entry.note) notes.push(entry.note);
  if (entry.identity === 'pending_owner_confirmation') notes.push('Identity pending the owner\'s confirmation: not priced anywhere in HXR until confirmed.');
  if (Array.isArray(entry.baskets) && entry.baskets.every((b) => b === 'prospective')) notes.push('Prospective account only: too little history for any backtest.');

  const unexplained = candidates.filter((c) => !c.reviewed);
  const status = !bars.length ? 'no data'
    : missing.length || zeroVolume.length || invalid.length || unexplained.length || unhandled.length || splits.some((s) => s.status === 'fail' || s.status === 'no data') ? 'issues' : 'complete';
  return {
    symbol: sym, exchange: entry.exchange, listedFrom, status, notes, warnings,
    bars: { stored: all.length, beforeListing, first: all[0]?.date ?? null, last: all[all.length - 1]?.date ?? null, firstFromListing: bars[0]?.date ?? null },
    sessions: { from: listedFrom, through: lastComplete, expected: expected.length, present: expected.length - missing.length, missing: missing.length, missingSample: missing.slice(0, SAMPLE) },
    zeroVolume: { count: zeroVolume.length, sample: zeroVolume.slice(0, SAMPLE) },
    invalidOhlc: { count: invalid.length, sample: invalid.slice(0, SAMPLE) },
    splits,
    splitScan: { boundaries, ratios: SCAN_RATIOS, tolerancePct: 8, candidates, rule: 'overnight open / previous close within 8% of 1/k (a split) or k (a reverse split), not explained by a recorded split' },
    dividends: { count: dividends.length - ignoredDividends, ignoredBeforeListing: ignoredDividends, withoutPayDate: noPayDate },
    cusips, nameChanges, unhandledActions: unhandled,
    first15: { expected: expected.length, present: expected.length - f15Missing.length, missing: f15Missing.length, missingSample: f15Missing.slice(0, SAMPLE) },
    spreads: { expectedDays: sampleDays.length, sampled: sampleDays.length - spreadMissing.length, withoutUsableQuotes: spreadEmpty.length, missing: spreadMissing.length, missingSample: spreadMissing.slice(0, SAMPLE) },
    _byDate: byDate,
  };
}

// One basket member for one period: complete from the start of its warm-up
// needs (the last `warmupSessions` sessions of its own history before the
// start) through the end, without an unexplained split-like move, a failed
// split check or a corporate action the engine does not model.
function checkMember(info, member, p, { excluded, lastComplete, warmupSessions }) {
  const reasons = [];
  if (member.listedFrom > p.start) reasons.push(`listed from ${member.listedFrom}, after the period start ${p.start}`);
  const histFrom = member.listedFrom > p.warmupFrom ? member.listedFrom : p.warmupFrom;
  const history = sessionsFrom(histFrom, addDays(p.start, -1), excluded);
  if (history.length < warmupSessions) reasons.push(`only ${history.length} session(s) of its own history before ${p.start}; ${warmupSessions} needed`);
  const requiredFrom = history.length >= warmupSessions ? history[history.length - warmupSessions] : (history[0] ?? p.start);
  if (p.end > lastComplete) reasons.push(`the period ends ${p.end}, after the last completed session ${lastComplete}`);
  const through = p.end < lastComplete ? p.end : lastComplete;
  const range = sessionsFrom(requiredFrom, through, excluded);
  const missing = range.filter((d) => !info._byDate.has(d));
  if (missing.length) reasons.push(`${missing.length} of ${range.length} session(s) missing from ${requiredFrom} to ${through} (first ${missing[0]})`);
  const inRange = (d) => d > requiredFrom && d <= p.end;
  const within = (d) => d >= requiredFrom && d <= p.end;
  const zero = info.zeroVolume.count ? range.filter((d) => { const b = info._byDate.get(d); return b && !(b.v > 0); }) : [];
  if (zero.length) reasons.push(`${zero.length} zero-volume bar(s) (first ${zero[0]})`);
  const bad = info.invalidOhlc.count ? range.filter((d) => { const b = info._byDate.get(d); return b && badOhlc(b); }) : [];
  if (bad.length) reasons.push(`${bad.length} bar(s) with inconsistent prices (first ${bad[0]})`);
  for (const c of info.splitScan.candidates.filter((x) => !x.reviewed && inRange(x.date))) reasons.push(`unexplained overnight move on ${c.date} (open/previous close ${c.ratio}) looks like ${c.looksLike}`);
  for (const s of info.splits.filter((x) => inRange(x.exDate) && x.status !== 'pass')) reasons.push(`the split on ${s.exDate} (ratio ${s.ratio}) does not check out: ${s.status}`);
  for (const a of info.unhandledActions.filter((x) => within(x.date))) reasons.push(`${a.type.replace('_', ' ')} on ${a.date} is not modelled by the engine`);
  return { symbol: member.symbol, listedFrom: member.listedFrom, historyBeforeStart: history.length, requiredFrom, sessionsChecked: range.length, missing: missing.length, missingSample: missing.slice(0, SAMPLE), ok: !reasons.length, reasons };
}

// readiness(db, { universe, periods, today, reviewed }) -> { today, lastCompleteSession, excludedSessions,
// warmupSessions, symbols: [...], periods: { selection, evaluation, fullList } }. Sessions are
// expected through the last session before `today` (exchange-local date). `reviewed`:
// [{ symbol, date, reason }] overnight moves the owner has checked and recorded as not splits.
export function readiness(db, { universe, periods, today = todayIn(NY), reviewed = [] } = {}) {
  const excluded = new Set(excludedDates(periods));
  const lastComplete = previousTradingDay(today, 'NYSE');
  const warmupSessions = periods.warmupSessions;
  const infos = new Map(universe.symbols.map((e) => [e.symbol, checkSymbol(db, e, { excluded, lastComplete, reviewed })]));
  const out = {};
  for (const k of BACKTEST_PERIODS) {
    const p = periods.periods[k];
    const members = basketSymbols(universe, p.basket).map((m) => checkMember(infos.get(m.symbol), m, p, { excluded, lastComplete, warmupSessions }));
    const usable = members.every((m) => m.ok);
    out[k] = {
      basket: p.basket, warmupFrom: p.warmupFrom, start: p.start, end: p.end, usable, members,
      reasons: members.flatMap((m) => m.reasons.map((r) => `${m.symbol}: ${r}`)),
      costsCalibrated: members.every((m) => infos.get(m.symbol).spreads.sampled > 0),
    };
  }
  const symbols = [...infos.values()].map(({ _byDate, ...rest }) => rest);
  return {
    today, lastCompleteSession: lastComplete, warmupSessions,
    excludedSessions: (periods.excludedSessions || []).map((x) => ({ date: x.date, reason: x.reason })),
    symbols, periods: out,
  };
}
