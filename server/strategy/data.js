// Bar data for the Strategy Lab (ENGINE-SPEC §1): CSV parsing (TradingView
// "Export chart data" and generic OHLCV files), normalisation to regular-session
// 15-minute bars, the data-quality report and the dataset hash.
import crypto from 'node:crypto';
import { zonedToUtc, NY } from '../time.js';
import { barInfo, sessionBounds, tradingDays, localDate, expectedBarsInSession } from './sessions.js';
import { volumeOf } from './boxes.js';

const MIN = 60000;

// ---------- CSV ----------

function detectDelimiter(line) {
  let best = ',', n = -1;
  for (const d of [',', ';', '\t']) {
    const c = line.split(d).length;
    if (c > n) { n = c; best = d; }
  }
  return best;
}

// RFC 4180-style rows (quoted fields, doubled quotes, CRLF), with line numbers.
export function parseCsvRows(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const nl = src.indexOf('\n');
  const d = detectDelimiter(nl < 0 ? src : src.slice(0, nl));
  const rows = [];
  let row = [], field = '', q = false, line = 1, rowLine = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else { if (ch === '\n') line++; field += ch; }
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push({ line: rowLine, fields: row });
      row = []; line++; rowLine = line;
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push({ line: rowLine, fields: row });
  return { delimiter: d, rows };
}

const normHeader = (h) => String(h).trim().toLowerCase().replace(/^"|"$/g, '');

function num(s) {
  if (s == null) return NaN;
  const t = String(s).trim().replace(/,/g, '');
  return t === '' ? NaN : Number(t);
}

// Times: UNIX seconds (or milliseconds), ISO with Z/offset (absolute), or a
// naive local date-time, read in `tz` (the exchange's zone).
export function parseTime(raw, tz = NY) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 1e11 ? Math.round(n) : Math.round(n * 1000);
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const [, y, mo, d, hh = '0', mm = '0', ss = '0', off] = m;
    if (off) {
      const o = off.toUpperCase() === 'Z' ? 'Z' : off.includes(':') ? off : `${off.slice(0, 3)}:${off.slice(3)}`;
      return Date.parse(`${y}-${mo}-${d}T${hh.padStart(2, '0')}:${mm}:${ss.padStart(2, '0')}${o}`);
    }
    return zonedToUtc(`${y}-${mo}-${d}`, +hh, +mm, tz).getTime() + +ss * 1000;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    const [, mo, d, y, hh = '0', mm = '0', ss = '0', ap] = m;
    let h = +hh;
    if (ap) h = (h % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0);
    return zonedToUtc(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, h, +mm, tz).getTime() + +ss * 1000;
  }
  return NaN;
}

function clockPart(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = +m[1];
  if (m[4]) h = (h % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

function toBars(rows, header, cols, timeOf) {
  const bars = [], rejected = [];
  for (const { line, fields } of rows) {
    const t = timeOf(fields);
    const o = num(fields[cols.open]), h = num(fields[cols.high]), l = num(fields[cols.low]), c = num(fields[cols.close]);
    if (!Number.isFinite(t)) { rejected.push({ line, reason: 'unreadable time' }); continue; }
    if (![o, h, l, c].every(Number.isFinite)) { rejected.push({ line, reason: 'unreadable price' }); continue; }
    const vRaw = cols.volume >= 0 ? num(fields[cols.volume]) : NaN;
    bars.push({ t: new Date(t).toISOString(), o, h, l, c, v: Number.isFinite(vRaw) && vRaw > 0 ? vRaw : null });
  }
  return { bars, rejected };
}

function findCol(header, names) {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

// TradingView "Export chart data": time (UNIX seconds or ISO), open, high,
// low, close, Volume, then any indicator columns (ignored).
export function parseTradingViewCsv(text, { timezone = NY } = {}) {
  const { rows, delimiter } = parseCsvRows(text);
  if (!rows.length) throw new Error('The CSV file is empty');
  const header = rows[0].fields.map(normHeader);
  const cols = {
    time: findCol(header, ['time', 'timestamp', 'datetime', 'date']),
    open: findCol(header, ['open']), high: findCol(header, ['high']), low: findCol(header, ['low']), close: findCol(header, ['close']),
    volume: findCol(header, ['volume', 'vol']),
  };
  const missing = ['time', 'open', 'high', 'low', 'close'].filter((k) => cols[k] < 0);
  if (missing.length) throw new Error(`Not a TradingView chart export: missing ${missing.join(', ')} column(s) (found ${header.join(', ')})`);
  const body = rows.slice(1);
  const sample = body[0]?.fields[cols.time]?.trim() || '';
  const { bars, rejected } = toBars(body, header, cols, (f) => parseTime(f[cols.time], timezone));
  return {
    format: 'tradingview', delimiter, columns: Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, i >= 0 ? rows[0].fields[i].trim() : null])),
    timeFormat: /^\d+(\.\d+)?$/.test(sample) ? 'unix' : 'iso', volumeColumn: cols.volume >= 0, bars, rejected,
  };
}

