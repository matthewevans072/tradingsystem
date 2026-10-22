// Data-readiness checklist for the Strategy Lab (strategy/DATA-READINESS.md).
// For every universe-v1 symbol and every pre-registered period it reports,
// from the stored bars, the exchange calendar, strategy/corporate-actions-v1.json
// and the recorded source of each bar: (a) instrument and exchange, (b)
// coverage, (c) timestamps, timezone and session boundaries, (d) OHLCV
// completeness, (e) split and dividend conventions and (f) the source's costs,
// limits and permitted use. It only reports: it never shortens a period,
// replaces a symbol, adjusts a bar or proposes revised dates. A period is
// usable only when every symbol is READY for it.
import fs from 'node:fs';
import path from 'node:path';
import { STRATEGY_DIR, deepFreeze, excludedSessionDates } from './config.js';
import { barInfo, tradingDays, expectedBarsInSession, sessionBarStarts, sessionBounds, etClock, dayStartMs } from './sessions.js';
import { previousTradingDay, nextTradingDay } from '../calendar.js';
import { addDays, weekdayOf } from '../time.js';
import * as store from './store.js';

export const PERIODS = ['warmup', 'development', 'validation', 'holdout'];
export const PERIOD_LABEL = { warmup: 'Warm-up', development: 'Development', validation: 'Validation', holdout: 'Holdout' };
export const READY = 'READY';
export const NOT_READY = 'NOT READY';
export const NO_DATA = 'NO DATA';
export const CORPORATE_ACTIONS_FILE = path.join(STRATEGY_DIR, 'corporate-actions-v1.json');

// A known split's first adjusted session: an open within 25% of the previous
// close reads as adjusted, within 25% of close / ratio as not adjusted.
const SPLIT_TOL = Math.log(1.25);
// The unknown-split scan flags overnight ratios within 8% of these.
export const SCAN_RATIOS = [1.5, 2, 3, 4, 5, 8, 10, 20];
const SCAN_TOL = Math.log(1.08);
const SAMPLE = 10;

const iso = (ms) => new Date(ms).toISOString();
const round = (x, dp = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);
const pct = (a, b) => (b > 0 ? round((a / b) * 100, 2) : null);
const tally = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const sortedObj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
const upper = (s) => String(s || '').trim().toUpperCase();

export function loadCorporateActions(file = CORPORATE_ACTIONS_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.symbols || typeof raw.symbols !== 'object') throw new Error('Corporate-actions file needs a symbols object');
  return deepFreeze(raw);
}

// ---------- facts from the 2026-10-22 research (search summaries) ----------

