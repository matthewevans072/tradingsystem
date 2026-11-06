// Events, exactly as CAMPAIGN-1.md section 3 defines them, and the mechanical guidance classifier of section 4.
// Pure functions of the stored filings, the exhibit texts, the NYSE calendar and the stock's sessions; nothing here
// reads prices except `reactionOf`, which uses only closes up to the event's availability session. No language
// model, no judgement: the classifier is the word rule of classifier-v1.json applied by code.
import { regularSessionBounds } from '../calendar.js';
import { zonedToUtc, addDays } from '../time.js';
import { MAX_DATE, WINDOW } from './config.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ET = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// "YYYY-MM-DD HH:MM:SS" Eastern -> epoch ms.
export function etToMs(et) {
  const m = String(et ?? '').match(ET);
  if (!m) return null;
  return new Date(zonedToUtc(m[1], Number(m[2]), Number(m[3]))).getTime() + Number(m[4]) * 1000;
}
const closeMs = (date) => { const b = regularSessionBounds(date); return b ? new Date(b.close).getTime() : null; };
const openMs = (date) => { const b = regularSessionBounds(date); return b ? new Date(b.open).getTime() : null; };

// First index in a sorted list with list[i] >= x (or list.length).
export function lowerBound(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

// ---------- 3.2 grouping ----------
// filings: parsed rows { accession, symbol, form, acceptedEt, reportDate, filingDate, items, status } of one or more
// stocks. Returns { events, excluded } with every event's D, its earliest acceptance, its filings and amendments.
export function groupEvents(filings, { groupDays = 3, interimDays = 45, documents = null } = {}) {
  const events = [], excluded = [];
  const bySymbol = new Map();
  for (const f of filings) {
    if (f.status !== 'ok' || !(f.items || []).includes('2.02')) continue;
    if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, []);
    bySymbol.get(f.symbol).push(f);
  }
  for (const [symbol, list] of [...bySymbol.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const dOf = (f) => {
      const accDate = f.acceptedEt ? f.acceptedEt.slice(0, 10) : f.filingDate;
      if (!DATE.test(f.reportDate || '')) return { D: accDate, flag: 'no_report_date' };
      if (f.reportDate > accDate) return { D: accDate, flag: 'report_date_after_acceptance' };
      return { D: f.reportDate, flag: null };
    };
    const byAcceptance = (a, b) => ((a.acceptedEt ?? `${a.filingDate} 23:59:59`) < (b.acceptedEt ?? `${b.filingDate} 23:59:59`) ? -1 : (a.acceptedEt ?? '') > (b.acceptedEt ?? '') ? 1 : a.accession < b.accession ? -1 : 1);
    const originals = list.filter((f) => f.form === '8-K').sort(byAcceptance);
    const amendments = list.filter((f) => f.form === '8-K/A').sort(byAcceptance);
    const mine = [];
    for (const f of originals) {
      const { D, flag } = dOf(f);
      const cur = mine.at(-1);
      if (cur && days(cur.D, D) <= groupDays) { cur.filings.push(f.accession); if (flag) cur.flags.push(flag); continue; }
      mine.push({ id: `${symbol}:${D}`, symbol, D, acceptedEt: f.acceptedEt ?? null, filingDate: f.filingDate, filings: [f.accession], amendments: [], flags: flag ? [flag] : [], interim: false });
    }
    // The earliest acceptance of the group (filings are in acceptance order, so the first one's).
    for (const a of amendments) {
      const { D } = dOf(a);
      const host = mine.find((e) => Math.abs(days(e.D, D)) <= groupDays);
      if (host) host.amendments.push(a.accession); else excluded.push({ id: `${symbol}:${D}:amendment`, symbol, D, reason: 'amendment_only', accession: a.accession });
    }
    mine.sort((a, b) => (a.D < b.D ? -1 : a.D > b.D ? 1 : 0));
    for (let i = 1; i < mine.length; i++) mine[i].interim = days(mine[i - 1].D, mine[i].D) < interimDays;
    if (documents) for (const e of mine) e.textAccession = e.filings.find((acc) => documents.get(acc)?.status === 'ok') ?? null;
    events.push(...mine);
  }
  return { events, excluded };
}

// ---------- 3.3 to 3.5 placement ----------
// calendar: every NYSE session of the window, sorted. stockSessions: { SYM: sorted sessions with a bar }.
// listings: { SYM: listedFrom }. Returns { placed, prewindow, excluded }.
// sleeveOnly: events with an availability session but no pre-event bar (announced just before a stock's prices start):
// excluded from families B to D, but real announcements for family A's estimates and re-entries.
export function placeEvents(events, { calendar, stockSessions, listings }) {
  const placed = [], prewindow = [], excluded = [], sleeveOnly = [];
  const firstClose = closeMs(calendar[0]);
  for (const e of events) {
    const own = stockSessions[e.symbol] || [];
    const listed = listings[e.symbol];
    let A = etToMs(e.acceptedEt), unknownTime = false;
    if (A == null) { unknownTime = true; A = etToMs(`${e.filingDate} 23:59:59`); }
    const base = { ...e, acceptedMs: A, unknownTime };
    // A listing inside the window (VST, SNAP) is a real listing date; a listedFrom equal to the window's first session
    // is only where the price data starts, so earlier announcements of such a stock are real (pre-window) events.
    if (listed && listed > calendar[0] && e.D < listed) { excluded.push({ ...base, reason: 'before_listing' }); continue; }
    // Known before the first window session's close: delivered at the first session (family A's estimates only).
    if (A < firstClose) { prewindow.push(base); continue; }
    // The first session whose close is strictly after A (searching from A's Eastern date, since a session that day
    // may still close after A), then the stock's next session with a bar.
    let i = lowerBound(calendar, isoDateEt(A));
    while (i < calendar.length && !(closeMs(calendar[i]) > A)) i++;
    if (i >= calendar.length) { excluded.push({ ...base, reason: 'after_window' }); continue; }
    const j = lowerBound(own, calendar[i]);
    if (j >= own.length || own[j] > MAX_DATE) { excluded.push({ ...base, reason: 'after_window' }); continue; }
    const availDate = own[j];
    const pIdx = lowerBound(own, e.D) - 1;
    if (pIdx < 0) { const x = { ...base, availDate, reason: 'no_pre_event_bar' }; excluded.push(x); sleeveOnly.push(x); continue; }
    placed.push({ ...base, availDate, preDate: own[pIdx], timing: timingClass(e, A, unknownTime, calendar) });
  }
  return { placed, prewindow, excluded, sleeveOnly };
}
// The Eastern calendar date of an instant.
export function isoDateEt(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function timingClass(e, A, unknownTime, calendar) {
  if (unknownTime) return 'unknown';
  const aDate = isoDateEt(A);
  if (aDate > e.D) return 'filed_after_report_date';
  const sessionDay = calendar.includes(e.D);
  if (!sessionDay) return 'non_session_day';
  if (A < openMs(e.D)) return 'before_open';
  if (A < closeMs(e.D)) return 'during_session';
  return 'after_close';
}

// One session later for every event (the delay sensitivity, CAMPAIGN-1.md section 7); an event pushed past the
// stock's last session leaves the window.
export function delayEvents(placed, stockSessions, extra = 1) {
  const out = [];
  for (const e of placed) {
    const own = stockSessions[e.symbol];
    const j = lowerBound(own, e.availDate) + extra;
    if (j < own.length) out.push({ ...e, availDate: own[j], delayed: extra });
  }
  return out;
}

// ---------- 3.4 the reaction (closes up to the availability session only) ----------
// closeAt(symbol, date) returns the close in post-split units as of the availability session.
export function reactionOf(e, closeAt) {
  const c0 = closeAt(e.symbol, e.preDate), c1 = closeAt(e.symbol, e.availDate);
  if (!(c0 > 0) || !(c1 > 0)) return null;
  return c1 / c0 - 1;
}
export function reactionClass(R, threshold = 0.05) {
  if (R == null || !Number.isFinite(R)) return null;
  if (R <= -threshold + 1e-12) return 'negative';
  if (R >= threshold - 1e-12) return 'positive';
  return 'neutral';
}

// ---------- 3.6 family A's estimates ----------
// From the events a stock has (in order of D), the non-interim ones each give D + offset; an estimate within
// minGapDays of the stock's previous kept estimate is dropped. Pure and prefix-invariant: an estimate depends only on
// events dated before it is known.
export function estimatesFrom(events, { offsetDays = 364, minGapDays = 45 } = {}) {
  const out = [];
  const last = new Map();
  for (const e of [...events].sort((a, b) => (a.D < b.D ? -1 : a.D > b.D ? 1 : a.symbol < b.symbol ? -1 : 1))) {
    if (e.interim) continue;
    const est = addDays(e.D, offsetDays);
    const prev = last.get(e.symbol);
    if (prev && days(prev, est) < minGapDays) continue;
    last.set(e.symbol, est);
    out.push({ symbol: e.symbol, fromEvent: e.id, fromD: e.D, estimate: est, knownAt: e.availDate ?? null });
  }
  return out;
}

// ---------- 4. the classifier ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function normaliseRelease(raw, cl) {
  let s = String(raw ?? '');
  for (const b of cl.removeBlocks) s = s.replace(new RegExp(`<${b}\\b[\\s\\S]*?</${b}\\s*>`, 'gi'), ' ');
  const brk = new RegExp(`</?(?:${cl.lineBreakTags.join('|')})\\b[^>]*>`, 'gi');
  s = s.replace(brk, '\n').replace(/<[^>]*>/g, ' ');
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (_, n) => ENTITIES[n.toLowerCase()] ?? ' ');
  s = s.toLowerCase().replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"').replace(/[‐-―−]/g, '-').replace(/ /g, ' ');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  return s;
}
export function sentencesOf(norm, cl) {
  const enders = cl.sentenceEnders.map((c) => `\\${c}`).join('');
  const out = [];
  for (const line of norm.split(/\n+/)) {
    for (const part of line.split(new RegExp(`(?<=[${enders}])\\s+`))) { const t = part.trim(); if (t) out.push(t); }
  }
  return out;
}
export function classifyRelease(raw, cl) {
  if (raw == null) return { cls: 'no_text', r: 0, l: 0, a: 0, sentences: 0, excluded: 0 };
  const norm = normaliseRelease(raw, cl);
  const all = sentencesOf(norm, cl);
  if (!all.length) return { cls: 'no_text', r: 0, l: 0, a: 0, sentences: 0, excluded: 0 };
  const nouns = new Set(cl.guidanceNouns), up = new Set(cl.raiseWords), down = new Set(cl.lowerWords), keep = new Set(cl.reaffirmWords);
  let r = 0, l = 0, a = 0, excluded = 0;
  for (const s of all) {
    if (cl.excludedPhrases.some((p) => s.includes(p))) { excluded++; continue; }
    const words = s.match(/[a-z]+/g) || [];
    if (!words.some((w) => nouns.has(w))) continue;
    if (words.some((w) => up.has(w))) r++;
    if (words.some((w) => down.has(w))) l++;
    if (words.some((w) => keep.has(w))) a++;
  }
  const cls = l > 0 && r === 0 ? 'lowered' : r > 0 && l === 0 ? 'raised' : r > 0 && l > 0 ? 'mixed' : a > 0 ? 'reaffirmed' : 'none_detected';
  return { cls, r, l, a, sentences: all.length, excluded };
}

