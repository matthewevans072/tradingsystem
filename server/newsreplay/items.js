// Items and their three times (the order's section 1; CAMPAIGN-1.md section 3): occurred (if known), published, and
// eligible = published + 5 minutes, then the next 5-minute bar boundary of the regular session; an item published
// outside regular hours, or whose boundary reaches the close, becomes eligible at the next session's first bar close.
// A news item updated more than 15 minutes after it was created is "possibly revised": only its headline and created
// time are used, never its summary. Pure functions; no price, no outcome.
import { regularSessionBounds, isTradingDay, nextTradingDay } from '../calendar.js';
import { zonedToUtc } from '../time.js';
import { BASKET, MAX_DATE } from './config.js';

export const PROCESSING_DELAY_MS = 5 * 60000;
export const BAR_MS = 5 * 60000;
export const REVISION_MS = 15 * 60000;
export const MAX_SYMBOLS = 3;

const etParts = (ms) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)); const g = (t) => p.find((x) => x.type === t).value; return { date: `${g('year')}-${g('month')}-${g('day')}`, hh: Number(g('hour')), mm: Number(g('minute')), ss: Number(g('second')) }; };
export const etDateOf = (ms) => etParts(ms).date;
export const etMs = (et) => { const m = String(et).match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/); if (!m) return null; return new Date(zonedToUtc(m[1], Number(m[2]), Number(m[3]))).getTime() + Number(m[4]) * 1000; };
const bounds = (date) => { const b = regularSessionBounds(date); return b ? { open: new Date(b.open).getTime(), close: new Date(b.close).getTime() } : null; };
const firstBarClose = (date) => bounds(date).open + BAR_MS;
function nextSessionOnOrAfter(date) { let d = date; while (!isTradingDay(d, 'NYSE')) d = nextTradingDay(d, 'NYSE'); return d; }

// The eligible time of an item published at `publishedMs` (epoch ms).
export function eligibleOf(publishedMs) {
  const date = etDateOf(publishedMs);
  const b = isTradingDay(date, 'NYSE') ? bounds(date) : null;
  if (b && publishedMs >= b.open && publishedMs < b.close) {
    const t = publishedMs + PROCESSING_DELAY_MS;
    const k = Math.max(1, Math.ceil((t - b.open) / BAR_MS));
    const boundary = b.open + k * BAR_MS;
    if (boundary < b.close) return { ms: boundary, session: date, outsideHours: false };
    const next = nextTradingDay(date, 'NYSE');
    return { ms: firstBarClose(next), session: next, outsideHours: false, pastClose: true };
  }
  // Outside regular hours: the first bar close of the next session that opens after publication (today if pre-market).
  const s = b && publishedMs < b.open ? date : nextSessionOnOrAfter(b ? nextTradingDay(date, 'NYSE') : date);
  return { ms: firstBarClose(s), session: s, outsideHours: true };
}

// Every item in one shape: { id, kind: news|filing|fomc, stocks, occurred, publishedMs, eligibleMs, session, revised, headline, summary, ... }.
export function newsItems(rows) {
  return rows.map((r) => {
    const publishedMs = Date.parse(r.createdAt);
    const updatedMs = r.updatedAt ? Date.parse(r.updatedAt) : null;
    const revised = updatedMs != null && updatedMs - publishedMs > REVISION_MS;
    const e = eligibleOf(publishedMs);
    const basket = [...new Set((r.basketSymbols ?? r.symbols).map((s) => (s === 'FB' ? 'META' : s)).filter((s) => BASKET.includes(s)))];
    const stocks = r.symbols.length <= MAX_SYMBOLS ? basket : [];
    return { id: `news:${r.id}`, kind: 'news', stocks, allSymbols: r.symbols, occurred: null, publishedMs, eligibleMs: e.ms, session: e.session, outsideHours: e.outsideHours, revised, headline: r.headline ?? null, summary: revised ? null : (r.summary ?? null), source: r.source ?? null };
  });
}
export function filingItems(rows) {
  return rows.map((f) => {
    const publishedMs = etMs(f.acceptedEt);
    const e = eligibleOf(publishedMs);
    return { id: `filing:${f.accession}`, kind: 'filing', stocks: [f.symbol], allSymbols: [f.symbol], occurred: f.reportDate ?? null, publishedMs, eligibleMs: e.ms, session: e.session, outsideHours: e.outsideHours, revised: false, headline: `${f.symbol} filed ${f.form}${f.items.length ? ` (items ${f.items.join(', ')})` : ''}`, summary: null, form: f.form, items: f.items };
  });
}
export function fomcItems(rows) {
  return rows.map((f) => {
    const publishedMs = etMs(f.releaseEt);
    const e = eligibleOf(publishedMs);
    return { id: `fomc:${f.id}`, kind: 'fomc', stocks: [], allSymbols: [], occurred: f.releaseEt, publishedMs, eligibleMs: e.ms, session: e.session, outsideHours: e.outsideHours, revised: false, headline: f.title || 'FOMC statement', summary: null, contextOnly: true, timeKnown: f.timeKnown };
  });
}

// One plan per stock and session with at least one newly eligible item about it (CAMPAIGN-1.md section 5): the plan
// time T is the eligible time of the session's first such item; the session's later items stay attached for the
// contradiction rule. Sessions after the bound are never formed.
export function planGroups(items, { from, to = MAX_DATE }) {
  const by = new Map();
  for (const it of items) {
    if (it.session < from || it.session > to) continue;
    for (const s of it.stocks) {
      const k = `${s}|${it.session}`;
      if (!by.has(k)) by.set(k, { stock: s, session: it.session, items: [] });
      by.get(k).items.push(it);
    }
  }
  const out = [...by.values()];
  for (const g of out) { g.items.sort((a, b) => a.eligibleMs - b.eligibleMs || (a.id < b.id ? -1 : 1)); g.T = g.items[0].eligibleMs; }
  return out.sort((a, b) => a.T - b.T || (a.stock < b.stock ? -1 : 1));
}
export { bounds as sessionBoundsMs, firstBarClose };
