// Reproducible Strategy Lab backtest from the command line. Simulation only:
// it never places orders and never opens the real portfolio database.
//
//   node scripts/strategy-backtest.js --config strategy/configs/cb-1.0.0.json --data <dir of CSVs | bars .json>
//     [--format tradingview|generic] [--mode intraday|swing|both]
//     [--split development|validation|walk-forward|stress|holdout|all  (comma-separated list allowed)]
//     [--holdout-reason "..."] [--synthetic --seed N] [--symbols A,B] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//     [--out <dir>] [--lower-tf <dir of 1-minute CSVs>]
//
// Writes <out>/report.json and <out>/report.md and prints the config and data
// hashes needed to reproduce the run. The holdout is never part of "all": it is
// run once per strategy version, only when asked for by name, and recorded in
// <out>/holdout-ledger.json (synthetic runs use a separate ledger file).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadStrategyConfig, configHash, loadUniverse, loadSplits, loadAcceptance, DEFAULT_CONFIG_PATH, STRATEGY_DIR } from '../server/strategy/config.js';
import { buildRegimes } from '../server/strategy/regimes.js';
import { runSplit, runStress, runWalkForward, runHoldout, createFileLedger, HoldoutRefused } from '../server/strategy/validation.js';
import { buildReport, SYNTHETIC_BANNER } from '../server/strategy/report.js';
import { etDate } from '../server/strategy/metrics.js';
import { NY } from '../server/time.js';