// ---------- the inventory (CAMPAIGN-1.md section 9's categories; counts only) ----------
export function inventoryOf({ grouped, placement, reactions, classes, estimates, calendar, stockSessions, threshold = 0.05, symbols }) {
  const per = Object.fromEntries(symbols.map((s) => [s, { events: 0, usable: 0, prewindow: 0, excluded: {}, timing: {}, reaction: { negative: 0, positive: 0, neutral: 0, unknown: 0 }, guidance: {}, interim: 0 }]));
  const total = { events: 0, usable: 0, prewindow: 0, excluded: {}, timing: {}, reaction: { negative: 0, positive: 0, neutral: 0, unknown: 0 }, guidance: {}, interim: 0 };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const both = (sym, fn) => { fn(per[sym]); fn(total); };
  for (const e of grouped.events) both(e.symbol, (o) => o.events++);
  for (const x of grouped.excluded) both(x.symbol, (o) => inc(o.excluded, x.reason));
  for (const x of placement.excluded) both(x.symbol, (o) => inc(o.excluded, x.reason));
  for (const e of placement.prewindow) both(e.symbol, (o) => o.prewindow++);
  const cats = { usable: 0, negative: 0, positive: 0, lowered: 0, negative_unchanged_or_raised: 0, negative_lowered: 0, positive_raised: 0 };
  for (const e of placement.placed) {
    const R = reactions.get(e.id), rc = reactionClass(R, threshold) ?? 'unknown', g = classes.get(e.id)?.cls ?? 'no_text';
    both(e.symbol, (o) => { o.usable++; inc(o.timing, e.timing); o.reaction[rc]++; inc(o.guidance, g); if (e.interim) o.interim++; });
    cats.usable++;
    if (rc === 'negative') cats.negative++;
    if (rc === 'positive') cats.positive++;
    if (g === 'lowered') cats.lowered++;
    if (rc === 'negative' && (g === 'raised' || g === 'reaffirmed')) cats.negative_unchanged_or_raised++;
    if (rc === 'negative' && g === 'lowered') cats.negative_lowered++;
    if (rc === 'positive' && g === 'raised') cats.positive_raised++;
  }
  const inWindow = (estimates || []).filter((x) => x.estimate >= WINDOW.from && x.estimate <= MAX_DATE);
  cats.estimates_in_window = inWindow.length;
  const perEst = {};
  for (const x of inWindow) perEst[x.symbol] = (perEst[x.symbol] || 0) + 1;
  for (const s of symbols) per[s].estimatesInWindow = perEst[s] || 0;
  // Dependence: distinct availability dates and the largest group of stocks sharing one.
  const byDate = new Map();
  for (const e of placement.placed) byDate.set(e.availDate, (byDate.get(e.availDate) || 0) + 1);
  const dependence = { distinctAvailabilityDates: byDate.size, largestSameDateGroup: byDate.size ? Math.max(...byDate.values()) : 0, datesWithSeveralStocks: [...byDate.values()].filter((n) => n > 1).length };
  const usableRange = placement.placed.length ? { first: placement.placed.map((e) => e.availDate).sort()[0], last: placement.placed.map((e) => e.availDate).sort().at(-1) } : null;
  return { perStock: per, total, categories: cats, dependence, usableRange, calendar: { first: calendar[0], last: calendar.at(-1) }, stockFirstSessions: Object.fromEntries(symbols.map((s) => [s, stockSessions[s]?.[0] ?? null])) };
}
