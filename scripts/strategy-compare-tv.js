// Compare a TradingView Strategy Tester "List of trades" CSV export with the
// Strategy Lab engine's trades on the same chart data. The engine runs in
// TradingView-parity mode (tv_path ambiguity, limit_intrabar entries, one
// symbol), because a TradingView strategy is a single-symbol account.
// Simulation only: nothing here places orders or reads the real portfolio.
//
//   node scripts/strategy-compare-tv.js --trades "List of trades.csv" --data "BATS_NVDA, 15.csv" \
//     [--symbol NVDA] [--config strategy/configs/cb-1.0.0.json] [--mode intraday|swing] \
//     [--format tradingview|generic] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--tz America/New_York] \
//     [--tolerance 15] [--out compare.json]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { zonedToUtc, NY } from '../server/time.js';

const TICK = 0.01;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// ---------- CSV ----------

function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text, delimiter) {
  const src = String(text).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else f += ch;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return { delimiter: d, rows };
}

// "1,234.50", "1.234,50" (decimal comma), "−12.5" (Unicode minus), "$ 10".
export function parseNumber(s, { decimalComma = false } = {}) {
  if (s == null) return null;
  let x = String(s).trim().replace(/[−–]/g, '-').replace(/[\s  ']/g, '').replace(/[^\d,.+-]/g, '');
  if (!x || x === '-' || x === '+') return null;
  const lc = x.lastIndexOf(','), ld = x.lastIndexOf('.');
  if (lc > -1 && ld > -1) x = lc > ld ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (lc > -1) x = decimalComma || !/^[+-]?\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, (m, i) => (i === lc ? '.' : '')) : x.replace(/,/g, '');
  else if (decimalComma && /^[+-]?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, '');
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Wall-clock time in the chart's zone (TradingView exports the chart's time
// zone, the exchange's by default) → UTC ISO. Explicit offsets are honoured.
export function parseTvTime(s, tz = NY) {
  const v = String(s ?? '').trim();
  if (!v) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v) && /\d{4}-\d{2}-\d{2}T/.test(v)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return zonedToUtc(`${m[1]}-${m[2]}-${m[3]}`, +m[4], +m[5], tz).toISOString();
  m = v.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const date = `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return zonedToUtc(date, +m[4], +m[5], tz).toISOString();
  }
  return null;
}

// ---------- TradingView "List of trades" ----------

const norm = (h) => String(h).replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Header names differ by TradingView version and locale; first match wins.
const COLUMNS = {
  trade: (h) => /^trade ?(#|no\.?|number|num)?$/.test(h),
  type: (h) => h === 'type',
  signal: (h) => h === 'signal',
  time: (h) => /^(date ?\/ ?time|date and time|date & time|date\/time|datetime|date time|time)$/.test(h),
  price: (h) => /^price( [a-z]{3})?$/.test(h),
  qty: (h) => /^(contracts|quantity|qty|shares|size|position size \(qty\)|size \(qty\))$/.test(h),
  profit: (h) => /^(net )?(profit|p&l|p & l|pnl)( [a-z]{3})?$/.test(h),
};

export function mapColumns(header) {
  const hs = header.map(norm);
  const out = {}, idx = {};
  for (const [k, test] of Object.entries(COLUMNS)) {
    const i = hs.findIndex((h, j) => test(h) && !Object.values(idx).includes(j));
    if (i >= 0) { idx[k] = i; out[k] = hs[i]; }
  }
  return { idx, names: out };
}

// Returns { trades: [{ n, side, signal, exitSignal, entryAt, entryPrice, exitAt,
// exitPrice, qty, profit, open }], columns, warnings }.
export function parseTvTradesCsv(text, { tz = NY } = {}) {
  const { delimiter, rows } = parseCsv(text);
  if (!rows.length) throw new Error('The list-of-trades file is empty');
  const { idx, names } = mapColumns(rows[0]);
  const need = ['trade', 'type', 'time', 'price'];
  const missing = need.filter((k) => idx[k] == null);
  if (missing.length) {
    throw new Error(`Not a TradingView "List of trades" export: no ${missing.map((k) => ({ trade: '"Trade #"', type: '"Type"', time: '"Date/Time"', price: '"Price"' })[k]).join(', ')} column (found: ${rows[0].map(norm).join(', ')})`);
  }
  const decimalComma = delimiter === ';';
  const num = (r, k) => (idx[k] == null ? null : parseNumber(r[idx[k]], { decimalComma }));
  const byN = new Map();
  const warnings = [];
  for (const [line, r] of rows.slice(1).entries()) {
    const n = parseInt(String(r[idx.trade]).trim(), 10);
    const type = norm(r[idx.type] ?? '');
    if (!Number.isFinite(n) || !/entry|exit/.test(type)) { warnings.push(`row ${line + 2}: skipped (no trade number or type)`); continue; }
    const at = parseTvTime(r[idx.time], tz);
    if (!at) throw new Error(`row ${line + 2}: cannot read the date/time "${r[idx.time]}"`);
    const t = byN.get(n) || { n, side: null, signal: null, exitSignal: null, entryAt: null, entryPrice: null, exitAt: null, exitPrice: null, qty: null, profit: null, open: false };
    t.side = /short/.test(type) ? 'short' : 'long';
    const sig = idx.signal != null ? String(r[idx.signal] ?? '').trim() : null;
    if (/entry/.test(type)) {
      Object.assign(t, { entryAt: at, entryPrice: num(r, 'price'), signal: sig });
    } else {
      Object.assign(t, { exitAt: at, exitPrice: num(r, 'price'), exitSignal: sig, open: /^open$/i.test(sig || '') });
    }
    t.qty ??= num(r, 'qty');
    t.profit ??= num(r, 'profit');
    byN.set(n, t);
  }
  const trades = [...byN.values()].filter((t) => t.entryAt).sort((a, b) => a.n - b.n);
  for (const t of byN.values()) if (!t.entryAt) warnings.push(`trade ${t.n}: no entry row`);
  return { trades, columns: names, delimiter, warnings };
}

// ---------- comparison ----------

const minutes = (a, b) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 60000) : null);
const diff = (a, b) => (a != null && b != null ? +(a - b).toFixed(6) : null);

// Each TradingView trade is matched to the unmatched engine trade with the
// same entry time, else the nearest entry within toleranceMinutes.
export function compareTrades(tvTrades, engineTrades, { toleranceMinutes = 15 } = {}) {
  const tol = toleranceMinutes * 60000;
  const eng = engineTrades.map((t) => ({ t, ms: Date.parse(t.entry?.at) })).sort((a, b) => a.ms - b.ms);
  const used = new Set();
  const matched = [], unmatchedTv = [];
  for (const x of [...tvTrades].sort((a, b) => Date.parse(a.entryAt) - Date.parse(b.entryAt))) {
    const ms = Date.parse(x.entryAt);
    let best = null;
    for (let i = 0; i < eng.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(eng[i].ms - ms);
      if (d <= tol && (!best || d < best.d)) best = { i, d };
    }
    if (!best) { unmatchedTv.push(x); continue; }
    used.add(best.i);
    const e = eng[best.i].t;
    matched.push({
      tv: x.n, engine: e.id, symbol: e.symbol,
      tvEntryAt: x.entryAt, engineEntryAt: e.entry?.at, entryTimeDiffMin: minutes(e.entry?.at, x.entryAt),
      tvEntryPrice: x.entryPrice, engineEntryPrice: e.entry?.raw, entryPriceDiff: diff(e.entry?.raw, x.entryPrice),
      tvExitAt: x.exitAt, engineExitAt: e.exit?.at, exitTimeDiffMin: minutes(e.exit?.at, x.exitAt),
      tvExitPrice: x.exitPrice, engineExitPrice: e.exit?.raw, exitPriceDiff: diff(e.exit?.raw, x.exitPrice),
      tvQty: x.qty, engineQty: e.entry?.shares, tvExitSignal: x.exitSignal, engineExitReason: e.exit?.reason,
      tvProfit: x.profit, engineNet: e.pnl?.net, tvOpen: x.open,
      engineFlags: [...(e.entry?.flags || []), ...(e.exit?.ambiguous ? ['ambiguous_exit'] : [])],
    });
  }
  const unmatchedEngine = eng.filter((_, i) => !used.has(i)).map((x) => x.t);
  const absMax = (k) => matched.reduce((m, r) => (r[k] == null ? m : Math.max(m, Math.abs(r[k]))), 0);
  const within = (k) => matched.filter((r) => r[k] != null && Math.abs(r[k]) <= TICK / 2 + 1e-9).length;
  return {
    matched, unmatchedTv, unmatchedEngine,
    summary: {
      tvTrades: tvTrades.length, engineTrades: engineTrades.length, matched: matched.length,
      unmatchedTv: unmatchedTv.length, unmatchedEngine: unmatchedEngine.length, toleranceMinutes,
      exactEntryTime: matched.filter((r) => r.entryTimeDiffMin === 0).length,
      exactExitTime: matched.filter((r) => r.exitTimeDiffMin === 0).length,
      entryPriceWithinHalfTick: within('entryPriceDiff'), exitPriceWithinHalfTick: within('exitPriceDiff'),
      sameQuantity: matched.filter((r) => r.tvQty != null && r.tvQty === r.engineQty).length,
      maxAbsEntryPriceDiff: absMax('entryPriceDiff'), maxAbsExitPriceDiff: absMax('exitPriceDiff'),
      maxAbsEntryTimeDiffMin: absMax('entryTimeDiffMin'), maxAbsExitTimeDiffMin: absMax('exitTimeDiffMin'),
    },
  };
}

function printComparison(c, symbol) {
  const s = c.summary;
  console.log(`TradingView vs engine (TradingView-parity mode), ${symbol}: ${s.tvTrades} TradingView trades, ${s.engineTrades} engine trades, ${s.matched} matched (entry within ${s.toleranceMinutes} min).`);
  console.log(`  same entry time ${s.exactEntryTime}/${s.matched}, same exit time ${s.exactExitTime}/${s.matched}; entry price within half a tick ${s.entryPriceWithinHalfTick}, exit price ${s.exitPriceWithinHalfTick}; same quantity ${s.sameQuantity}.`);
  console.log(`  largest differences: entry ${s.maxAbsEntryPriceDiff} (price) / ${s.maxAbsEntryTimeDiffMin} min, exit ${s.maxAbsExitPriceDiff} (price) / ${s.maxAbsExitTimeDiffMin} min.`);
  const diffs = c.matched.filter((r) => r.entryTimeDiffMin || r.exitTimeDiffMin || Math.abs(r.entryPriceDiff ?? 0) > TICK / 2 || Math.abs(r.exitPriceDiff ?? 0) > TICK / 2);
  for (const r of diffs.slice(0, 30)) {
    console.log(`  #${r.tv}: entry ${r.tvEntryAt} @ ${r.tvEntryPrice} vs ${r.engineEntryAt} @ ${r.engineEntryPrice}; exit ${r.tvExitAt} @ ${r.tvExitPrice} (${r.tvExitSignal}) vs ${r.engineExitAt} @ ${r.engineExitPrice} (${r.engineExitReason})${r.engineFlags.length ? ` [${r.engineFlags.join(', ')}]` : ''}`);
  }
  if (diffs.length > 30) console.log(`  … ${diffs.length - 30} more in the JSON output`);
  for (const t of c.unmatchedTv.slice(0, 20)) console.log(`  only in TradingView: #${t.n} entry ${t.entryAt} @ ${t.entryPrice}, exit ${t.exitAt ?? 'open'} @ ${t.exitPrice ?? '—'}`);
  for (const t of c.unmatchedEngine.slice(0, 20)) console.log(`  only in the engine: ${t.id} entry ${t.entry?.at} @ ${t.entry?.raw}, exit ${t.exit?.at} @ ${t.exit?.raw} (${t.exit?.reason})`);
}

