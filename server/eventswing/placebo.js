// The date-clustered event placebo (CAMPAIGN-1.md section 9). Families B, C and D: every real event of a stock moves
// to a random eligible session u of that stock (no real event's report date or availability within 30 of the stock's
// sessions, at least 21 earlier closes, not the last session), its pre-event session keeping its distance, its
// guidance class travelling with it; events sharing an availability date move together to one date eligible for all
// of them. Family A: every exit spell moves, with its length, to a random eligible start (no real event within 10
// sessions before it to 10 after its end), spells starting on one date together. One mulberry32 stream, consumed in
// a fixed order. p = (1 + #{T_r >= T_obs}) / (1 + R); a resample that cannot be drawn within the redraw limit counts
// as T_r >= T_obs (the conservative choice) and is reported.
import { mulberry32 } from '../research/runner.js';
import { lowerBound } from './events.js';

export { mulberry32 };

function blockedIndices(own, realEvents, symbol, before, after = before, extra = () => 0) {
  const blocked = new Set();
  for (const e of realEvents) {
    if (e.symbol !== symbol) continue;
    for (const d of [e.availDate, e.D]) {
      if (!d) continue;
      const i = lowerBound(own, d);
      for (let x = i - before; x <= i + after + extra(e); x++) blocked.add(x);
    }
  }
  return blocked;
}

// Events: returns a drawer whose draw(rng) gives one resample's placebo events (or null when the resample fails).
export function eventPlaceboDrawer({ events, stockSessions, buffer = 30, minPrior = 21, maxRedraws = 1000 }) {
  const real = [...events].sort((a, b) => (a.availDate < b.availDate ? -1 : a.availDate > b.availDate ? 1 : a.symbol < b.symbol ? -1 : 1));
  const eligibleCache = new Map();
  const eligible = (symbol, dist) => {
    const key = `${symbol}|${dist}`;
    if (eligibleCache.has(key)) return eligibleCache.get(key);
    const own = stockSessions[symbol];
    const blocked = blockedIndices(own, real, symbol, buffer);
    const out = [];
    for (let i = Math.max(minPrior, dist); i <= own.length - 2; i++) if (!blocked.has(i)) out.push(own[i]);
    eligibleCache.set(key, out);
    return out;
  };
  const distOf = (e) => { const own = stockSessions[e.symbol]; return lowerBound(own, e.availDate) - lowerBound(own, e.preDate); };
  const clusters = [];
  for (const e of real) { const last = clusters.at(-1); if (last && last.date === e.availDate) last.members.push(e); else clusters.push({ date: e.availDate, members: [e] }); }
  for (const c of clusters) {
    let cand = eligible(c.members[0].symbol, distOf(c.members[0]));
    for (const m of c.members.slice(1)) { const set = new Set(eligible(m.symbol, distOf(m))); cand = cand.filter((d) => set.has(d)); }
    c.candidates = cand;
  }
  function draw(rng) {
    const placed = new Map(); // symbol -> placebo indices
    const out = [];
    let unclustered = 0;
    const ok = (symbol, i) => (placed.get(symbol) || []).every((j) => Math.abs(i - j) >= buffer);
    const put = (e, d) => {
      const own = stockSessions[e.symbol], i = lowerBound(own, d), dist = distOf(e);
      if (!placed.has(e.symbol)) placed.set(e.symbol, []);
      placed.get(e.symbol).push(i);
      out.push({ ...e, id: `${e.id}#placebo`, availDate: own[i], preDate: own[i - dist], D: own[i - dist + 1], placebo: true });
    };
    for (const c of clusters) {
      const groups = c.candidates.length ? [{ members: c.members, cand: c.candidates }] : c.members.map((m) => ({ members: [m], cand: eligible(m.symbol, distOf(m)) }));
      if (!c.candidates.length && c.members.length > 1) unclustered++;
      for (const g of groups) {
        if (!g.cand.length) return { events: null, unclustered, failed: true, reason: `no eligible date for ${g.members.map((m) => m.id).join(', ')}` };
        let done = false;
        for (let tries = 0; tries < maxRedraws && !done; tries++) {
          const d = g.cand[Math.floor(rng() * g.cand.length)];
          if (g.members.every((m) => ok(m.symbol, lowerBound(stockSessions[m.symbol], d)))) { for (const m of g.members) put(m, d); done = true; }
        }
        if (!done) return { events: null, unclustered, failed: true, reason: `no non-overlapping date within ${maxRedraws} draws for ${g.members.map((m) => m.id).join(', ')}` };
      }
    }
    return { events: out, unclustered, failed: false };
  }
  return { draw, clusters: clusters.length, multiStockClusters: clusters.filter((c) => c.members.length > 1).length, clustersWithoutCommonDate: clusters.filter((c) => c.members.length > 1 && !c.candidates.length).length };
}