const ROOT = path.resolve(STRATEGY_DIR, '..');
export const DEFAULT_OUT = path.join(ROOT, 'data', 'strategy-lab', 'cli');
const SPLIT_NAMES = ['development', 'validation', 'stress', 'walk-forward', 'holdout'];
const ALL = ['development', 'validation', 'stress', 'walk-forward'];
const EXCHANGE_PREFIXES = new Set(['BATS', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NYSEARCA', 'CBOE', 'XNAS', 'XNYS']);

const USAGE = `Usage: node scripts/strategy-backtest.js --config strategy/configs/cb-1.0.0.json --data <dir of CSVs | bars .json>
  [--format tradingview|generic] [--mode intraday|swing|both] [--split ${[...SPLIT_NAMES, 'all'].join('|')}]
  [--holdout-reason "..."] [--synthetic --seed N] [--symbols A,B] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out <dir>]
  [--lower-tf <dir of 1-minute CSVs>]
"all" runs development, validation, stress and walk-forward. The holdout runs only when named
(--split holdout or --split validation,holdout): once per version, config and mode; a repeat needs
--holdout-reason and is marked contaminated.`;

// ---------- data ----------

// "BATS_NVDA, 15.csv", "NASDAQ:NVDA.csv", "NVDA.csv", "NVDA_15m.csv" → NVDA.
export function symbolFromFilename(name, known = null) {
  let s = path.basename(name).replace(/\.[^.]+$/, '').split(',')[0].replace(/\s*\(\d+\)$/, '').trim();
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  const parts = s.split(/[_\s]+/).filter(Boolean).map((p) => p.toUpperCase());
  if (known) { const hit = parts.find((p) => known.has(p)); if (hit) return hit; }
  if (parts.length > 1 && EXCHANGE_PREFIXES.has(parts[0])) return parts[1];
  return parts[0] || null;
}

function detectFormat(text) {
  const head = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase();
  return /^"?time"?[,;\t]/.test(head) ? 'tradingview' : 'generic';
}

const toMap = (obj) => (obj instanceof Map ? obj : new Map(Array.isArray(obj) ? obj.map((r) => [r.symbol, r.bars]) : Object.entries(obj || {})));

function inDates(list, from, to) {
  if (!from && !to) return list;
  return list.filter((b) => { const d = etDate(b.t); return (!from || d >= from) && (!to || d <= to); });
}

// Loads bars from a directory of CSV files (one symbol per file), one CSV
// file, or a JSON file ({ SYMBOL: bars[] } or { bars: {...}, synthetic, seed }),
// keeps regular-session 15-minute bars (data.js normalizeBars; 1- and 5-minute
// input is aggregated) and returns them with a quality report per symbol and
// the dataset hash. A JSON file marked synthetic stays synthetic.
export async function loadBars(src, { format = null, symbols = null, from = null, to = null, anySymbol = false, exchanges = null, timezone = NY } = {}) {
  const data = await import('../server/strategy/data.js');
  const want = symbols ? new Set(symbols) : null;
  const raw = new Map();
  const skipped = [];
  let synthetic = false, seed = null;
  const parse = (text, file, sym) => {
    const fmt = format || detectFormat(text);
    const p = fmt === 'tradingview' ? data.parseTradingViewCsv(text, { timezone }) : data.parseGenericCsv(text, { timezone });
    if (raw.has(sym)) throw new Error(`Two files for ${sym} in ${src}`);
    raw.set(sym, { list: p.bars, file, format: fmt, rejected: p.rejected?.length || 0 });
  };
  if (fs.statSync(src).isDirectory()) {
    for (const f of fs.readdirSync(src).filter((x) => /\.csv$/i.test(x)).sort()) {
      const sym = symbolFromFilename(f, want);
      if (!sym || (want && !want.has(sym) && !anySymbol)) { skipped.push(f); continue; }
      parse(fs.readFileSync(path.join(src, f), 'utf8'), f, sym);
    }
  } else if (/\.json$/i.test(src)) {
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    synthetic = j.synthetic === true;
    seed = j.seed ?? null;
    for (const [sym, list] of toMap(j.bars ?? j)) {
      if (!Array.isArray(list)) continue;
      if (want && !want.has(sym) && !anySymbol) { skipped.push(sym); continue; }
      raw.set(sym, { list, file: path.basename(src), format: 'json', rejected: 0 });
    }
  } else {
    const sym = (symbols && symbols.length === 1 ? symbols[0] : null) || symbolFromFilename(src, want);
    parse(fs.readFileSync(src, 'utf8'), path.basename(src), sym);
  }
  const bars = new Map(), quality = {};
  for (const [sym, r] of [...raw].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const exchange = exchanges?.get(sym) || 'NYSE';
    const n = data.normalizeBars(r.list, { exchange, intervalMinutes: 15 });
    const list = inDates(n.bars, from, to);
    bars.set(sym, list);
    quality[sym] = { file: r.file, format: r.format, inputIntervalMinutes: n.inputIntervalMinutes, rejectedRows: r.rejected, ...prefixed('dropped', n.dropped), ...scalars(data.qualityReport(list, { exchange })) };
  }
  return { bars, quality, dataHash: data.datasetHash(bars), synthetic, seed, skipped, source: path.resolve(src) };
}

// 1-minute bars grouped by the 15-minute bar they fall in, the engine's lowerTf
// shape (Map<symbol, Map<15-minute bar time, sub-bars>>). Used only to resolve
// bars that touch both the stop and the target.
export async function loadLowerTf(src, { format = null, symbols = null, exchanges = null, timezone = NY } = {}) {
  const data = await import('../server/strategy/data.js');
  const { barInfo } = await import('../server/strategy/sessions.js');
  const want = symbols ? new Set(symbols) : null;
  const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter((x) => /\.csv$/i.test(x)).sort().map((f) => path.join(src, f)) : [src];
  const out = new Map(), flat = new Map();
  for (const f of files) {
    const sym = symbolFromFilename(f, want);
    if (!sym || (want && !want.has(sym))) continue;
    const text = fs.readFileSync(f, 'utf8');
    const p = (format || detectFormat(text)) === 'tradingview' ? data.parseTradingViewCsv(text, { timezone }) : data.parseGenericCsv(text, { timezone });
    const exchange = exchanges?.get(sym) || 'NYSE';
    const n = data.normalizeBars(p.bars, { exchange, intervalMinutes: 1, inputIntervalMinutes: 1 });
    const groups = new Map();
    for (const b of n.bars) {
      const ms = Date.parse(b.t), open = barInfo(ms, exchange, 1).openMs;
      const k = new Date(open + Math.floor((ms - open) / 900000) * 900000).toISOString();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    out.set(sym, groups);
    flat.set(sym, n.bars);
  }
  return { lowerTf: out, dataHash: data.datasetHash(flat), symbols: [...out.keys()] };
}

const scalars = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v == null || typeof v !== 'object'));
const prefixed = (p, o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [`${p}_${k}`, v]));

async function syntheticBars({ symbols, from, to, seed }) {
  const { generateSyntheticBars } = await import('../server/strategy/synthetic.js');
  const { datasetHash, qualityReport } = await import('../server/strategy/data.js');
  const g = await generateSyntheticBars({ symbols, from, to, seed });
  const bars = toMap(g instanceof Map || Array.isArray(g) || !g?.bars ? g : g.bars);
  const quality = {};
  for (const [sym, list] of bars) quality[sym] = { synthetic: true, ...scalars(qualityReport(list)) };
  return { bars, quality, dataHash: datasetHash(bars), synthetic: true, seed, skipped: [], source: `synthetic (seed ${seed}, ${from} to ${to})` };
}

export function dataRequirements(splits, universe) {
  return `No data given. A backtest needs real market data (or --synthetic to test the code only).

${splits.dataRequirements}

Symbols (${universe.name}): ${universe.symbols.map((s) => s.symbol).join(', ')}.
Periods (${splits.name}): warm-up ${splits.warmup.from} to ${splits.warmup.to}, development ${splits.development.from} to ${splits.development.to}, validation ${splits.validation.from} to ${splits.validation.to}, holdout ${splits.holdout.from} to ${splits.holdout.to}.

Give --data a directory with one CSV per symbol (a TradingView chart export such as "BATS_NVDA, 15.csv",
or a generic CSV with time/open/high/low/close/volume columns), or a JSON file { "NVDA": [{ "t", "o", "h", "l", "c", "v" }, ...] }.`;
}