// Generic OHLCV CSV: timestamp | datetime | date + time, open, high, low,
// close, volume. Times without a zone or offset are exchange-local.
export function parseGenericCsv(text, { timezone = NY } = {}) {
  const { rows, delimiter } = parseCsvRows(text);
  if (!rows.length) throw new Error('The CSV file is empty');
  const header = rows[0].fields.map(normHeader);
  const cols = {
    stamp: findCol(header, ['timestamp', 'datetime', 'date_time', 'date/time', 'time_stamp']),
    date: findCol(header, ['date', 'day']), time: findCol(header, ['time', 'clock']),
    open: findCol(header, ['open', 'o']), high: findCol(header, ['high', 'h']), low: findCol(header, ['low', 'l']), close: findCol(header, ['close', 'c', 'last']),
    volume: findCol(header, ['volume', 'vol', 'v']),
  };
  let timeOf, how;
  if (cols.stamp >= 0) { timeOf = (f) => parseTime(f[cols.stamp], timezone); how = header[cols.stamp]; }
  else if (cols.date >= 0 && cols.time >= 0) {
    timeOf = (f) => {
      const c = clockPart(f[cols.time]);
      return c ? parseTime(`${String(f[cols.date]).trim()} ${c}`, timezone) : parseTime(f[cols.time], timezone);
    };
    how = 'date + time';
  } else if (cols.time >= 0) { timeOf = (f) => parseTime(f[cols.time], timezone); how = header[cols.time]; }
  else if (cols.date >= 0) { timeOf = (f) => parseTime(f[cols.date], timezone); how = header[cols.date]; }
  const missing = ['open', 'high', 'low', 'close'].filter((k) => cols[k] < 0);
  if (!timeOf) missing.unshift('timestamp (or date and time)');
  if (missing.length) throw new Error(`CSV is missing ${missing.join(', ')} column(s) (found ${header.join(', ')})`);
  const { bars, rejected } = toBars(rows.slice(1), header, cols, timeOf);
  return { format: 'generic', delimiter, timeColumns: how, timezone, volumeColumn: cols.volume >= 0, bars, rejected };
}

// ---------- normalisation ----------

function barProblem(b) {
  if (![b.o, b.h, b.l, b.c].every(Number.isFinite)) return 'non-numeric price';
  if (b.o <= 0 || b.h <= 0 || b.l <= 0 || b.c <= 0) return 'non-positive price';
  if (b.h < b.l) return 'high below low';
  if (b.o > b.h || b.o < b.l || b.c > b.h || b.c < b.l) return 'open or close outside the high-low range';
  return null;
}

// Most common gap (minutes) between consecutive bars of the same session.
function detectInterval(sorted, exchange) {
  const counts = new Map();
  for (let i = 1; i < sorted.length; i++) {
    const d = (sorted[i].ms - sorted[i - 1].ms) / MIN;
    if (d > 0 && d <= 60 && localDate(sorted[i].ms, exchange) === localDate(sorted[i - 1].ms, exchange)) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [d, c] of counts) if (c > n || (c === n && d < best)) { best = d; n = c; }
  return best;
}

