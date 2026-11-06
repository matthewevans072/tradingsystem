// event-swing's market data: HXR's stored Alpaca SIP raw daily bars, splits, cash dividends and spread samples,
// read-only by real path, with the window's bound inside every SQL query (CAMPAIGN-1.md section 2; DATA-INVENTORY.md
// section 6), so no row dated after 2021-12-31 is ever read. The engine inputs have the shape HXR's buildInputs
// gives (sessions, days of { bars, splits, dividends }); the spread table follows HXR's method (hxr-spread-2), built
// from samples on or before the bound, so every fill in the window costs what campaign 3's table gives.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tradingDays } from '../strategy/sessions.js';
import { canonicalJson } from '../strategy/config.js';
import { SPREAD_METHOD, halfSpreadFn, median } from '../hxr/data.js';
import { HXR_DB_NAME } from '../hxr/store.js';
import { WINDOW, MAX_DATE, EsError } from './config.js';

export const INPUTS_METHOD = 'es-inputs-1';
const round = (x, dp = 6) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Opens <dataDir>/hxr-sim.sqlite read-only, refusing a link or anything that is not that file.
export function openHxrReadOnly(dataDir) {
  const file = path.join(dataDir, HXR_DB_NAME);
  if (!fs.existsSync(file)) throw new EsError(409, `No HXR market data at ${HXR_DB_NAME}`);
  const real = fs.realpathSync(file);
  if (real !== path.join(fs.realpathSync(dataDir), HXR_DB_NAME)) throw new EsError(409, `${HXR_DB_NAME} must be the file itself, not a link`);
  return new DatabaseSync(real, { readOnly: true });
}

// The bounded inputs. universe: [{ symbol, exchange, listedFrom }]. excluded: session dates removed for every stock.
export function loadWindowInputs(hdb, { universe, from = WINDOW.from, to = MAX_DATE, excluded = [] }) {
  if (to > MAX_DATE) throw new EsError(500, `inputs end ${to} is after the bound ${MAX_DATE}`);
  const ex = new Set(excluded);
  const sessions = tradingDays(from, to, 'NYSE').filter((d) => !ex.has(d));
  const sessionSet = new Set(sessions);
  const days = new Map(sessions.map((d) => [d, { bars: {}, splits: [], dividends: [] }]));
  const coverage = {}, warnings = [];
  const bars = hdb.prepare('SELECT date, o, h, l, c, v FROM hxr_bars WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date');
  const splits = hdb.prepare("SELECT id, ex_date, ratio_old, ratio_new FROM hxr_corporate_actions WHERE symbol = ? AND type IN ('forward_split', 'reverse_split') AND ex_date >= ? AND ex_date <= ? ORDER BY ex_date, id");
  const divs = hdb.prepare("SELECT id, ex_date, pay_date, rate FROM hxr_corporate_actions WHERE symbol = ? AND type = 'cash_dividend' AND ex_date >= ? AND ex_date <= ? ORDER BY ex_date, id");
  const onOrAfter = (d) => { let lo = 0, hi = sessions.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sessions[m] < d) lo = m + 1; else hi = m; } return lo < sessions.length ? sessions[lo] : null; };
  for (const u of universe) {
    const sym = u.symbol, start = u.listedFrom > from ? u.listedFrom : from;
    const cov = { listedFrom: u.listedFrom, bars: 0, excludedSessions: 0, nonSessions: 0, splits: 0, dividends: 0, first: null, last: null };
    for (const b of bars.all(sym, start, to)) {
      if (ex.has(b.date)) { cov.excludedSessions++; continue; }
      if (!sessionSet.has(b.date)) { cov.nonSessions++; continue; }
      days.get(b.date).bars[sym] = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? null };
      cov.bars++; cov.first ??= b.date; cov.last = b.date;
    }
    const seenSplit = new Map();
    for (const s of splits.all(sym, u.listedFrom, to)) {
      const ratio = s.ratio_new / s.ratio_old;
      if (!Number.isFinite(ratio) || !(ratio > 0) || ratio === 1) { warnings.push(`${sym}: split ${s.id} on ${s.ex_date} has no usable ratio; ignored`); continue; }
      if (seenSplit.has(s.ex_date)) { if (Math.abs(seenSplit.get(s.ex_date) - ratio) > 1e-12) throw new EsError(500, `${sym}: two different splits on ${s.ex_date}`); continue; }
      seenSplit.set(s.ex_date, ratio);
      if (s.ex_date < from) continue;
      const d = onOrAfter(s.ex_date);
      if (!d) continue;
      days.get(d).splits.push({ symbol: sym, ratio, id: s.id, ...(d !== s.ex_date ? { declaredExDate: s.ex_date } : {}) });
      cov.splits++;
    }
    const seenDiv = new Set();
    for (const a of divs.all(sym, u.listedFrom > from ? u.listedFrom : from, to)) {
      if (seenDiv.has(a.id)) continue;
      seenDiv.add(a.id);
      if (!(Number.isFinite(a.rate) && a.rate > 0)) { warnings.push(`${sym}: dividend ${a.id} on ${a.ex_date} has no usable amount; ignored`); continue; }
      const d = onOrAfter(a.ex_date);
      if (!d) continue;
      days.get(d).dividends.push({ symbol: sym, exDate: d, payDate: a.pay_date || a.ex_date, amount: a.rate, id: a.id, ...(d !== a.ex_date ? { declaredExDate: a.ex_date } : {}) });
      cov.dividends++;
    }
    coverage[sym] = cov;
  }
  const order = new Map(universe.map((u, i) => [u.symbol, i]));
  const byOrder = (a, b) => order.get(a.symbol) - order.get(b.symbol) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const day of days.values()) { day.splits.sort(byOrder); day.dividends.sort(byOrder); }
  const h = crypto.createHash('sha256');
  h.update(canonicalJson({ method: INPUTS_METHOD, symbols: universe.map((u) => ({ symbol: u.symbol, exchange: u.exchange ?? null, listedFrom: u.listedFrom })), from, to, excluded: [...ex].sort() }));
  for (const d of sessions) {
    const day = days.get(d);
    h.update(`\n${canonicalJson([d, universe.map((u) => { const b = day.bars[u.symbol]; return b ? [b.o, b.h, b.l, b.c, b.v] : null; }), day.splits, day.dividends])}`);
  }
  const stockSessions = Object.fromEntries(universe.map((u) => [u.symbol, sessions.filter((d) => days.get(d).bars[u.symbol])]));
  return { symbols: universe.map((u) => ({ symbol: u.symbol, exchange: u.exchange ?? null, listedFrom: u.listedFrom })), sessions, days, stockSessions, coverage, warnings, inputsHash: h.digest('hex') };
}

