// The random-timing null (server/research/runner.js nullTest) checked on synthetic markets. The expected
// behaviour is stated in each test's name before it runs (the owner's order of 2026-11-05). Synthetic prices
// only exercise the code; nothing here is a result about any stock. The null is the one pre-registered in
// CAMPAIGN-3.md section 3 item 1: each trade keeps its stock, shares and holding length h and moves to a random
// decision session; entry at the next open plus spread and slippage, exit at the open h sessions later minus
// them; p = (1 + resamples with T >= the run's) / (1 + R).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nullTest, mulberry32 } from '../server/research/runner.js';

const R = 200; // resamples per test; the campaigns use 2,000 and 20,000
const K_BPS = 2; // half-spread floor and slippage, as the campaigns' configs
const config = { costs: { halfSpreadFloorBps: K_BPS, slippageBps: K_BPS } };
const calibrated = () => K_BPS;
const k = (2 * K_BPS) / 10000;

function sessionsFrom(n) {
  const out = [];
  const d = new Date('2019-01-02T12:00:00Z');
  while (out.length < n) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
// A market: closes from a seeded multiplicative random walk (no drift unless `drift`), opens = the previous close
// times a small seeded noise; optional planted rises (+8% over three closes after each planted index).
function market({ seed, n = 600, symbols = ['A', 'B', 'C'], drift = 0, plants = [] }) {
  const sessions = sessionsFrom(n);
  const rand = mulberry32(seed);
  const days = new Map(sessions.map((d) => [d, { bars: {} }]));
  for (const sym of symbols) {
    let c = 100;
    for (let i = 0; i < n; i++) {
      const o = i === 0 ? c : c * (1 + (rand() - 0.5) * 0.002);
      const planted = plants.some((j) => i > j && i <= j + 3) ? 0.08 / 3 : 0;
      c = c * (1 + (rand() - 0.5) * 0.04 + drift + planted);
      days.get(sessions[i]).bars[sym] = { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1 };
    }
  }
  return { sessions, days, symbols, period: { start: sessions[0], end: sessions.at(-1) } };
}
const open = (m, sym, i) => m.days.get(m.sessions[i]).bars[sym].o;
// A trade placed at decision index e with holding length h: the same fill arithmetic as the null's.
function trade(m, sym, e, h, shares = 10) {
  const entryPrice = open(m, sym, e + 1) * (1 + k), exitPrice = open(m, sym, e + 1 + h) * (1 - k);
  return { symbol: sym, shares, sessionsHeld: h, entryPrice, exitPrice, entryIndex: e };
}
const run = (m, trades, seed) => nullTest({ trades, openPositions: [] }, { inputs: { sessions: m.sessions, days: m.days }, calibrated, config, period: m.period, resamples: R, seed });

test('(a) a market with no structure and entries placed at random, over 200 seeds: the p-values are spread roughly uniformly, with about one in twenty below 0.05', () => {
  const m = market({ seed: 11 });
  const ps = [];
  for (let s = 1; s <= 200; s++) {
    const rand = mulberry32(1000 + s);
    const trades = [];
    for (let t = 0; t < 20; t++) { const h = 1 + Math.floor(rand() * 15); const e = Math.floor(rand() * (m.sessions.length - 2 - h)); trades.push(trade(m, m.symbols[Math.floor(rand() * 3)], e, h)); }
    ps.push(run(m, trades, 20261105 + s).p);
  }
  const frac = (x) => ps.filter((p) => p < x).length / ps.length;
  assert.ok(frac(0.05) >= 0.01 && frac(0.05) <= 0.10, `about one in twenty below 0.05: got ${frac(0.05)}`);
  assert.ok(frac(0.25) >= 0.15 && frac(0.25) <= 0.35, `about a quarter below 0.25: got ${frac(0.25)}`);
  assert.ok(frac(0.5) >= 0.40 && frac(0.5) <= 0.60, `about half below 0.5: got ${frac(0.5)}`);
  assert.ok(frac(0.75) >= 0.65 && frac(0.75) <= 0.85, `about three quarters below 0.75: got ${frac(0.75)}`);
  assert.ok(ps.every((p) => p > 0 && p <= 1));
});

test('(b) the same market with entries planted immediately before built-in rises: p is near 1/(R+1), the smallest attainable value', () => {
  const plants = [50, 120, 190, 260, 330, 400, 470, 540];
  const m = market({ seed: 11, plants });
  for (const s of [1, 2, 3]) {
    const trades = plants.flatMap((j) => m.symbols.map((sym) => trade(m, sym, j, 3)));
    const r = run(m, trades, 20261105 + s);
    assert.ok(r.p <= 3 / (R + 1), `p ${r.p} should be near ${(1 / (R + 1)).toFixed(4)}`);
  }
});

test('(c) a drifting market whose only edge is holding longer (exit timing by duration): the null does not detect it, because holding length is kept and the exit moves with the entry', () => {
  const m = market({ seed: 23, drift: 0.003 });
  const ps = [];
  for (let s = 1; s <= 60; s++) {
    const rand = mulberry32(5000 + s);
    const trades = [];
    for (let t = 0; t < 20; t++) { const e = Math.floor(rand() * (m.sessions.length - 25)); trades.push(trade(m, m.symbols[Math.floor(rand() * 3)], e, 20)); }
    ps.push(run(m, trades, 20261105 + s).p);
  }
  const fracLow = ps.filter((p) => p < 0.05).length / ps.length;
  assert.ok(fracLow <= 0.15, `the long hold's gain is matched by random placements of the same length: fraction below 0.05 is ${fracLow}`);
  assert.ok(ps.filter((p) => p < 0.5).length / ps.length >= 0.3, 'the p-values are not systematically high either');
});

test('(c, recorded property) price-selected exits with random entries (each exit at the best open of the next 20 sessions, a look-ahead): the null does detect this, because the realised exit prices enter the statistic; this is a property of the construction, not a defect', () => {
  const m = market({ seed: 31 });
  let detected = 0;
  for (let s = 1; s <= 30; s++) {
    const rand = mulberry32(7000 + s);
    const trades = [];
    for (let t = 0; t < 20; t++) {
      const sym = m.symbols[Math.floor(rand() * 3)], e = Math.floor(rand() * (m.sessions.length - 25));
      let best = 1, bestPx = -Infinity;
      for (let h = 1; h <= 20; h++) { const px = open(m, sym, e + 1 + h); if (px > bestPx) { bestPx = px; best = h; } }
      trades.push(trade(m, sym, e, best));
    }
    if (run(m, trades, 20261105 + s).p <= 0.05) detected++;
  }
  assert.ok(detected / 30 >= 0.8, `detected in ${detected} of 30 seeds`);
});

test('the null is deterministic for a seed, keeps every item placeable when the stock has sessions, and reports the resample count and percentiles', () => {
  const m = market({ seed: 41 });
  const rand = mulberry32(99);
  const trades = Array.from({ length: 10 }, () => { const h = 1 + Math.floor(rand() * 10); return trade(m, 'A', Math.floor(rand() * 500), h); });
  const a = run(m, trades, 20261105), b = run(m, trades, 20261105), c = run(m, trades, 20261106);
  assert.equal(a.p, b.p); assert.equal(a.atOrAbove, b.atOrAbove);
  assert.notEqual(JSON.stringify(a.percentiles), JSON.stringify(c.percentiles), 'another seed gives another resample set');
  assert.equal(a.unplaceableItems, 0); assert.equal(a.items, 10); assert.equal(a.resamples, R);
  assert.ok(a.percentiles.p5 <= a.percentiles.p50 && a.percentiles.p50 <= a.percentiles.p95);
  // A stock with no sessions makes its items unplaceable and counted.
  const z = nullTest({ trades: [{ ...trades[0], symbol: 'Z' }], openPositions: [] }, { inputs: { sessions: m.sessions, days: m.days }, calibrated, config, period: m.period, resamples: 20, seed: 1 });
  assert.equal(z.unplaceableItems, 1);
});