// Family A's spells: spells = [{ symbol, x (exit fill date), y (re-entry decision date) }]. Returns a drawer whose
// draw(rng) gives forced spells { SYM: [{ exitDecision, reentryDecision }] } for the sleeve engine.
export function spellPlaceboDrawer({ spells, realEvents, stockSessions, calendar, buffer = 10, maxRedraws = 1000 }) {
  const real = [...spells].sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : a.symbol < b.symbol ? -1 : 1));
  const lenOf = (s) => { const own = stockSessions[s.symbol]; return lowerBound(own, s.y) - lowerBound(own, s.x); };
  const cache = new Map();
  const eligible = (symbol, L) => {
    const key = `${symbol}|${L}`;
    if (cache.has(key)) return cache.get(key);
    const own = stockSessions[symbol];
    const eventIdx = [];
    for (const e of realEvents) if (e.symbol === symbol) for (const d of [e.availDate, e.D]) if (d) eventIdx.push(lowerBound(own, d));
    const out = [];
    for (let i = 1; i + L <= own.length - 1; i++) if (!eventIdx.some((j) => j >= i - buffer && j <= i + L + buffer)) out.push(own[i]);
    cache.set(key, out);
    return out;
  };
  const clusters = [];
  for (const s of real) { const last = clusters.at(-1); if (last && last.date === s.x) last.members.push(s); else clusters.push({ date: s.x, members: [s] }); }
  for (const c of clusters) {
    let cand = eligible(c.members[0].symbol, lenOf(c.members[0]));
    for (const m of c.members.slice(1)) { const set = new Set(eligible(m.symbol, lenOf(m))); cand = cand.filter((d) => set.has(d)); }
    c.candidates = cand;
  }
  function draw(rng) {
    const placed = new Map(); // symbol -> [[from, to]]
    const forced = {};
    let unclustered = 0;
    const ok = (symbol, i, L) => (placed.get(symbol) || []).every(([a, b]) => i + L + 1 < a || i - 1 > b);
    const put = (s, d) => {
      const own = stockSessions[s.symbol], i = lowerBound(own, d), L = lenOf(s);
      if (!placed.has(s.symbol)) placed.set(s.symbol, []);
      placed.get(s.symbol).push([i - 1, i + L + 1]);
      const ci = lowerBound(calendar, own[i]);
      (forced[s.symbol] ||= []).push({ exitDecision: calendar[ci - 1], reentryDecision: own[i + L] });
    };
    for (const c of clusters) {
      const groups = c.candidates.length ? [{ members: c.members, cand: c.candidates }] : c.members.map((m) => ({ members: [m], cand: eligible(m.symbol, lenOf(m)) }));
      if (!c.candidates.length && c.members.length > 1) unclustered++;
      for (const g of groups) {
        if (!g.cand.length) return { forced: null, unclustered, failed: true, reason: `no eligible start for ${g.members.map((m) => `${m.symbol}:${m.x}`).join(', ')}` };
        let done = false;
        for (let tries = 0; tries < maxRedraws && !done; tries++) {
          const d = g.cand[Math.floor(rng() * g.cand.length)];
          if (g.members.every((m) => ok(m.symbol, lowerBound(stockSessions[m.symbol], d), lenOf(m)))) { for (const m of g.members) put(m, d); done = true; }
        }
        if (!done) return { forced: null, unclustered, failed: true, reason: `no non-overlapping start within ${maxRedraws} draws` };
      }
    }
    for (const k of Object.keys(forced)) forced[k].sort((a, b) => (a.exitDecision < b.exitDecision ? -1 : 1));
    return { forced, unclustered, failed: false };
  }
  return { draw, clusters: clusters.length, multiStockClusters: clusters.filter((c) => c.members.length > 1).length, clustersWithoutCommonDate: clusters.filter((c) => c.members.length > 1 && !c.candidates.length).length };
}

export const pValue = (countGe, R) => (1 + countGe) / (1 + R);