// HXR's spread table (hxr-spread-2), built from samples dated on or before the bound only. Identical to HXR's
// buildSpreadTable on a store that holds no later sample; on a store that does, every lookup on or before the bound
// is identical (a fill uses only samples dated on or before it), which tests/eventswing-data.test.js checks.
export function boundedSpreadTable(hdb, universe, { floorBps, to = MAX_DATE } = {}) {
  if (!Number.isFinite(floorBps) || floorBps < 0) throw new EsError(500, 'boundedSpreadTable needs floorBps');
  const q = hdb.prepare('SELECT date, median_half_spread_bps AS m FROM hxr_spread_samples WHERE symbol = ? AND date <= ? ORDER BY date');
  const table = {}, steps = {}, firstSampled = {};
  const toYear = Number(to.slice(0, 4));
  for (const s of universe) {
    const samples = q.all(s.symbol, to).filter((x) => x.date >= s.listedFrom && Number.isFinite(x.m));
    const byYear = new Map(), row = [];
    for (const x of samples) {
      const y = Number(x.date.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(x.m);
      row.push([x.date, round(Math.max(median(byYear.get(y)), floorBps))]);
    }
    steps[s.symbol] = row;
    firstSampled[s.symbol] = samples[0]?.date ?? null;
    const first = Number(s.listedFrom.slice(0, 4));
    const last = Math.max(first, toYear, ...byYear.keys());
    const years = {};
    let carry = null;
    for (let y = first; y <= last; y++) { if (byYear.has(y)) carry = round(Math.max(median(byYear.get(y)), floorBps)); years[y] = carry ?? floorBps; }
    table[s.symbol] = years;
  }
  const hash = sha(canonicalJson({ method: SPREAD_METHOD, floorBps, table, steps, firstSampled }));
  return { table, steps, firstSampled, floorBps, hash, bound: to };
}
export { halfSpreadFn };

// A close lookup in post-split units as of a given session: closes before a later split are divided by the ratio.
export function closeLookup(inputs) {
  const splitsBy = new Map();
  for (const d of inputs.sessions) for (const s of inputs.days.get(d).splits) { if (!splitsBy.has(s.symbol)) splitsBy.set(s.symbol, []); splitsBy.get(s.symbol).push([d, s.ratio]); }
  return (asOf) => (symbol, date) => {
    const b = inputs.days.get(date)?.bars?.[symbol];
    if (!b) return null;
    let c = b.c;
    for (const [d, r] of splitsBy.get(symbol) || []) if (d > date && d <= asOf) c /= r;
    return c;
  };
}