const ALPACA_DOCS = 'https://docs.alpaca.markets/us/docs/about-market-data-api';
export const SOURCE_FACTS = deepFreeze({
  lastSeen: '2026-10-22',
  method: 'Official-domain web-search summaries made on 2026-10-22, not fetched pages and not a real data pull. Prices and plans change: confirm on the vendor\'s live page before paying or relying on them.',
  sources: [
    {
      id: 'alpaca', name: 'Alpaca Market Data, Basic (free) plan', role: 'Preferred history source in Signal Desk (adjustment=split, feed=sip). Not yet tested with a real pull.',
      facts: [
        { item: 'Plan and price', value: 'Basic: free. Algo Trader Plus: US$99/month (all US exchanges, SIP, real time).', status: 'official search summary', url: ALPACA_DOCS },
        { item: 'History depth', value: 'Equity history since 2016 on Basic and Algo Trader Plus, which would cover 2021-07-01 to 2026-06-30. Per-symbol completeness is unknown until a pull.', status: 'official search summary', url: ALPACA_DOCS },
        { item: 'Feed and volume coverage', value: 'feed=sip is the consolidated tape (100% of US volume) and must be passed explicitly. Free real-time data is IEX only (about 2.5% of volume).', status: 'official search summary', url: ALPACA_DOCS },
        { item: 'Free-plan restriction', value: 'Historical SIP data is available on Basic only when it is more than 15 minutes old; recent timestamps return an error.', status: 'official search summary', url: 'https://docs.alpaca.markets/us/docs/market-data-faq' },
        { item: 'Adjustment', value: 'adjustment=raw (default), split (price and volume), dividend, spin-off or all. Signal Desk requests split only, as splits-v1 requires.', status: 'official search summary', url: 'https://docs.alpaca.markets/us/reference/stockbars' },
        { item: 'Split-adjustment reliability', value: 'Forum reports describe SIP bars left unadjusted around a 2022 split. Checked here at NVDA\'s split dates and by the overnight-ratio scan.', status: 'unverified (forum reports)', url: 'https://forum.alpaca.markets/t/data-is-not-adjusted-for-splits-despite-adjustment-split-flag/7753' },
        { item: 'Timestamps and session', value: 'RFC-3339 UTC timestamps appear in forum examples. Whether they mark the bar start, and whether 15Min bars include extended-hours trades, is not documented; Signal Desk keeps 09:30-16:00 ET bars only and checks the 15-minute grid.', status: 'unverified', url: 'https://forum.alpaca.markets/t/adjusted-historical-data/5821' },
        { item: 'Rate limit', value: 'About 200 requests/minute on the free plan according to a forum thread title. Signal Desk backs off and retries on HTTP 429.', status: 'unverified', url: null },
        { item: 'Licence', value: 'Personal, non-commercial use only; no redistribution of the data or anything derived from it. A private single-user loopback dashboard appears consistent; sharing it does not. The terms found are 5-6 years old.', status: 'official search summary', url: 'https://alpaca.markets/support/redistribute-alpaca-api' },
        { item: 'Storage and deletion', value: 'No storage or deletion terms were found.', status: 'not found', url: null },
      ],
    },
    {
      id: 'twelvedata', name: 'Twelve Data (Basic free plan unless upgraded)', role: 'Market-data provider already supported by Signal Desk (quotes and history). Not verified to cover the required history.',
      facts: [
        { item: 'Plan and price', value: 'Individual plans after the March 2026 restructure: Basic free, Grow US$79/month, Pro US$229/month, Ultra US$999/month (older pages still show US$29/US$99/US$329).', status: 'official search summary', url: 'https://twelvedata.com/news/march-2026-updates' },
        { item: 'Credits and rate limit', value: 'Basic: 8 credits per minute and 800 per day (resets 00:00 UTC); HTTP 429 when used up. A 5-year 15-minute pull for 17 symbols is about 120 requests of 5,000 bars, if the history exists.', status: 'official search summary', url: 'https://twelvedata.com/pricing' },
        { item: 'History depth', value: 'Official pages conflict: the US exchange page says US intraday data starts 2022-12-15 (2021-07-01 to 2022-12-14 would be missing on every plan); support articles say 1-minute data from 2020-02-10. Depth is plan-gated (full history needs Ultra or Enterprise). What Basic gets for 15-minute history is not stated.', status: 'unverified (conflicting official pages)', url: 'https://twelvedata.com/exchanges/stocks' },
        { item: 'Adjustment', value: 'The support FAQ (about April 2025) says intraday bars are unadjusted. The time_series adjust parameter\'s values and default are unverified. Signal Desk does not send it, so Twelve Data bars are recorded as adjustment "unknown".', status: 'official search summary (FAQ); parameter unverified', url: 'https://support.twelvedata.com/en/articles/5179064-are-the-prices-adjusted' },
        { item: 'Volume coverage', value: 'The default real-time US feed covers about 5% of US volume. Historical and end-of-day data are described as 100% of volume; whether that includes intraday bars is not stated.', status: 'official search summary', url: 'https://support.twelvedata.com/en/articles/9935903-us-equities-market-data' },
        { item: 'Display use', value: 'The pricing page labels Basic "internal non-display use" and Grow "internal display data access". Whether a private dashboard counts as display is not defined.', status: 'unverified', url: 'https://twelvedata.com/pricing' },
        { item: 'Licence', value: 'Individual plans: personal or internal, non-commercial use; no redistribution or display to third parties; attribution when displayed publicly.', status: 'official search summary', url: 'https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage' },
        { item: 'Storage and deletion', value: 'The Terms limit keeping Data to the subscription period and require deleting it on termination (one clause: within 30 days). Whether this applies to Basic and to a local audit cache is unclear.', status: 'official search summary (excerpts only)', url: 'https://twelvedata.com/terms' },
      ],
    },
    {
      id: 'massive', name: 'Massive (formerly Polygon.io), Developer plan', role: 'Paid fallback named by the research. Not implemented in Signal Desk.',
      facts: [
        { item: 'Plan and price', value: 'Developer US$79/month: 10 years of history, 15-minute delayed. Starter US$29: 5 years (if the window rolls, as of 2026-10-22 only back to about 2021-10-22, short of 2021-07-01). Advanced US$199/month: real time.', status: 'official search summary', url: 'https://massive.com/stocks' },
        { item: 'Adjustment', value: 'REST aggregates are split-adjusted by default and never dividend-adjusted, which matches splits-v1.', status: 'official search summary', url: 'https://massive.com/knowledge-base/article/is-massives-stock-data-adjusted-for-splits-or-dividends' },
        { item: 'Timestamps and volume', value: 'Unix-millisecond bar start; extended hours (04:00-20:00 ET) included and selected by timestamp; bars built under CTA/UTP SIP trade conditions (consolidated volume inferred, not stated).', status: 'official search summary; consolidated volume likely', url: 'https://massive.com/knowledge-base/article/how-does-massive-create-aggregate-bars' },
        { item: 'Licence', value: 'Individual plans: personal, non-professional use; showing the data to anyone else needs a Business plan.', status: 'official search summary', url: 'https://massive.com/knowledge-base/article/which-plan-do-i-need-to-show-massive-data-in-my-app' },
      ],
    },
    {
      id: 'csv', name: 'CSV import (for example a TradingView chart export)', role: 'Owner-supplied files.',
      facts: [
        { item: 'Adjustment, feed and licence', value: 'Depend on where the file came from (a TradingView export follows the chart\'s settings and your TradingView data plan). Signal Desk records them as "unknown".', status: 'not declared', url: null },
      ],
    },
  ],
});

export const FORWARD_FEEDS = deepFreeze({
  lastSeen: '2026-10-22',
  warning: 'The forward test needs a real-time consolidated (SIP) feed. With Alpaca\'s free plan, SIP bars are available only once they are at least 15 minutes old, so every forward signal would expire under the 5-minute rule (LAB_MAX_SIGNAL_DELAY_MIN). Twelve Data\'s free real-time feed covers about 5% of US volume, so the volume rule would not see the volume the history has. Forward results on either free feed would not be comparable with the backtest.',
  adapter: 'Signal Desk\'s forward test reads bars only through MARKET_DATA_PROVIDER (Twelve Data or Finnhub); it has no Alpaca or Massive forward adapter.',
  options: [
    { name: 'Alpaca Basic (free)', realTime: 'IEX only (about 2.5% of volume); SIP only when 15+ minutes old', price: 'free', fit: 'Not suitable: SIP bars arrive too late for the 5-minute rule; IEX volume is not consolidated.', status: 'official search summary' },
    { name: 'Alpaca Algo Trader Plus', realTime: 'all US exchanges (SIP)', price: 'US$99/month', fit: 'Consolidated and real time; would need a forward adapter.', status: 'official search summary' },
    { name: 'Twelve Data plans (default feed)', realTime: 'about 5% of US volume', price: 'free to US$999/month', fit: 'Not suitable for the volume rule: forward volume would not match consolidated history.', status: 'official search summary' },
    { name: 'Twelve Data licensed full-market feed', realTime: 'consolidated, arranged with Twelve Data', price: 'not published', fit: 'Possible; price and terms unknown.', status: 'official search summary (no price found)' },
    { name: 'Massive Developer', realTime: '15-minute delayed', price: 'US$79/month', fit: 'Not suitable: delayed.', status: 'official search summary' },
    { name: 'Massive Advanced', realTime: 'real time', price: 'US$199/month', fit: 'Possible; personal use only; would need a forward adapter.', status: 'official search summary' },
  ],
});