// ---------- command line ----------

const USAGE = `Usage: node scripts/strategy-compare-tv.js --trades <TradingView list-of-trades.csv> --data <chart CSV or bars .json>
  [--symbol SYM] [--config strategy/configs/cb-1.0.0.json] [--mode intraday|swing] [--format tradingview|generic]
  [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--tz America/New_York] [--tolerance 15] [--out compare.json]
Times in the export are read in --tz (TradingView writes the chart's time zone; the exchange's by default).`;

export async function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({
    args: argv, allowPositionals: false,
    options: {
      trades: { type: 'string' }, data: { type: 'string' }, symbol: { type: 'string' }, config: { type: 'string' },
      mode: { type: 'string', default: 'intraday' }, format: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
      tz: { type: 'string', default: NY }, tolerance: { type: 'string', default: '15' }, out: { type: 'string' }, help: { type: 'boolean' },
    },
  });
  if (a.help || !a.trades || !a.data) { (a.help ? console.log : console.error)(USAGE); return a.help ? 0 : 2; }
  if (!['intraday', 'swing'].includes(a.mode)) { console.error(`--mode must be intraday or swing\n${USAGE}`); return 2; }
  const { loadStrategyConfig, DEFAULT_CONFIG_PATH } = await import('../server/strategy/config.js');
  const { loadBars } = await import('./strategy-backtest.js');
  const { runBacktest } = await import('../server/strategy/engine.js');

  const tv = parseTvTradesCsv(fs.readFileSync(a.trades, 'utf8'), { tz: a.tz });
  const config = loadStrategyConfig(a.config || DEFAULT_CONFIG_PATH);
  const data = await loadBars(a.data, { format: a.format, symbols: a.symbol ? [a.symbol.toUpperCase()] : null, from: a.from, to: a.to, anySymbol: true });
  const symbol = a.symbol?.toUpperCase() || [...data.bars.keys()][0];
  if (!symbol || !data.bars.get(symbol)?.length) { console.error(`No bars for ${symbol || 'any symbol'} in ${a.data}`); return 2; }
  if (data.bars.size > 1 && !a.symbol) { console.error(`The data has several symbols (${[...data.bars.keys()].join(', ')}); choose one with --symbol`); return 2; }
  const list = data.bars.get(symbol);
  const from = a.from || list[0].t.slice(0, 10), to = a.to || list[list.length - 1].t.slice(0, 10);
  const run = await runBacktest({
    config, mode: a.mode, bars: new Map([[symbol, list]]), symbols: [symbol], from, to, tradeFrom: from,
    overrides: { ambiguity: 'tv_path', entryFill: 'limit_intrabar' },
  });
  const c = compareTrades(tv.trades, run.trades || [], { toleranceMinutes: Number(a.tolerance) });
  if (data.synthetic) console.log('SYNTHETIC DATA — tests the code, says nothing about the strategy');
  console.log(`Simulation only. Engine ${run.meta?.engineVersion ?? ''} config ${config.version} (${run.meta?.configHash ?? ''}), data hash ${data.dataHash ?? '—'}, ${from} to ${to}, mode ${a.mode}.`);
  if (tv.warnings.length) console.log(`Export warnings: ${tv.warnings.slice(0, 5).join('; ')}${tv.warnings.length > 5 ? ' …' : ''}`);
  printComparison(c, symbol);
  if (a.out) {
    fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
    fs.writeFileSync(a.out, `${JSON.stringify({ symbol, mode: a.mode, from, to, tz: a.tz, configHash: run.meta?.configHash ?? null, dataHash: data.dataHash ?? null, synthetic: !!data.synthetic, columns: tv.columns, ...c }, null, 2)}\n`);
    console.log(`Written: ${a.out}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
