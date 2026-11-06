// The packet loader (the order's section 1, enforced by construction): the only bridge between stored data and the
// planners. It holds the replay's data in memory and, for a stock and a simulated time T, builds the input packet from
// what was available by T only: items whose eligible time is at or before T, daily closes of sessions before T's
// session (in the current session's share units), 5-minute bars of T's session that closed at or before T, and the
// profile of the prior completed session; earlier plans are passed in by the caller and must predate T. It asserts all
// of this before returning, and the planners receive nothing else (they import no store and no loader).
import { sessionProfile } from './profile.js';
import { BAR_MS } from './items.js';
import { hashOf } from './config.js';

export const MAX_ITEMS = 20;
export const DAILY_LOOKBACK = 25;

export function createLoader({ items, daily, bars5, bars1, splits = [], sessions }) {
  const sessionIndex = new Map(sessions.map((d, i) => [d, i]));
  const byStock = new Map();
  for (const it of items) for (const s of it.stocks) { if (!byStock.has(s)) byStock.set(s, []); byStock.get(s).push(it); }
  for (const list of byStock.values()) list.sort((a, b) => a.eligibleMs - b.eligibleMs || (a.id < b.id ? -1 : 1));
  const context = items.filter((it) => it.contextOnly).sort((a, b) => a.eligibleMs - b.eligibleMs);
  const splitList = (sym) => splits.filter((x) => x.symbol === sym);
  // A price of `date` in the share units of `asOf` (a split effective after `date`, on or before `asOf`, divides it).
  const unitsFactor = (sym, date, asOf) => splitList(sym).reduce((f, x) => (x.date > date && x.date <= asOf ? f * x.ratio : f), 1);
  const profileCache = new Map();

  // itemsOverride (the placebo's moved items) replaces the stock's stored items; light skips the profile and context,
  // which the deterministic planners do not read.
  function packetAt({ stock, T, session, earlierPlans = [], control = false, itemsOverride = null, light = false }) {
    const si = sessionIndex.get(session);
    if (si == null) throw new Error(`loader: ${session} is not a replay session`);
    const own = control ? [] : (itemsOverride ?? byStock.get(stock) ?? []).filter((it) => it.eligibleMs <= T && it.session === session).slice(0, MAX_ITEMS);
    const ctx = light ? [] : context.filter((it) => it.eligibleMs <= T).slice(-3);
    const dl = (daily.get(stock) || []).filter((r) => r.date < session).slice(-DAILY_LOOKBACK).map((r) => ({ date: r.date, c: r.c / unitsFactor(stock, r.date, session) }));
    const bars = ((bars5.get(stock) || new Map()).get(session) || []).filter((b) => b.e <= T).map((b) => ({ s: b.s, e: b.e, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    const prior = si > 0 ? sessions[si - 1] : null;
    let profile = null;
    if (prior && !light) {
      const key = `${stock}|${prior}|${session}`;
      if (!profileCache.has(key)) {
        const pb = ((bars1.get(stock) || new Map()).get(prior) || []);
        const f = unitsFactor(stock, prior, session);
        profileCache.set(key, pb.length ? sessionProfile(pb.map((b) => ({ ...b, h: b.h / f, l: b.l / f, c: b.c / f, vw: b.vw ? b.vw / f : null })), { session: prior, asOfSession: session }) : null);
      }
      profile = profileCache.get(key);
    }
    for (const p of earlierPlans) if (!(p.T < T)) throw new Error('loader: an earlier plan must predate T');
    const packet = {
      asOf: T, session, stock, control,
      items: own.map((it) => ({ id: it.id, kind: it.kind, form: it.form ?? null, filingItems: it.items ?? null, publishedMs: it.publishedMs, eligibleMs: it.eligibleMs, occurred: it.occurred, revised: it.revised, outsideHours: it.outsideHours, headline: it.headline, summary: it.revised ? null : it.summary })),
      context: ctx.map((it) => ({ id: it.id, kind: it.kind, publishedMs: it.publishedMs, eligibleMs: it.eligibleMs, headline: it.headline })),
      prices: { daily: dl, bars, priorProfile: profile ? { session: profile.session, poc: profile.poc, vah: profile.vah, val: profile.val } : null },
      earlierPlans: earlierPlans.map((p) => ({ T: p.T, session: p.session, status: p.status, bullish: p.bullish?.armed ?? null })),
    };
    // The boundary, asserted: nothing in the packet is later than T.
    if (packet.items.some((x) => x.eligibleMs > T) || packet.context.some((x) => x.eligibleMs > T)) throw new Error('loader: an item eligible after T reached the packet');
    if (packet.prices.bars.some((b) => b.e > T)) throw new Error('loader: a bar that closed after T reached the packet');
    if (packet.prices.daily.some((r) => r.date >= session)) throw new Error('loader: a daily close of T\'s session or later reached the packet');
    return packet;
  }
  return { packetAt, packetHash: (p) => hashOf(p), sessions, sessionIndex, unitsFactor };
}
export { BAR_MS };