// rawBars [{ t (ISO or ms), o, h, l, c, v }] → regular-session bars of
// `intervalMinutes`: pre/post-market bars dropped, 1- or 5-minute input
// aggregated (a bucket missing any sub-bar is dropped), duplicates removed.
export function normalizeBars(rawBars, { exchange = 'NYSE', intervalMinutes = 15, inputIntervalMinutes = null } = {}) {
  const dropped = { invalid: 0, duplicates: 0, conflictingDuplicates: 0, outsideSession: 0, misaligned: 0, incompleteBuckets: 0 };
  const rows = [];
  for (const r of rawBars || []) {
    const ms = typeof r.t === 'number' ? r.t : r.t instanceof Date ? r.t.getTime() : Date.parse(r.t);
    const b = { ms, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: volumeOf(r.v) };
    if (!Number.isFinite(ms) || barProblem(b)) { dropped.invalid++; continue; }
    rows.push(b);
  }
  rows.sort((a, b) => a.ms - b.ms);
  const uniq = [];
  for (const b of rows) {
    const p = uniq[uniq.length - 1];
    if (p && p.ms === b.ms) {
      dropped.duplicates++;
      if (p.o !== b.o || p.h !== b.h || p.l !== b.l || p.c !== b.c || p.v !== b.v) dropped.conflictingDuplicates++;
      continue;
    }
    uniq.push(b);
  }
  const inputInterval = inputIntervalMinutes || detectInterval(uniq, exchange) || intervalMinutes;
  if (inputInterval > intervalMinutes || intervalMinutes % inputInterval !== 0) {
    throw new Error(`Bars ${inputInterval} minutes apart cannot be turned into ${intervalMinutes}-minute bars`);
  }
  const inSession = [];
  for (const b of uniq) {
    const bi = barInfo(b.ms, exchange, inputInterval);
    if (!bi.inSession) { dropped.outsideSession++; continue; }
    if (!bi.aligned) { dropped.misaligned++; continue; }
    inSession.push({ ...b, openMs: bi.openMs });
  }
  const out = [];
  const iso = (ms) => new Date(ms).toISOString();
  if (inputInterval === intervalMinutes) {
    for (const b of inSession) out.push({ t: iso(b.ms), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  } else {
    const per = intervalMinutes / inputInterval, step = intervalMinutes * MIN;
    let cur = null;
    const flush = () => {
      if (!cur) return;
      if (cur.n !== per) { dropped.incompleteBuckets++; return; }
      out.push({ t: iso(cur.ms), o: cur.o, h: cur.h, l: cur.l, c: cur.c, v: cur.v });
    };
    for (const b of inSession) {
      const bucket = b.openMs + Math.floor((b.ms - b.openMs) / step) * step;
      if (!cur || cur.ms !== bucket) {
        flush();
        cur = barInfo(bucket, exchange, intervalMinutes).inSession ? { ms: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: 1 } : null;
        if (!cur) dropped.outsideSession++;
        continue;
      }
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.n++;
      cur.v = cur.v == null || b.v == null ? null : cur.v + b.v;
    }
    flush();
  }
  return { bars: out, exchange, intervalMinutes, inputIntervalMinutes: inputInterval, dropped };
}

// ---------- quality ----------

export function qualityReport(bars, { exchange = 'NYSE', intervalMinutes = 15, bigMovePct = 20, listLimit = 50, excludedDates = [] } = {}) {
  const excluded = new Set(excludedDates);
  const list = bars || [];
  let duplicates = 0, nonPositivePrices = 0, highBelowLow = 0, ohlcOutsideRange = 0, missingVolume = 0, outsideSession = 0, misaligned = 0, unsorted = 0;
  const seen = new Set(), perDay = new Map(), bigMoves = [];
  let prev = null, first = null, last = null;
  for (const b of list) {
    const ms = typeof b.t === 'number' ? b.t : Date.parse(b.t);
    if (prev && ms < prev.ms) unsorted++;
    if (seen.has(ms)) { duplicates++; continue; }
    seen.add(ms);
    if (!(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)) nonPositivePrices++;
    if (b.h < b.l) highBelowLow++;
    else if (b.o > b.h || b.o < b.l || b.c > b.h || b.c < b.l) ohlcOutsideRange++;
    if (volumeOf(b.v) == null) missingVolume++;
    const bi = barInfo(ms, exchange, intervalMinutes);
    if (!bi.inSession) outsideSession++;
    else if (!bi.aligned) misaligned++;
    else perDay.set(bi.date, (perDay.get(bi.date) || 0) + 1);
    if (prev && prev.c > 0 && Math.abs(b.c / prev.c - 1) * 100 > bigMovePct) {
      bigMoves.push({ t: new Date(ms).toISOString(), fromClose: prev.c, close: b.c, pct: (b.c / prev.c - 1) * 100 });
    }
    if (first == null || ms < first) first = ms;
    if (last == null || ms > last) last = ms;
    prev = { ms, c: b.c };
  }
  const firstDate = first != null ? localDate(first, exchange) : null, lastDate = last != null ? localDate(last, exchange) : null;
  // Sessions a splits version excludes for every symbol are not expected.
  const days = firstDate ? tradingDays(firstDate, lastDate, exchange).filter((d) => !excluded.has(d)) : [];
  let expectedBars = 0, presentBars = 0;
  const incomplete = [];
  for (const d of days) {
    const e = expectedBarsInSession(d, exchange, intervalMinutes), p = perDay.get(d) || 0;
    expectedBars += e; presentBars += Math.min(p, e);
    if (p < e) incomplete.push({ date: d, expected: e, present: p, earlyClose: !!sessionBounds(d, exchange)?.earlyClose });
  }
  const missingSessions = incomplete.filter((x) => x.present === 0).length;
  return {
    exchange, intervalMinutes, bars: list.length, firstBar: first != null ? new Date(first).toISOString() : null, lastBar: last != null ? new Date(last).toISOString() : null,
    sessions: days.length, sessionsWithBars: days.length - missingSessions, missingSessions, excludedSessions: [...excluded].filter((d) => firstDate && d >= firstDate && d <= lastDate).sort(),
    expectedBars, presentBars, missingBars: expectedBars - presentBars,
    incompleteSessions: incomplete.length, incompleteSessionList: incomplete.slice(0, listLimit),
    duplicates, unsorted, nonPositivePrices, highBelowLow, ohlcOutsideRange, outsideSession, misaligned,
    missingVolume, missingVolumePct: list.length ? (missingVolume / list.length) * 100 : 0,
    bigMoves: bigMoves.length, bigMovePct, bigMoveList: bigMoves.slice(0, listLimit),
    ok: duplicates + unsorted + nonPositivePrices + highBelowLow + ohlcOutsideRange + outsideSession + misaligned === 0 && expectedBars === presentBars,
  };
}

// ---------- excluded sessions ----------

// Removes every bar of the given exchange-local session dates (a splits
// version's excludedSessions) from Map<symbol, Bar[]>. Returns a new Map with
// the same synthetic flags and a count of removed bars per symbol; the input
// is not changed. exchangeOf(symbol) gives the listing for the session date.
export function dropExcludedSessions(barsBySymbol, dates, { exchangeOf = () => 'NYSE' } = {}) {
  const excluded = new Set(dates || []);
  const src = barsBySymbol instanceof Map ? barsBySymbol : new Map(Object.entries(barsBySymbol || {}));
  const out = new Map();
  const removed = {};
  for (const [sym, list] of src) {
    let kept = list;
    if (excluded.size) {
      const ex = exchangeOf(sym) || 'NYSE';
      kept = (list || []).filter((b) => !excluded.has(localDate(typeof b.t === 'number' ? b.t : Date.parse(b.t), ex)));
      if (list?.synthetic) kept.synthetic = true;
      if (kept.length !== (list || []).length) removed[sym] = (list || []).length - kept.length;
    }
    if (kept?.length) out.set(sym, kept);
  }
  if (src.synthetic) out.synthetic = true;
  return { bars: out, removed, dates: [...excluded].sort() };
}

// ---------- hash ----------

// SHA-256 of the normalised bars, symbols in sorted order (a Map or an object).
export function datasetHash(barsBySymbol) {
  const entries = barsBySymbol instanceof Map ? [...barsBySymbol.entries()] : Object.entries(barsBySymbol || {});
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const h = crypto.createHash('sha256');
  for (const [sym, bars] of entries) {
    const lines = [`#${sym}`];
    for (const b of bars || []) {
      const ms = typeof b.t === 'number' ? b.t : Date.parse(b.t);
      lines.push(`${new Date(ms).toISOString()},${b.o},${b.h},${b.l},${b.c},${volumeOf(b.v) ?? ''}`);
    }
    h.update(`${lines.join('\n')}\n`);
  }
  return h.digest('hex');
}