// ---------- run ----------

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv, allowPositionals: false,
    options: {
      config: { type: 'string' }, data: { type: 'string' }, format: { type: 'string' }, mode: { type: 'string', default: 'both' },
      split: { type: 'string', default: 'all' }, 'holdout-reason': { type: 'string' }, synthetic: { type: 'boolean' }, seed: { type: 'string' },
      symbols: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, out: { type: 'string' },
      universe: { type: 'string' }, splits: { type: 'string' }, acceptance: { type: 'string' }, 'warmup-from': { type: 'string' }, 'lower-tf': { type: 'string' }, help: { type: 'boolean' },
    },
  });
  return values;
}

function wantedSplits(arg) {
  const names = String(arg || 'all').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => n !== 'all' && !SPLIT_NAMES.includes(n));
  if (bad.length) throw new UsageError(`Unknown --split ${bad.join(', ')}`);
  return new Set(names.flatMap((n) => (n === 'all' ? ALL : [n])));
}

class UsageError extends Error {}

const fmtR = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(3)} R` : '—');
const fmtN = (x, dp = 2) => (Number.isFinite(x) ? x.toFixed(dp) : '—');
const usd = (x) => (Number.isFinite(x) ? `${x < 0 ? '-' : ''}US$${Math.abs(x).toFixed(2)}` : '—');

function line(label, m) {
  return `  ${label.padEnd(26)} ${m.from} to ${m.to}: ${m.trades} closed trade${m.trades === 1 ? '' : 's'}${m.trades < 30 ? ' (small sample)' : ''}, mean ${fmtR(m.meanR)}, profit factor ${m.profitFactor == null ? '—' : fmtN(m.profitFactor)}, max drawdown ${Number.isFinite(m.maxDrawdownPct) ? `${fmtN(m.maxDrawdownPct)} %` : '—'}, net ${usd(m.netPnl)} (simulated)`;
}

export async function main(argv = process.argv.slice(2), { now = () => new Date() } = {}) {
  let a;
  try { a = parseCli(argv); } catch (e) { console.error(`${e.message}\n${USAGE}`); return 2; }
  if (a.help) { console.log(USAGE); return 0; }
  try {
    if (!['intraday', 'swing', 'both'].includes(a.mode)) throw new UsageError('--mode must be intraday, swing or both');
    if (a.format && !['tradingview', 'generic'].includes(a.format)) throw new UsageError('--format must be tradingview or generic');
    if (a.seed != null && !a.synthetic) throw new UsageError('--seed is only used with --synthetic');
    if (a.synthetic && a.data) throw new UsageError('Use either --data or --synthetic, not both');
    if (a.synthetic && a['lower-tf']) throw new UsageError('--lower-tf needs real 1-minute data; it cannot be combined with --synthetic');
    const want = wantedSplits(a.split);
    const config = loadStrategyConfig(a.config || DEFAULT_CONFIG_PATH);
    const hash = configHash(config);
    const universe = loadUniverse(...(a.universe ? [a.universe] : []));
    const splits = loadSplits(...(a.splits ? [a.splits] : []));
    const acceptance = loadAcceptance(...(a.acceptance ? [a.acceptance] : []));
    if (!a.synthetic && !a.data) { console.error(dataRequirements(splits, universe)); return 2; }

    const symbols = a.symbols ? a.symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : universe.symbols.map((s) => s.symbol);
    const seed = a.synthetic ? Number(a.seed ?? 1) : null;
    if (a.synthetic && !Number.isInteger(seed)) throw new UsageError('--seed must be a whole number');
    const data = a.synthetic
      ? await syntheticBars({ symbols, from: a.from || splits.warmup.from, to: a.to || splits.holdout.to, seed })
      : await loadBars(a.data, { format: a.format, symbols, from: a.from, to: a.to, exchanges: new Map(universe.symbols.map((s) => [s.symbol, s.exchange])) });
    const synthetic = !!data.synthetic;
    const present = symbols.filter((s) => data.bars.get(s)?.length);
    if (!present.length) { console.error(`No bars for any requested symbol in ${data.source}.\n\n${dataRequirements(splits, universe)}`); return 2; }

    const out = path.resolve(a.out || DEFAULT_OUT);
    fs.mkdirSync(out, { recursive: true });
    const ledgerFile = path.join(out, synthetic ? 'holdout-ledger.synthetic.json' : 'holdout-ledger.json');
    const regimeSym = universe.regimeProxy || 'SPY';
    const regimes = buildRegimes(data.bars.get(regimeSym) || []);
    const modes = a.mode === 'both' ? ['intraday', 'swing'] : [a.mode];
    const exchanges = new Map(universe.symbols.map((s) => [s.symbol, s.exchange]));
    const lower = a['lower-tf'] ? await loadLowerTf(a['lower-tf'], { format: a.format, symbols: present, exchanges }) : null;
    const common = { config, bars: data.bars, symbols: present, splits, synthetic, universe, regimes, warmupFrom: a['warmup-from'], lowerTf: lower?.lowerTf };
    const command = ['node scripts/strategy-backtest.js', ...argv.map((x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x))].join(' ');

    console.log('Strategy Lab backtest: simulation only. No orders are placed and the real portfolio is not read.');
    if (synthetic) console.log(`${SYNTHETIC_BANNER}.`);
    console.log(`Config ${config.strategy} ${config.version}  hash ${hash}`);
    console.log(`Data   ${data.source}  hash ${data.dataHash}${seed != null ? `  seed ${seed}` : ''}`);
    if (lower) console.log(`1-minute bars for ${lower.symbols.length ? lower.symbols.join(', ') : 'no symbol'} (resolving bars that touch stop and target)  hash ${lower.dataHash}`);
    console.log(`Symbols ${present.length}/${symbols.length}${present.length < symbols.length ? ` (no bars: ${symbols.filter((s) => !present.includes(s)).join(', ')})` : ''}; regimes from ${regimeSym}${regimes.available ? '' : ' (not available: no bars)'}`);

    const runs = { meta: { synthetic, seed, dataHash: data.dataHash, lowerTfHash: lower?.dataHash ?? null, configHash: hash, version: config.version, dataSource: data.source, generatedAt: now().toISOString(), command }, modes: {} };
    let code = 0;
    for (const mode of modes) {
      const md = {};
      if (want.has('development')) md.development = await runSplit({ ...common, mode, split: 'development' });
      if (want.has('validation') || want.has('stress')) md.validation = await runSplit({ ...common, mode, split: 'validation' });
      if (want.has('stress')) md.stress = await runStress({ ...common, mode, acceptance, baseline: md.validation });
      if (want.has('walk-forward')) md.walkForward = await runWalkForward({ ...common, mode });
      if (want.has('holdout')) {
        try {
          md.holdout = await runHoldout({ ...common, mode, acceptance, ledger: createFileLedger(ledgerFile), reason: a['holdout-reason'], at: now().toISOString(), configHash: hash });
        } catch (e) {
          if (!(e instanceof HoldoutRefused)) throw e;
          console.error(`Holdout (${mode}) refused: ${e.message}`);
          code = 3;
        }
      }
      runs.modes[mode] = md;
    }

    if (!modes.some((m) => Object.keys(runs.modes[m]).length)) {
      console.error('Nothing was run; the previous report was left as it was.');
      return code || 1;
    }
    const { json, markdown } = buildReport({ runs, acceptance, universe, splits, config, dataQuality: { synthetic, seed, source: data.source, dataHash: data.dataHash, ...(data.skipped.length ? { skippedFiles: data.skipped.join(', ') } : {}), symbols: data.quality } });
    fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(json, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'report.md'), markdown);

    for (const mode of modes) {
      const md = runs.modes[mode];
      console.log(`\n${mode}:`);
      for (const sp of ['development', 'validation']) if (md[sp]) console.log(line(sp, md[sp].metrics));
      if (md.stress) console.log(`  stress tests               ${md.stress.tests.length} variants on validation; ${md.stress.tests.filter((t) => t.metrics.meanR > 0).length} with mean R above 0`);
      if (md.walkForward) console.log(line('walk-forward (OOS)', md.walkForward.oos.metrics));
      if (md.holdout) console.log(line(md.holdout.contaminated ? 'holdout (CONTAMINATED)' : 'holdout', md.holdout.metrics));
      const ev = json.modes[mode].acceptance;
      if (ev) console.log(`  acceptance (${acceptance.name}): ${ev.outcome.replace(/_/g, ' ')} — backtest ${ev.stages.backtest.replace(/_/g, ' ')}, forward ${ev.stages.forward.replace(/_/g, ' ')}. Not permission to trade.`);
    }
    console.log(`\nReport: ${path.join(out, 'report.md')}\n        ${path.join(out, 'report.json')}`);
    if (want.has('holdout')) console.log(`Holdout ledger: ${ledgerFile}`);
    else console.log('Holdout: not run (request it by name with --split holdout; it runs once per version).');
    console.log(`Reproduce: ${command}  (config ${hash.slice(0, 12)}, data ${String(data.dataHash).slice(0, 12)})`);
    if (synthetic) console.log(`\n${SYNTHETIC_BANNER}.`);
    return code;
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${USAGE}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 1; });
}
