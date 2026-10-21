// Optional consistency check: run the Pine strategy (strategy/pine/) in PineTS,
// an open-source third-party Pine Script runtime, and compare its trades with
// the Signal Desk engine in TradingView-parity mode on the same bars.
//
// PineTS is not TradingView: agreement here means the Pine logic and the engine
// implement the same rules, not that TradingView compiles or fills identically.
// PineTS is not a Signal Desk dependency; install it only for this check:
//   npm install --no-save pinets
// Usage:
//   node scripts/strategy-pine-parity.mjs --symbol AMD [--mode swing|intraday]
//     [--csv <15-minute CSV for the symbol>] [--synthetic --seed 11 --from 2022-10-01 --to 2023-12-29]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../server/strategy/engine.js';
import { loadStrategyConfig } from '../server/strategy/config.js';
import { generateSyntheticBars } from '../server/strategy/synthetic.js';
import { parseTradingViewCsv, parseGenericCsv, normalizeBars } from '../server/strategy/data.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const sym = opt('symbol', 'AMD').toUpperCase();
const mode = opt('mode', 'swing');
const exchange = opt('exchange', 'NASDAQ');

let PineTS;
try { ({ PineTS } = await import('pinets')); } catch {
  console.error('PineTS is not installed. Run: npm install --no-save pinets');
  process.exit(2);
}

let bars, synthetic = false;
if (opt('csv')) {
  const text = fs.readFileSync(opt('csv'), 'utf8');
  const raw = /(^|,)time(,|$)/im.test(text.split('\n')[0]) ? parseTradingViewCsv(text) : parseGenericCsv(text);
  bars = normalizeBars(raw, { exchange, intervalMinutes: 15 }).bars ?? normalizeBars(raw, { exchange, intervalMinutes: 15 });
} else {
  synthetic = true;
  const g = generateSyntheticBars({ symbols: [sym], from: opt('from', '2022-10-01'), to: opt('to', '2023-12-29'), seed: Number(opt('seed', 11)) });
  bars = (g.bars || g).get(sym);
}
if (!bars?.length) { console.error('No bars.'); process.exit(2); }

// The Pine test window must cover the data; the mode is an input.
const first = bars[0].t, last = bars.at(-1).t;
let source = fs.readFileSync(path.join(root, 'strategy/pine/consolidation_breakout_v1.pine'), 'utf8');
source = source
  .replace(/(int winStart = input\.time\(timestamp\(")[^"]+(")/, `$1${first}$2`)
  .replace(/(int winEnd = input\.time\(timestamp\(")[^"]+(")/, `$1${new Date(Date.parse(last) + 86400000).toISOString()}$2`)
  .replace(/(string modeIn = input\.string\(")Intraday(")/, mode === 'swing' ? '$1Swing$2' : '$1Intraday$2');

const klines = bars.map((b) => { const t = Date.parse(b.t); return { openTime: t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closeTime: t + 15 * 60000, quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 }; });
const provider = {
  configure() {},
  async getMarketData() { return klines; },
  async getSymbolInfo() { return { ticker: sym, tickerid: `${exchange}:${sym}`, prefix: exchange, root: sym, description: sym, type: 'stock', currency: 'USD', basecurrency: '', country: 'US', timezone: 'America/New_York', session: 'regular', volumetype: 'base', mincontract: 1, minmove: 1, mintick: 0.01, pointvalue: 1, pricescale: 100, main_tickerid: `${exchange}:${sym}`, current_contract: '', isin: '' }; },
};
const ctx = await new PineTS(provider, sym, '15', klines.length).run(source);
const pine = ctx.strategy.closedtrades || [];
const engine = runBacktest({ config: loadStrategyConfig(), mode, bars: new Map([[sym, bars]]), symbols: [{ symbol: sym, exchange }], overrides: { ambiguity: 'tv_path', entryFill: 'limit_intrabar' } }).trades;

const minute = (t) => new Date(t).toISOString().slice(0, 16);
const key = (at) => minute(at);
const byEntry = new Map(engine.map((e) => [key(e.entry.at), e]));
let matched = 0;
const rows = [];
for (const p of pine) {
  const e = byEntry.get(key(p.entry_time));
  if (!e) { rows.push(`Pine only   ${minute(p.entry_time)} entry ${p.entry_price} x${p.size} → ${minute(p.exit_time)} ${p.exit_price} (${p.exit_comment || p.exit_id})`); continue; }
  byEntry.delete(key(p.entry_time));
  const same = Math.abs(p.entry_price - e.entry.raw) < 0.011 && p.size === e.entry.shares && minute(p.exit_time) === minute(e.exit.at) && Math.abs(p.exit_price - e.exit.raw) < 0.011;
  if (same) matched += 1;
  else rows.push(`Different   ${minute(p.entry_time)} Pine ${p.entry_price} x${p.size} → ${minute(p.exit_time)} ${p.exit_price} | engine ${e.entry.raw} x${e.entry.shares} → ${minute(e.exit.at)} ${e.exit.raw.toFixed(2)} (${e.exit.reason})`);
}
for (const e of byEntry.values()) rows.push(`Engine only ${minute(e.entry.at)} entry ${e.entry.raw} x${e.entry.shares} → ${minute(e.exit.at)} ${e.exit.raw.toFixed(2)} (${e.exit.reason})`);

console.log(`${synthetic ? 'SYNTHETIC DATA — checks consistency of the code only. ' : ''}${sym} ${mode}: ${bars.length} bars ${first} to ${last}`);
console.log(`PineTS (third-party runtime, not TradingView): ${pine.length} trades; engine (tv_path, limit_intrabar): ${engine.length} trades; identical: ${matched}`);
console.log('Identical = same entry bar, entry price and shares, exit bar and exit price (within a cent; the Pine stop is rounded to the tick).');
for (const r of rows) console.log('  ' + r);
console.log('Expected differences are listed in strategy/ENGINE-SPEC.md §8 and the Pine header (e.g. an open at or below the stop: the engine skips, a limit order fills and stops out).');