// Items no bar can prove; each needs the owner or the vendor.
export const OPEN_ITEMS = deepFreeze([
  { id: 'twelvedata-depth', item: 'Twelve Data free-plan coverage', status: 'unverified', detail: 'Whether Basic returns 15-minute US bars back to 2021-07-01. Official pages disagree (2022-12-15 vs 2020). Verify with /earliest_timestamp (interval=15min) for each symbol before any download.' },
  { id: 'alpaca-pull', item: 'Alpaca behaviour', status: 'unverified', detail: 'Per-symbol completeness, bar-start UTC timestamps, extended-hours bars in 15Min, split adjustment of price and volume, and the free-plan rate limit are confirmed only by a real pull (this checklist then reports them).' },
  { id: 'listings', item: 'Primary listing exchange', status: 'unverified for 14 of 17', detail: 'Verified by an official page in the research: VRT (2020 release), SPY, GLD. Likely: XOM, PG, IWM. Unverified: NVDA, AMD, MU, MSFT, JPM, JNJ, HD, CAT, NEE, FCX, PLD.' },
  { id: 'splits', item: 'Splits for the other symbols', status: 'none found, unverified', detail: 'Only NVDA\'s two splits were confirmed. AMD, JPM, XOM, PG, HD, NEE (after 2020), FCX, PLD, SPY, IWM and GLD were not searched per symbol; the overnight-ratio scan below is the check from bars.' },
  { id: 'dividends', item: 'Dividend adjustment', status: 'declared by source, not independently verified', detail: 'splits-v1 needs split-only bars. Bars alone cannot prove that prices were not dividend-adjusted; this rests on the source\'s declared mode (Alpaca adjustment=split).' },
  { id: 'calendar', item: 'Exchange calendar 2021-2025', status: 'rule-generated', detail: 'server/calendar.js generates NYSE holidays and 1 p.m. early closes from the published rules (plus the 2025-01-09 closure) and is cross-checked against NYSE\'s published schedule for 2026-2027 only. Expected sessions for 2021-2025 should be compared once with NYSE\'s historical holiday lists.' },
  { id: 'licence', item: 'Permitted use', status: 'likely personal use', detail: 'Each vendor\'s individual plan is personal and non-commercial; a private, loopback-only Strategy Lab appears to fit. Twelve Data Basic\'s "non-display" label is undefined. Nothing may be shared with others.' },
  { id: 'forward-feed', item: 'Forward-test feed', status: 'not available', detail: 'No real-time consolidated feed is configured; see the forward-feed warning.' },
]);

// ---------- calendar helpers ----------

// [{ change, direction }] US daylight-saving changes (second Sunday of March,
// first Sunday of November) between two dates.
export function dstChanges(from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const firstSunday = (m) => addDays(`${y}-${m}-01`, (7 - weekdayOf(`${y}-${m}-01`)) % 7);
    for (const [d, direction] of [[addDays(firstSunday('03'), 7), 'to EDT (UTC-4)'], [firstSunday('11'), 'to EST (UTC-5)']]) {
      if (d >= from && d <= to) out.push({ change: d, direction });
    }
  }
  return out;
}

// Sessions and bars each period expects. Sessions the splits version excludes
// for every symbol are not expected and are listed separately.
export function periodTable(periods, exchange = 'NYSE', excluded = []) {
  const ex = new Set(excluded);
  return PERIODS.map((k) => {
    const { from, to } = periods[k];
    const all = tradingDays(from, to, exchange);
    const days = all.filter((d) => !ex.has(d));
    const early = days.filter((d) => sessionBounds(d, exchange)?.earlyClose);
    return {
      key: k, label: PERIOD_LABEL[k], from, to, sessions: days.length, earlyCloses: early.length, earlyCloseDates: early,
      expectedBars: days.reduce((s, d) => s + expectedBarsInSession(d, exchange), 0),
      excludedSessions: all.filter((d) => ex.has(d)),
    };
  });
}

function ranges(dates, exchange) {
  const out = [];
  for (const d of dates) {
    const last = out[out.length - 1];
    if (last && nextTradingDay(last.to, exchange) === d) { last.to = d; last.sessions++; } else out.push({ from: d, to: d, sessions: 1 });
  }
  return out;
}

// ---------- one symbol ----------

const affects = (issue, p) => issue.all || (issue.date && (issue.cumulative ? issue.date <= p.to : issue.date >= p.from && issue.date <= p.to));

