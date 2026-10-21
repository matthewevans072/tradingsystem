// Synthetic 15-minute bars for testing the engine and demonstrating the
// interface ONLY. They are generated from a seeded random process with planted
// consolidations, breakouts, failed breakouts and opening gaps; they are not
// market data and nothing computed on them is strategy performance.
// Timestamps are real NYSE regular-session bars (holidays and early closes
// from server/calendar.js).
import { tradingDays, sessionBarStarts } from './sessions.js';

export const SYNTHETIC_NOTE = 'Synthetic prices generated for testing the code only; not market data and not strategy performance.';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a: a per-symbol seed so each series is independent of the others.
function hashSeed(seed, symbol) {
  let h = 0x811c9dc5;
  for (const ch of `${seed}|${symbol}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

const cents = (x) => Math.round(x * 100) / 100;

function series(rnd, days, exchange) {
  const normal = () => {
    const u = Math.max(rnd(), 1e-12), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const p0 = 20 + rnd() * 380;
  const sigma = 0.0025 + rnd() * 0.003;
  const baseVol = 20000 + rnd() * 400000;
  let price = p0;
  let phase = { kind: 'drift', left: 20 + Math.floor(rnd() * 40), mu: 0 };
  const out = [];

  const nextPhase = () => {
    const r = rnd();
    if (phase.kind === 'box') {
      const { top, bottom } = phase;
      const H = top - bottom;
      if (r < 0.55) return { kind: 'breakout', left: 1, top, bottom, H, volMult: 2.5 + rnd() * 2, after: rnd() < 0.6 ? 'run' : 'fail' };
      if (r < 0.75) return { kind: 'breakout', left: 1, top, bottom, H, volMult: 0.6 + rnd() * 0.6, after: 'drift' };
      return { kind: 'breakdown', left: 1, top, bottom, H };
    }
    if (phase.kind === 'breakout' && phase.after === 'run') return { kind: 'drift', left: 8 + Math.floor(rnd() * 25), mu: sigma * (0.3 + rnd() * 0.4) };
    if (phase.kind === 'breakout' && phase.after === 'fail') return { kind: 'drift', left: 6 + Math.floor(rnd() * 12), mu: -sigma * (0.4 + rnd() * 0.4) };
    if (r < 0.45 && phase.kind === 'drift') {
      const w = price * sigma * (1.0 + rnd() * 1.1);
      return { kind: 'box', left: 21 + Math.floor(rnd() * 8), top: price + w, bottom: price - w, legLeft: 2 + Math.floor(rnd() * 3), dir: rnd() < 0.5 ? 1 : -1 };
    }
    return { kind: 'drift', left: 10 + Math.floor(rnd() * 40), mu: (rnd() - 0.5) * sigma * 0.4 };
  };

  for (const d of days) {
    const starts = sessionBarStarts(d, exchange);
    if (out.length) {
      let g = normal() * sigma * 2.5;
      if (rnd() < 0.03) g += (rnd() < 0.5 ? -1 : 1) * (0.02 + rnd() * 0.04);
      price *= Math.exp(g);
      if (phase.kind === 'box') phase.left = 0; // an opening gap ends a planted box
    }
    starts.forEach((ms, n) => {
      if (phase.left <= 0) phase = nextPhase();
      phase.left--;
      const u = n < 2 ? 1.7 : n >= starts.length - 2 ? 1.4 : 0.85;
      let vol = baseVol * u * Math.exp(0.35 * normal());
      const o = price;
      let c, h, l;
      if (phase.kind === 'box') {
        const { top, bottom } = phase, H = top - bottom;
        const goal = phase.dir > 0 ? top : bottom;
        c = o + (goal - o) * (0.35 + rnd() * 0.3) + normal() * H * 0.04;
        c = Math.min(top - H * 0.05, Math.max(bottom + H * 0.05, c));
        h = Math.max(o, c) + rnd() * H * 0.08;
        l = Math.min(o, c) - rnd() * H * 0.08;
        if (phase.left < 3) phase.dir = 1; // the last bars drift up to the ceiling before the breakout bar
        if (--phase.legLeft <= 0) {
          if (phase.dir > 0) h = top - rnd() * H * 0.06; else l = bottom + rnd() * H * 0.06;
          phase.dir = -phase.dir;
          phase.legLeft = 2 + Math.floor(rnd() * 3);
        }
        h = Math.min(top, Math.max(h, o, c));
        l = Math.max(bottom, Math.min(l, o, c));
        vol *= 0.7;
      } else if (phase.kind === 'breakout') {
        c = phase.top + phase.H * (0.03 + rnd() * 0.3);
        h = c + rnd() * phase.H * 0.1;
        l = Math.min(o, c) - rnd() * phase.H * 0.05;
        vol *= phase.volMult;
      } else if (phase.kind === 'breakdown') {
        c = phase.bottom - phase.H * (0.1 + rnd() * 0.4);
        h = Math.max(o, c) + rnd() * phase.H * 0.1;
        l = c - rnd() * phase.H * 0.15;
        vol *= 1.5;
      } else {
        const reversion = -0.002 * Math.log(price / p0);
        c = o * Math.exp(phase.mu + reversion + sigma * normal());
        h = Math.max(o, c) * (1 + Math.abs(normal()) * sigma * 0.6);
        l = Math.min(o, c) * (1 - Math.abs(normal()) * sigma * 0.6);
      }
      const bo = cents(o), bc = cents(Math.max(0.5, c));
      const bar = {
        t: new Date(ms).toISOString(), o: bo, c: bc,
        h: Math.max(cents(h), bo, bc), l: Math.max(0.01, Math.min(cents(l), bo, bc)),
        v: rnd() < 0.0003 ? null : Math.max(100, Math.round(vol / 100) * 100),
      };
      out.push(bar);
      price = bc;
    });
  }
  return out;
}

// symbols: strings or { symbol }. Returns { bars: Map<symbol, Bar[]>, synthetic: true, ... };
// the Map and every bar array also carry `synthetic = true`.
export function generateSyntheticBars({ symbols, from, to, seed = 1, exchange = 'NYSE' } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('from and to must be YYYY-MM-DD dates');
  const days = tradingDays(from, to, exchange);
  const bars = new Map();
  const names = (symbols || []).map((s) => (typeof s === 'string' ? s : s.symbol));
  for (const sym of names) {
    const list = series(mulberry32(hashSeed(seed, sym)), days, exchange);
    list.synthetic = true;
    bars.set(sym, list);
  }
  bars.synthetic = true;
  return { bars, synthetic: true, seed, from, to, exchange, symbols: names, note: SYNTHETIC_NOTE };
}
