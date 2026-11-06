// Synthetic markets, events and stores for the event-swing tests. Synthetic prices only exercise the code; nothing
// here is a result. Dates are real NYSE sessions (the calendar decides availability), always inside 2016-2021.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tradingDays } from '../server/strategy/sessions.js';
import { mulberry32 } from '../server/research/runner.js';
import { loadMatrix, configFor } from '../server/eventswing/config.js';

export const MATRIX = loadMatrix();
export const cfg = (id, patch = {}) => {
  const base = JSON.parse(JSON.stringify(configFor(MATRIX, id)));
  return { ...base, ...patch, rule: { ...base.rule, ...(patch.rule || {}) } };
};
export const calendar = (from = '2016-01-04', to = '2017-12-29') => tradingDays(from, to, 'NYSE');

// A random market on the NYSE calendar: multiplicative walks, opens near the previous close, optional listing dates,
// splits and dividends. stockSessions lists each stock's sessions with a bar.
export function synthMarket({ seed = 1, from = '2016-01-04', to = '2017-12-29', syms = ['AAA', 'BBB', 'CCC'], listed = {}, splits = [], dividends = [], drift = 0.0004, vol = 0.04 } = {}) {
  const sessions = calendar(from, to);
  const rand = mulberry32(seed);
  const days = new Map(sessions.map((d) => [d, { bars: {}, splits: [], dividends: [] }]));
  for (const [j, s] of syms.entries()) {
    let c = 30 + 20 * j, factor = 1;
    for (const d of sessions) {
      const sp = splits.find((x) => x.symbol === s && x.date === d);
      if (sp) { factor *= sp.ratio; days.get(d).splits.push({ symbol: s, ratio: sp.ratio, id: `split-${s}-${d}` }); }
      const o = c * (1 + (rand() - 0.5) * 0.01);
      c = c * (1 + (rand() - 0.5) * vol + drift);
      if (listed[s] && d < listed[s]) continue;
      days.get(d).bars[s] = { o: o / factor, h: Math.max(o, c) / factor * 1.004, l: Math.min(o, c) / factor * 0.996, c: c / factor, v: 1000 };
    }
  }
  for (const dv of dividends) days.get(dv.exDate).dividends.push({ symbol: dv.symbol, exDate: dv.exDate, payDate: dv.payDate, amount: dv.amount, id: `div-${dv.symbol}-${dv.exDate}` });
  return finish({ sessions, days, syms, listed });
}
export function finish({ sessions, days, syms, listed = {} }) {
  const stockSessions = Object.fromEntries(syms.map((s) => [s, sessions.filter((d) => days.get(d).bars[s])]));
  return { symbols: syms.map((s) => ({ symbol: s, exchange: 'NASDAQ', listedFrom: listed[s] ?? sessions[0] })), sessions, days, stockSessions, inputsHash: 'synthetic' };
}
// A flat market (every bar o = h = l = c = price) that a test then shapes bar by bar.
export function flatMarket({ from = '2016-01-04', to = '2016-12-30', syms = ['AAA', 'BBB'], price = 50 } = {}) {
  const sessions = calendar(from, to);
  const days = new Map(sessions.map((d) => [d, { bars: Object.fromEntries(syms.map((s) => [s, { o: price, h: price, l: price, c: price, v: 1000 }])), splits: [], dividends: [] }]));
  return finish({ sessions, days, syms });
}
export function setBar(m, symbol, date, bar) {
  const b = m.days.get(date).bars[symbol];
  if (!b) throw new Error(`no ${symbol} bar on ${date}`);
  Object.assign(b, bar);
  b.h = Math.max(b.h, b.o, b.c); b.l = Math.min(b.l, b.o, b.c);
}
// A rising staircase over a range of sessions (closes from a to b), opens at the previous close.
export function ramp(m, symbol, i0, i1, a, b) {
  for (let i = i0; i <= i1; i++) { const c = a + ((b - a) * (i - i0)) / Math.max(1, i1 - i0); const prev = m.days.get(m.sessions[i - 1])?.bars[symbol]?.c ?? c; setBar(m, symbol, m.sessions[i], { o: prev, h: Math.max(prev, c), l: Math.min(prev, c), c }); }
}
export const ev = (symbol, { avail, pre, D = null, guidance = 'none_detected', interim = false, timing = 'after_close', id = null }) => ({ id: id ?? `${symbol}:${D ?? avail}`, symbol, availDate: avail, preDate: pre, D: D ?? avail, guidance, interim, timing, acceptedEt: null });

// A fake HXR store with the three tables event-swing reads (rows only; no HXR guard involved).
export function fakeHxrDb(dir, { inputs, samples = [], extraBars = [], extraActions = [] }) {
  const db = new DatabaseSync(path.join(dir, 'fake-hxr.sqlite'));
  db.exec(`CREATE TABLE hxr_bars (symbol TEXT, date TEXT, o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY (symbol, date));
    CREATE TABLE hxr_corporate_actions (id TEXT PRIMARY KEY, type TEXT, symbol TEXT, ex_date TEXT, pay_date TEXT, ratio_old REAL, ratio_new REAL, rate REAL);
    CREATE TABLE hxr_spread_samples (symbol TEXT, date TEXT, median_half_spread_bps REAL, PRIMARY KEY (symbol, date));`);
  db.exec('BEGIN'); // one transaction: thousands of single-row commits are slow on Windows
  const bar = db.prepare('INSERT INTO hxr_bars VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const d of inputs.sessions) for (const [s, b] of Object.entries(inputs.days.get(d).bars)) bar.run(s, d, b.o, b.h, b.l, b.c, b.v ?? 0);
  for (const b of extraBars) bar.run(b.symbol, b.date, b.o, b.h, b.l, b.c, 0);
  const act = db.prepare('INSERT INTO hxr_corporate_actions VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of inputs.sessions) {
    for (const sp of inputs.days.get(d).splits) act.run(sp.id, 'forward_split', sp.symbol, d, null, 1, sp.ratio, null);
    for (const dv of inputs.days.get(d).dividends) act.run(dv.id, 'cash_dividend', dv.symbol, dv.exDate, dv.payDate, null, null, dv.amount);
  }
  for (const a of extraActions) act.run(a.id, a.type, a.symbol, a.exDate, a.payDate ?? null, a.ratioOld ?? null, a.ratioNew ?? null, a.rate ?? null);
  const sm = db.prepare('INSERT INTO hxr_spread_samples VALUES (?, ?, ?)');
  for (const x of samples) sm.run(x.symbol, x.date, x.bps);
  db.exec('COMMIT');
  return db;
}