// Per-bar problems are counted, not listed one by one.
const PER_BAR = new Set(['outside_session', 'off_grid', 'ohlc', 'zero_volume', 'missing_volume', 'conflicting_duplicates']);
function summarize(list) {
  const groups = new Map();
  for (const x of list) {
    const key = PER_BAR.has(x.code) ? `${x.item}|${x.code}` : `${x.item}|${x.code}|${x.period || ''}|${x.message}`;
    if (!groups.has(key)) groups.set(key, { ...x, count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()].map((x) => (PER_BAR.has(x.code)
    ? `${x.item}: ${x.count} bar${x.count === 1 ? '' : 's'} with ${x.message} (first ${x.date})`
    : `${x.item}: ${x.message}`));
}

// bars: [{ t, o, h, l, c, v }] in any order, as stored or as a source returned
// them. periods: { warmup, development, validation, holdout } with from/to.
// actions: this symbol's entry in corporate-actions-v1.json; listing: its
// entry in listings; keys: the stored source keys in the window; ingestion:
// totals over the symbol's stored bar sets.
export function checkSymbolBars(bars, {
  symbol, exchange = 'NYSE', periods, actions = null, listing = null, keys = [], ingestion = null, reviewed = [], sourceReportedExchange = null, excluded = [],
} = {}) {
  const win = { from: periods.warmup.from, to: periods.holdout.to };
  // Sessions the splits version excludes for every symbol: their bars are set
  // aside (runs never see them) and nothing is expected on those days.
  const excludedSet = new Set(excluded);
  const prevSession = (d) => { let x = previousTradingDay(d, exchange); while (excludedSet.has(x)) x = previousTradingDay(x, exchange); return x; };
  const nextSession = (d) => { let x = nextTradingDay(d, exchange); while (excludedSet.has(x)) x = nextTradingDay(x, exchange); return x; };
  const excludedBars = new Map();
  const issues = [];
  const issue = (item, code, message, where = {}) => issues.push({ item, code, message, ...where });

  // Parse, sort, de-duplicate.
  const rows = [];
  let invalidTime = 0, unsorted = 0;
  for (const b of bars || []) {
    const ms = typeof b.t === 'number' ? b.t : b.t instanceof Date ? b.t.getTime() : Date.parse(b.t);
    if (!Number.isFinite(ms)) { invalidTime++; continue; }
    if (rows.length && ms < rows[rows.length - 1].ms) unsorted++;
    rows.push({ ms, o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: b.v == null || b.v === '' ? null : Number(b.v) });
  }
  rows.sort((a, b) => a.ms - b.ms);
  const dup = { identical: 0, conflicting: 0, sample: [] };
  const uniq = [];
  for (const r of rows) {
    const p = uniq[uniq.length - 1];
    if (p && p.ms === r.ms) {
      const same = p.o === r.o && p.h === r.h && p.l === r.l && p.c === r.c && p.v === r.v;
      if (same) dup.identical++; else dup.conflicting++;
      if (dup.sample.length < SAMPLE) dup.sample.push({ t: iso(r.ms), identical: same });
      const d = barInfo(r.ms, exchange).date;
      if (!same && d >= win.from && d <= win.to) issue('ohlcv', 'conflicting_duplicates', 'a conflicting duplicate (two different bars for the same time)', { date: d });
      continue;
    }
    uniq.push(r);
  }

  // Classify each bar: outside the window, outside the regular session, off the grid, or clean.
  const outside = { preMarket: 0, afterHours: 0, afterEarlyClose: 0, nonTradingDay: 0, sample: [] };
  const offGrid = { count: 0, sample: [] };
  const outsideWindow = { before: 0, after: 0 };
  const perDay = new Map();
  for (const r of uniq) {
    const bi = barInfo(r.ms, exchange, 15);
    if (bi.date < win.from) { outsideWindow.before++; continue; }
    if (bi.date > win.to) { outsideWindow.after++; continue; }
    if (excludedSet.has(bi.date)) { excludedBars.set(bi.date, (excludedBars.get(bi.date) || 0) + 1); continue; }
    if (!bi.inSession) {
      if (bi.reason === 'no session that day') outside.nonTradingDay++;
      else if (bi.reason === 'before the open') outside.preMarket++;
      else { outside.afterHours++; if (bi.earlyClose) outside.afterEarlyClose++; }
      if (outside.sample.length < SAMPLE) outside.sample.push({ t: iso(r.ms), et: `${bi.date} ${etClock(r.ms, exchange)}`, why: bi.reason });
      issue('timestamps', 'outside_session', 'a time outside the regular session (pre-market, after-hours or a closed day)', { date: bi.date });
      continue;
    }
    if (!bi.aligned) {
      offGrid.count++;
      if (offGrid.sample.length < SAMPLE) offGrid.sample.push({ t: iso(r.ms), et: `${bi.date} ${etClock(r.ms, exchange)}` });
      issue('timestamps', 'off_grid', 'a time off the 15-minute grid from 09:30 ET', { date: bi.date });
      continue;
    }
    if (!perDay.has(bi.date)) perDay.set(bi.date, []);
    perDay.get(bi.date).push({ ...r, date: bi.date });
  }
  const cleanCount = [...perDay.values()].reduce((s, l) => s + l.length, 0);

  // (b) coverage per period.
  const coverage = {};
  for (const k of PERIODS) {
    const { from, to } = periods[k];
    const allDays = tradingDays(from, to, exchange);
    const days = allDays.filter((d) => !excludedSet.has(d));
    let expectedBars = 0, presentBars = 0, early = 0;
    const missing = [], partial = [];
    for (const d of days) {
      const e = expectedBarsInSession(d, exchange);
      const list = perDay.get(d) || [];
      expectedBars += e;
      presentBars += Math.min(list.length, e);
      if (sessionBounds(d, exchange)?.earlyClose) early++;
      if (!list.length) missing.push(d);
      else if (list.length < e) {
        const have = new Set(list.map((b) => b.ms));
        const gaps = sessionBarStarts(d, exchange).filter((t) => !have.has(t));
        partial.push({ date: d, present: list.length, expected: e, missingTimes: gaps.slice(0, 6).map((t) => etClock(t, exchange)), missingCount: gaps.length });
      }
    }
    coverage[k] = {
      from, to, expectedSessions: days.length, sessionsWithBars: days.length - missing.length, earlyCloses: early,
      missingSessions: missing.length, missingSessionRanges: ranges(missing, exchange).slice(0, SAMPLE),
      partialSessions: partial.length, partialSample: partial.slice(0, SAMPLE),
      expectedBars, presentBars, missingBars: expectedBars - presentBars, pctComplete: pct(presentBars, expectedBars),
      excludedSessions: allDays.filter((d) => excludedSet.has(d)).map((d) => ({ date: d, barsSetAside: excludedBars.get(d) || 0 })),
      status: !presentBars ? 'no data' : presentBars === expectedBars ? 'pass' : 'fail',
    };
    if (presentBars && presentBars < expectedBars) {
      const parts = [];
      if (missing.length) parts.push(`${missing.length} of ${days.length} sessions missing (first ${missing[0]})`);
      if (partial.length) parts.push(`${partial.length} partial session${partial.length === 1 ? '' : 's'} (first ${partial[0].date}: ${partial[0].present} of ${partial[0].expected} bars)`);
      issue('coverage', 'incomplete', `${PERIOD_LABEL[k]}: ${presentBars.toLocaleString('en-US')} of ${expectedBars.toLocaleString('en-US')} bars (${coverage[k].pctComplete}%); ${parts.join('; ')}`, { period: k });
    }
  }

  // (c) timestamps, timezone and session boundaries.
  const firstBar = new Map(), lastFull = new Map(), lastEarly = new Map();
  const notAtOpen = [], earlyChecks = [];
  for (const [d, list] of perDay) {
    const s = sessionBounds(d, exchange);
    const first = etClock(list[0].ms, exchange), last = etClock(list[list.length - 1].ms, exchange);
    tally(firstBar, first);
    tally(s.earlyClose ? lastEarly : lastFull, last);
    if (list[0].ms !== s.openMs) notAtOpen.push({ date: d, firstBar: first });
    if (s.earlyClose) earlyChecks.push({ date: d, bars: list.length, expected: expectedBarsInSession(d, exchange), lastBar: last, ok: list.length === expectedBarsInSession(d, exchange) && list[list.length - 1].ms === s.closeMs - 15 * 60000 });
  }
  const dst = dstChanges(win.from, win.to).map((x) => {
    const check = (d) => {
      const list = perDay.get(d);
      if (!list) return { session: d, status: 'no data' };
      const s = sessionBounds(d, exchange);
      const ok = list[0].ms === s.openMs && list.length === expectedBarsInSession(d, exchange);
      return { session: d, firstBar: etClock(list[0].ms, exchange), lastBar: etClock(list[list.length - 1].ms, exchange), bars: list.length, firstBarUtc: iso(list[0].ms), status: ok ? 'pass' : 'fail' };
    };
    const before = check(prevSession(x.change)), after = check(nextSession(x.change));
    return { ...x, before, after, status: [before, after].some((c) => c.status === 'fail') ? 'fail' : [before, after].every((c) => c.status === 'pass') ? 'pass' : 'no data' };
  });
  for (const x of dst.filter((y) => y.status === 'fail')) {
    issue('timestamps', 'dst', `around the ${x.change} daylight-saving change the first session bar is not at 09:30 ET or bars are missing (${[x.before, x.after].map((c) => `${c.session}: ${c.firstBar ?? '—'}, ${c.bars ?? 0} bars`).join('; ')})`, { date: x.after.session });
  }
  const sessionsWithData = perDay.size;
  const share0930 = sessionsWithData ? (firstBar.get('09:30') || 0) / sessionsWithData : null;
  const labelling = !sessionsWithData ? 'no data'
    : share0930 >= 0.5 ? 'bar start (most sessions begin with a 09:30 ET bar)'
      : `not bar start: only ${Math.round(share0930 * 100)}% of sessions begin at 09:30 ET (most begin at ${[...firstBar.entries()].sort((a, b) => b[1] - a[1])[0][0]}); timestamps may mark the bar end or use the wrong timezone`;
  if (sessionsWithData && share0930 < 0.5) issue('timestamps', 'labelling', `bar timestamps: ${labelling}`, { all: true });
  const tsBad = issues.some((x) => x.item === 'timestamps');
  const timestamps = {
    status: !uniq.length || (!cleanCount && !tsBad) ? 'no data' : tsBad ? 'fail' : 'pass',
    timezone: 'Bars are stored as UTC instants and read in America/New_York with the exchange calendar (server/calendar.js), which handles the daylight-saving changes.',
    invalidTime, unsorted, offGrid, outsideSession: { ...outside, total: outside.preMarket + outside.afterHours + outside.nonTradingDay }, outsideWindow,
    labelling, firstBarTimes: sortedObj(firstBar), lastBarTimes: { fullDays: sortedObj(lastFull), earlyCloses: sortedObj(lastEarly) },
    sessionsNotStartingAtOpen: notAtOpen.length, notAtOpenSample: notAtOpen.slice(0, SAMPLE),
    earlyCloses: { sessionsWithBars: earlyChecks.length, ok: earlyChecks.filter((x) => x.ok).length, problems: earlyChecks.filter((x) => !x.ok).slice(0, SAMPLE), rule: 'early-close sessions end at 13:00 ET: 14 bars, the last starting 12:45' },
    dst,
    ingestion: ingestion || null,
  };

  // (d) OHLCV completeness.
  const o = { nonPositive: 0, inconsistent: 0, zeroVolume: 0, missingVolume: 0, sample: [] };
  for (const list of perDay.values()) {
    for (const b of list) {
      const probs = [];
      if (![b.o, b.h, b.l, b.c].every(Number.isFinite) || !(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)) { o.nonPositive++; probs.push(['ohlc', 'a non-positive or missing price']); }
      else if (b.h < b.l || b.o > b.h || b.o < b.l || b.c > b.h || b.c < b.l) { o.inconsistent++; probs.push(['ohlc', 'inconsistent OHLC (high below low, or open/close outside the high-low range)']); }
      if (b.v === 0) { o.zeroVolume++; probs.push(['zero_volume', 'zero volume']); }
      else if (b.v == null || !Number.isFinite(b.v) || b.v < 0) { o.missingVolume++; probs.push(['missing_volume', 'missing volume']); }
      if (probs.length) {
        if (o.sample.length < SAMPLE) o.sample.push({ t: iso(b.ms), et: `${b.date} ${etClock(b.ms, exchange)}`, problems: probs.map((x) => x[1]) });
        for (const [code, msg] of probs) issue('ohlcv', code, msg, { date: b.date });
      }
    }
  }
  if (ingestion?.dropped?.conflictingDuplicates) issue('ohlcv', 'source_conflicting_duplicates', `the source returned ${ingestion.dropped.conflictingDuplicates} conflicting duplicate bar(s); the first of each was kept, so the stored value may be wrong`, { all: true });
  const ohlcvBad = issues.some((x) => x.item === 'ohlcv');
  const ohlcv = {
    status: !cleanCount && !ohlcvBad ? 'no data' : ohlcvBad ? 'fail' : 'pass',
    bars: cleanCount, nonPositive: o.nonPositive, inconsistent: o.inconsistent, zeroVolume: o.zeroVolume, missingVolume: o.missingVolume,
    missingOrZeroVolumePct: cleanCount ? round(((o.zeroVolume + o.missingVolume) / cleanCount) * 100, 3) : null,
    duplicates: { ...dup, droppedAtIngestion: ingestion?.dropped?.duplicates ?? 0, conflictingAtIngestion: ingestion?.dropped?.conflictingDuplicates ?? 0 },
    sample: o.sample,
    note: dup.identical && !dup.conflicting ? `${dup.identical} identical duplicate bar(s) are harmless once de-duplicated.` : null,
  };

  // (e) split and dividend conventions.
  const dates = [...perDay.keys()].sort();
  const sessionVolume = (d) => {
    const list = perDay.get(d);
    if (!list || list.length < expectedBarsInSession(d, exchange) || list.some((b) => !(b.v > 0))) return null;
    return list.reduce((s, b) => s + b.v, 0);
  };
  // The previous session the runs see (excluded sessions are skipped, as in the engine).
  const overnight = (d) => {
    const prev = prevSession(d);
    const a = perDay.get(prev), b = perDay.get(d);
    if (!a || !b) return null;
    return { prevSession: prev, prevClose: a[a.length - 1].c, open: b[0].o, ratio: b[0].o / a[a.length - 1].c, prevCloseIsLastBar: a[a.length - 1].ms === sessionBounds(prev, exchange).closeMs - 15 * 60000, openIsFirstBar: b[0].ms === sessionBounds(d, exchange).openMs };
  };
  const volumeAround = (d, n = 5) => {
    const before = [], after = [];
    for (let x = previousTradingDay(d, exchange), i = 0; i < n * 3 && before.length < n && x >= win.from; i++, x = previousTradingDay(x, exchange)) { const v = sessionVolume(x); if (v != null) before.push(v); }
    for (let x = d, i = 0; i < n * 3 && after.length < n && x <= win.to; i++, x = nextTradingDay(x, exchange)) { const v = sessionVolume(x); if (v != null) after.push(v); }
    if (!before.length || !after.length) return null;
    const mb = before.reduce((s, v) => s + v, 0) / before.length, ma = after.reduce((s, v) => s + v, 0) / after.length;
    return { sessionsBefore: before.length, sessionsAfter: after.length, meanBefore: round(mb, 0), meanAfter: round(ma, 0), ratio: round(ma / mb) };
  };
  const knownSplits = (actions?.actions || []).filter((a) => /split$/.test(a.type) && a.type !== 'split_off_exchange_offer' && Number(a.ratio) > 0 && a.firstAdjustedSession).map((a) => {
    const N = Number(a.ratio), D = a.firstAdjustedSession;
    const base = { label: a.label, ratio: N, firstAdjustedSession: D, source: a.source ?? null, expectedIfAdjusted: 1, expectedIfUnadjusted: round(1 / N) };
    if (D < win.from || D > win.to) return { ...base, status: 'outside the window' };
    const on = overnight(D);
    if (!on) return { ...base, status: 'no data', note: `no bars for ${prevSession(D)} and ${D}` };
    const lr = Math.log(on.ratio);
    const price = Math.abs(lr) < SPLIT_TOL ? 'adjusted' : Math.abs(lr + Math.log(N)) < SPLIT_TOL ? 'not adjusted' : 'unclear';
    const vol = volumeAround(D);
    const volume = !vol ? 'no data' : Math.abs(Math.log(vol.ratio)) < Math.abs(Math.log(vol.ratio) - Math.log(N)) ? 'adjusted' : 'not adjusted';
    const status = price === 'adjusted' && volume !== 'not adjusted' ? 'pass' : 'fail';
    const out = { ...base, overnight: { ...on, ratio: round(on.ratio) }, price, volume: { verdict: volume, ...(vol || {}), heuristic: 'mean daily volume of up to 5 complete sessions from the split date / up to 5 before it: about 1 if adjusted, about the split ratio if not' }, status };
    if (status === 'fail') {
      const why = price === 'not adjusted' ? `prices are not split-adjusted (open/previous close ${round(on.ratio)}, about 1/${N})`
        : price === 'unclear' ? `the overnight ratio ${round(on.ratio)} is neither about 1 (adjusted) nor about ${round(1 / N)} (not adjusted)`
          : `prices look adjusted but volume does not (volume ratio ${vol.ratio}, about ${N})`;
      issue('adjustment', 'known_split', `${a.label} on ${D}: ${why}`, { date: D, cumulative: true });
    }
    return out;
  });
  const knownDates = new Set(knownSplits.map((s) => s.firstAdjustedSession));
  const reviewedDates = new Map((reviewed || []).map((r) => [r.date, r]));
  const candidates = [];
  let boundaries = 0;
  for (const d of dates) {
    const on = overnight(d);
    if (!on) continue;
    boundaries++;
    const lr = Math.log(on.ratio);
    for (const k of SCAN_RATIOS) {
      const fwd = Math.abs(lr + Math.log(k)) < SCAN_TOL, rev = Math.abs(lr - Math.log(k)) < SCAN_TOL;
      if (!fwd && !rev) continue;
      const looksLike = fwd ? `an unadjusted ${k}-for-1 split` : `an unadjusted 1-for-${k} reverse split`;
      const c = { date: d, prevSession: on.prevSession, prevClose: on.prevClose, open: on.open, ratio: round(on.ratio), looksLike };
      if (knownDates.has(d)) break; // reported above
      if (reviewedDates.has(d)) { candidates.push({ ...c, reviewed: reviewedDates.get(d) }); break; }
      candidates.push(c);
      issue('adjustment', 'split_like_move', `overnight move on ${d} (open/previous close ${round(on.ratio)}) looks like ${looksLike}: check the vendor's corporate actions; if it is not a split, record it under reviewedOvernightMoves in corporate-actions-v1.json`, { date: d, cumulative: true });
      break;
    }
  }
  const other = (actions?.actions || []).filter((a) => a.priceAdjustmentExpected === false).map((a) => {
    const from = a.offerExpired || a.date, to = a.resultsAnnounced || a.date;
    const checks = [];
    for (let d = from; d <= addDays(to, 1); d = addDays(d, 1)) { const on = overnight(d); if (on) checks.push({ date: d, ratio: round(on.ratio) }); }
    const big = checks.filter((x) => Math.abs(Math.log(x.ratio)) > Math.log(1.05));
    return { label: a.label, from, to, priceAdjustmentExpected: false, overnight: checks, status: !checks.length ? 'no data' : big.length ? 'review' : 'pass', note: big.length ? 'an overnight move above 5% near the event: check whether the vendor applied an adjustment factor' : null, source: a.source ?? null };
  });
  const declaredModes = [...new Set(keys.map((k) => k.adjustment ?? 'not recorded'))];
  const dividendDeclared = !keys.length ? 'no data'
    : declaredModes.length > 1 ? `mixed (${declaredModes.join(', ')})`
      : declaredModes[0] === 'split' ? 'split only: prices are not dividend-adjusted (as declared by the request)'
        : /dividend|all/.test(declaredModes[0]) ? `dividend-adjusted (${declaredModes[0]}), which splits-v1 does not want`
          : `not declared by the source (${declaredModes[0]})`;
  if (keys.length && declaredModes.length === 1 && /dividend|all/.test(declaredModes[0])) issue('adjustment', 'dividend_adjusted', `bars are declared ${declaredModes[0]}-adjusted; splits-v1 needs split-only bars`, { all: true });
  const adjBad = issues.some((x) => x.item === 'adjustment');
  const adjustment = {
    status: !cleanCount ? 'no data' : adjBad ? 'fail' : 'pass',
    declared: declaredModes, corporateActionsStatus: actions?.inWindowStatus ?? 'not in corporate-actions file',
    knownSplits, otherActions: other,
    unknownSplitScan: { boundariesChecked: boundaries, ratios: SCAN_RATIOS, tolerancePct: 8, candidates, rule: 'every overnight open/previous close ratio within 8% of 1/k (forward split) or k (reverse split) is listed for review; nothing is adjusted automatically' },
    dividends: { declared: dividendDeclared, status: keys.length && declaredModes.length === 1 && declaredModes[0] === 'split' ? 'declared by source, not independently verified' : 'not verified' },
  };

  // (a) instrument and exchange.
  const uni = upper(exchange), res = listing ? upper(listing.exchange) : null;
  let instStatus;
  if (sourceReportedExchange && upper(sourceReportedExchange) !== uni) instStatus = 'mismatch';
  else if (res && res !== uni) instStatus = ['official search summary', 'verified'].includes(listing.status) ? 'mismatch' : 'unverified (research belief differs)';
  else if (listing?.status === 'verified') instStatus = 'verified';
  else if (listing?.status === 'official search summary') instStatus = 'verified by research';
  else if (listing?.status === 'likely') instStatus = 'likely, not verified';
  else instStatus = 'unverified';
  if (instStatus === 'mismatch') issue('instrument', 'exchange_mismatch', `universe-v1 says ${exchange}; ${sourceReportedExchange ? `the source reports ${sourceReportedExchange}` : `the research found ${listing.exchange}`}`, { all: true });
  const instrument = {
    status: instStatus, universeExchange: exchange, research: listing ? { exchange: listing.exchange, status: listing.status, source: listing.source ?? null, note: listing.evidence ?? listing.note ?? null, verifiedAt: listing.verifiedAt ?? null } : null,
    sourceReported: sourceReportedExchange || null, sourceNote: sourceReportedExchange ? null : 'the bars endpoints used here do not report a listing exchange',
  };

  // (f) sources.
  if (keys.length > 1) issue('sources', 'mixed', `bars from more than one source in the window (${keys.map((k) => `${store.sourceKeyText(k)}: ${k.bars}`).join('; ')}); re-download from one source`, { all: true });
  const sources = {
    status: !keys.length ? 'no data' : keys.length > 1 ? 'fail' : 'pass',
    keys: keys.map((k) => ({ source: k.source, adjustment: k.adjustment ?? null, feed: k.feed ?? null, bars: k.bars, first: k.first, last: k.last })),
    facts: [...new Set(keys.map((k) => (SOURCE_FACTS.sources.some((s) => s.id === k.source) ? k.source : null)).filter(Boolean))],
  };

  // Per period and overall.
  const periodStatus = {};
  for (const k of PERIODS) {
    const p = periods[k];
    const reasons = summarize(issues.filter((x) => x.period === k || (!x.period && affects(x, p))));
    periodStatus[k] = { status: !coverage[k].presentBars ? NO_DATA : reasons.length ? NOT_READY : READY, reasons: reasons.slice(0, 20), moreReasons: Math.max(0, reasons.length - 20) };
  }
  const statuses = PERIODS.map((k) => periodStatus[k].status);
  const status = !cleanCount ? NO_DATA : statuses.every((s) => s === READY) ? READY : NOT_READY;
  const blocking = [];
  if (status === NOT_READY) {
    for (const k of PERIODS) if (periodStatus[k].status === NO_DATA) blocking.push(`${PERIOD_LABEL[k]}: no bars (${coverage[k].expectedSessions} sessions, ${coverage[k].expectedBars.toLocaleString('en-US')} bars expected)`);
    blocking.push(...summarize(issues));
  }
  const openItems = [];
  if (!['verified', 'verified by research'].includes(instStatus)) openItems.push(`listing exchange ${instStatus}`);
  if (adjustment.dividends.status !== 'declared by source, not independently verified' && keys.length) openItems.push('dividend adjustment not declared by the source');
  if (cleanCount && !knownSplits.length && (actions?.inWindowStatus === 'none found, unverified' || !actions)) openItems.push('corporate actions: none found, unverified (scan of bars only)');
  return {
    symbol, exchange, status, blocking, openItems,
    periods: periodStatus,
    checks: { instrument, coverage, timestamps, ohlcv, adjustment, sources },
    bars: { input: (bars || []).length, inWindow: cleanCount, outsideWindow, excludedSessions: Object.fromEntries([...excludedBars].sort()) },
  };
}

// ---------- the whole checklist ----------

function ingestionTotals(sets) {
  if (!sets.length) return null;
  const t = { sets: sets.length, rawBars: 0, pages: 0, dropped: {}, session: {}, timestamps: { utc: 0, offset: 0, unreadable: 0 } };
  for (const s of sets) {
    const d = s.details || {};
    t.rawBars += Number(d.rawBars) || 0;
    t.pages += Number(d.pages) || 0;
    for (const [k, v] of Object.entries(d.dropped || {})) t.dropped[k] = (t.dropped[k] || 0) + (Number(v) || 0);
    for (const [k, v] of Object.entries(d.session || {})) t.session[k] = (t.session[k] || 0) + (Number(v) || 0);
    for (const k of ['utc', 'offset', 'unreadable']) t.timestamps[k] += Number(d.timestamps?.[k]) || 0;
  }
  return t;
}

const dayStartIso = (d) => iso(dayStartMs(d));
const dayEndIso = (d) => iso(dayStartMs(addDays(d, 1)) - 1);

export function buildReadiness({ db, universe, splits, corporateActions = loadCorporateActions(), now = new Date(), synthetic = false } = {}) {
  const win = { from: splits.warmup.from, to: splits.holdout.to };
  const periods = Object.fromEntries(PERIODS.map((k) => [k, { from: splits[k].from, to: splits[k].to }]));
  const listings = corporateActions.listings?.symbols || {};
  const excluded = excludedSessionDates(splits);
  const reviewedAll = corporateActions.reviewedOvernightMoves?.symbols || {};
  const symbols = universe.symbols.map((u) => {
    const bars = store.getBars(db, u.symbol, { from: dayStartIso(win.from), to: dayEndIso(win.to) });
    const keys = store.barSourceKeys(db, u.symbol, { from: dayStartIso(win.from), to: dayEndIso(win.to) });
    const after = store.barSourceKeys(db, u.symbol, { from: dayEndIso(win.to) });
    const r = checkSymbolBars(bars, {
      symbol: u.symbol, exchange: u.exchange, periods, actions: corporateActions.symbols?.[u.symbol] || null, listing: listings[u.symbol] || null,
      keys, ingestion: ingestionTotals(store.listBarSets(db, { symbol: u.symbol, limit: 5000 })), reviewed: reviewedAll[u.symbol] || [], excluded,
    });
    r.afterWindow = after.map((k) => ({ source: k.source, adjustment: k.adjustment ?? null, feed: k.feed ?? null, bars: k.bars, first: k.first, last: k.last }));
    return r;
  });
  const usable = Object.fromEntries(PERIODS.map((k) => {
    const by = (st) => symbols.filter((s) => s.periods[k].status === st).map((s) => s.symbol);
    const ready = by(READY), notReady = by(NOT_READY), noData = by(NO_DATA);
    return [k, { usable: ready.length === symbols.length, ready, notReady, noData }];
  }));
  const count = (st) => symbols.filter((s) => s.status === st).length;
  return {
    name: 'data-readiness', generatedAt: iso(now.getTime()), synthetic,
    universe: universe.name, splits: splits.name, corporateActions: corporateActions.name, window: win,
    requirement: splits.dataRequirements,
    periods: periodTable(periods, 'NYSE', excluded), usable,
    excludedSessions: { splits: splits.name, dates: excluded, sessions: (splits.excludedSessions?.sessions || []).map((x) => ({ date: x.date, period: x.period ?? null, reason: x.reason })), handling: splits.excludedSessions?.handling ?? null },
    summary: { symbols: symbols.length, ready: count(READY), notReady: count(NOT_READY), noData: count(NO_DATA), usablePeriods: PERIODS.filter((k) => usable[k].usable) },
    rule: 'A period is usable only if every symbol is READY for it. READY means the stored bars pass every check bars can prove; listing, dividend treatment and licence are reported as open items. Nothing is shortened, replaced or adjusted automatically, and this checklist proposes no dates. Sessions the splits version excludes for every symbol are not expected; their stored bars are set aside and never used by a run.',
    symbols, sources: SOURCE_FACTS, forwardFeeds: FORWARD_FEEDS, openItems: OPEN_ITEMS,
    calendar: { source: 'server/calendar.js', verified: 'NYSE published schedule 2026-2027 only; 2021-2025 generated from the holiday rules plus the 2025-01-09 closure' },
  };
}

// ---------- the run gate ----------

// Periods a run reads: every run warms up from the start of the warm-up and
// continues to the end of its own period (stress tests use validation; the
// walk-forward spans development and validation).
const RUN_PERIODS = {
  development: ['warmup', 'development'],
  validation: ['warmup', 'development', 'validation'],
  stress: ['warmup', 'development', 'validation'],
  walk_forward: ['warmup', 'development', 'validation'],
  holdout: ['warmup', 'development', 'validation', 'holdout'],
};
export function periodsForRun(split) {
  const p = RUN_PERIODS[split === 'walk-forward' ? 'walk_forward' : split];
  if (!p) throw new Error(`Unknown run "${split}"`);
  return p;
}

// Every (symbol, period) pair that is not READY for the given runs. symbols:
// checkSymbolBars results; want: the symbols the run uses (all when null; a
// wanted symbol without a result counts as NO DATA). Empty means the run may go.
export function readinessBlockers(symbols, splitsToRun, want = null) {
  const periods = [...new Set([].concat(splitsToRun).flatMap(periodsForRun))];
  const by = new Map((symbols || []).map((s) => [s.symbol, s]));
  const names = want ? [...want] : [...by.keys()];
  const out = [];
  for (const sym of names) {
    const s = by.get(sym);
    for (const k of periods) {
      const st = s?.periods?.[k]?.status ?? NO_DATA;
      if (st !== READY) out.push({ symbol: sym, period: k, status: st, reasons: s?.periods?.[k]?.reasons?.slice(0, 3) ?? [] });
    }
  }
  return out;
}

export function describeBlockers(blockers, limit = 8) {
  const text = blockers.slice(0, limit).map((b) => `${b.symbol} ${PERIOD_LABEL[b.period]}: ${b.status}${b.reasons.length ? ` (${b.reasons[0]})` : ''}`).join('; ');
  return `${text}${blockers.length > limit ? `; and ${blockers.length - limit} more` : ''}`;
}
