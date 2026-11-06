// The event-time placebo (CAMPAIGN-1.md section 9): each stock's plan groups (its newly eligible items of one session)
// move to random sessions of that stock without items, keeping the time of day; groups that share a calendar date
// move together to one date that is item-free for every member (members are drawn separately when no such date exists,
// and that is counted). Sessions are drawn with replacement (news-heavy stocks have few item-free sessions; the count
// per stock is reported). The moved items keep their kind and headline; the planner re-plans from the prices at the
// new time. One mulberry32 stream, consumed in a fixed order. p = (1 + #{S_r >= S_obs}) / (1 + R).
import { mulberry32 } from '../research/runner.js';

export { mulberry32 };
export const pValue = (countGe, R) => (1 + countGe) / (1 + R);

// groups: [{ stock, session, T, items: [{ eligibleMs, ... }] }]; itemFree: Map stock -> [sessions without items and
// with bars]; openMs(date) -> the session's open. Returns draw(rng) -> moved groups (same shape, new session, times
// shifted to the same time of day).
export function groupPlaceboDrawer({ groups, itemFree, openMs, closeMs }) {
  const byDate = new Map();
  for (const g of groups) { if (!byDate.has(g.session)) byDate.set(g.session, []); byDate.get(g.session).push(g); }
  const clusters = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, members]) => ({ date, members: members.sort((a, b) => (a.stock < b.stock ? -1 : 1)) }));
  const fits = (g, d) => openMs(d) + (g.T - openMs(g.session)) < closeMs(d);
  const free = new Map([...itemFree].map(([s, list]) => [s, new Set(list)]));
  for (const c of clusters) {
    const first = c.members[0];
    let cand = (itemFree.get(first.stock) || []).filter((d) => fits(first, d));
    for (const m of c.members.slice(1)) { const set = free.get(m.stock) || new Set(); cand = cand.filter((d) => set.has(d) && fits(m, d)); }
    c.candidates = cand;
    // Each member's own candidates, computed once, for clusters without a common date.
    if (!cand.length) c.own = c.members.map((g) => (itemFree.get(g.stock) || []).filter((d) => fits(g, d)));
  }
  // A moved group keeps a reference to its original and the shift; its items are moved lazily (movedItems).
  const move = (g, d) => { const shift = openMs(d) - openMs(g.session); return { stock: g.stock, session: d, T: g.T + shift, shift, orig: g, placeboOf: g.session }; };
  function draw(rng) {
    const out = [];
    let unclustered = 0, failed = 0;
    for (const c of clusters) {
      if (c.candidates.length) { const d = c.candidates[Math.floor(rng() * c.candidates.length)]; for (const g of c.members) out.push(move(g, d)); continue; }
      if (c.members.length > 1) unclustered++;
      c.members.forEach((g, j) => {
        const cand = c.own[j];
        if (!cand.length) { failed++; return; }
        out.push(move(g, cand[Math.floor(rng() * cand.length)]));
      });
    }
    return { groups: out.sort((a, b) => a.T - b.T || (a.stock < b.stock ? -1 : 1)), unclustered, failed };
  }
  return { draw, clusters: clusters.length, multiStock: clusters.filter((c) => c.members.length > 1).length, withoutCommonDate: clusters.filter((c) => c.members.length > 1 && !c.candidates.length).length };
}
export const movedItems = (mg) => mg.orig.items.map((it) => ({ ...it, eligibleMs: it.eligibleMs + mg.shift, publishedMs: it.publishedMs + mg.shift, session: mg.session }));
