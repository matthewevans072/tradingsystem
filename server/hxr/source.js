// Read-only Alpaca market-data client for HXR (strategy/hxr/ENGINE-SPEC.md
// section 9): raw daily SIP bars, the first 15-minute bar of each session,
// corporate actions, quotes around the open (spread samples) and news. Only
// https://data.alpaca.markets is ever called: no trading, paper-trading or
// account endpoint, and nothing here can place or prepare an order. The keys
// come from .env (ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY, server/config.js)
// and go only into the two request headers; error messages never include a
// URL or header and pass through redact().
//
// Response shapes were checked against real responses on 2026-10-22:
//   bars    { bars: { SYM: [{ t, o, h, l, c, v, n, vw }] }, next_page_token }
//           daily bars are stamped at 00:00 America/New_York of the session
//   quotes  { quotes: { SYM: [{ t, ap, as, ax, bp, bs, bx, c, z }] }, next_page_token }
//   corporate actions { corporate_actions: { forward_splits: [...], cash_dividends: [...], ... }, next_page_token }
//   news    { news: [{ id, created_at, updated_at, headline, summary, source, author, url, symbols, ... }], next_page_token }
//   429 responses carry X-Ratelimit-Reset (UNIX seconds)
import { ProviderError, sleep as realSleep } from '../providers/http.js';
import { redact } from '../config.js';
import { regularSessionBounds, isTradingDay } from '../calendar.js';
import { zonedToUtc, zonedParts, addDays, NY } from '../time.js';

export const ALPACA_DATA_ORIGIN = 'https://data.alpaca.markets';
export const BARS_PATH = '/v2/stocks/bars';
export const QUOTES_PATH = '/v2/stocks/quotes';
export const CORPORATE_ACTIONS_PATH = '/v1/corporate-actions';
export const NEWS_PATH = '/v1beta1/news';
export const FEED = 'sip';
export const ADJUSTMENT = 'raw';
export const PAGE_LIMIT = 10000;
export const NEWS_PAGE_LIMIT = 50;
export const CORPORATE_ACTIONS_PAGE_LIMIT = 1000;
// The free plan refuses SIP data from the last 15 minutes; one extra minute of margin.
export const FREE_PLAN_DELAY_MIN = 16;
// A session's daily bar is final only this long after its close.
export const BAR_FINAL_AFTER_CLOSE_MIN = 20;
export const CORPORATE_ACTIONS_FROM = '2015-01-01';
export const CORPORATE_ACTION_TYPES = ['forward_split', 'reverse_split', 'cash_dividend', 'stock_dividend', 'name_change', 'cash_merger', 'stock_merger', 'spin_off'];
export const QUOTE_WINDOW_SEC = 60;

const MIN = 60000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const rfc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const nyDate = (ms) => zonedParts(new Date(ms), NY).date;

// Every request must go to Alpaca's market-data host over HTTPS.
export function assertAlpacaDataUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(`${ALPACA_DATA_ORIGIN}/`)) throw new Error('HXR only calls https://data.alpaca.markets');
  return url;
}

async function bodyOf(res) {
  try {
    if (typeof res.text === 'function') {
      const t = await res.text();
      return t ? JSON.parse(t) : null;
    }
    return typeof res.json === 'function' ? await res.json() : null;
  } catch {
    return undefined; // not JSON
  }
}

const headerOf = (res, k) => (typeof res.headers?.get === 'function' ? res.headers.get(k) : res.headers?.[k]) ?? null;
// With redirect: 'manual' Node returns the 3xx itself; a browser-style fetch returns an opaque redirect (status 0).
export const isRedirect = (res) => res?.type === 'opaqueredirect' || (res?.status >= 300 && res?.status < 400);

// Milliseconds to wait after a 429: until X-Ratelimit-Reset (UNIX seconds) or
// Retry-After (seconds), at least one second; null when neither is usable.
function waitHint(res, nowMs) {
  const reset = Number(headerOf(res, 'x-ratelimit-reset') ?? NaN);
  if (Number.isFinite(reset) && reset > 1e9) return Math.max(1000, reset * 1000 - nowMs);
  const ra = Number(headerOf(res, 'retry-after') ?? NaN);
  if (Number.isFinite(ra) && ra >= 0) return Math.max(1000, ra * 1000);
  return null;
}

export function createHxrSource({
  keyId, secretKey, fetchImpl = globalThis.fetch, sleep = realSleep, now = () => new Date(), baseUrl = ALPACA_DATA_ORIGIN,
  maxRetries = 6, backoffMs = 1000, maxBackoffMs = 60000, timeoutMs = 30000, maxPages = 2000,
} = {}) {
  if (baseUrl !== ALPACA_DATA_ORIGIN) assertAlpacaDataUrl(`${baseUrl}/`);
  const configured = !!(keyId && secretKey);
  const stats = { requests: 0, pages: 0, retries: 0, rateLimited: 0 };
  const secrets = { secrets: { ALPACA_API_KEY_ID: keyId || '', ALPACA_API_SECRET_KEY: secretKey || '' } };
  const fail = (kind, message, extra) => new ProviderError(kind, redact(message, secrets), extra);

  async function request(pathname, params) {
    if (!configured) throw fail('auth', 'Alpaca keys are not configured (ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env)');
    const url = assertAlpacaDataUrl(`${baseUrl}${pathname}?${new URLSearchParams(params)}`);
    const headers = { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey, Accept: 'application/json' };
    let transient = 0;
    for (let attempt = 0; ; attempt++) {
      let res;
      stats.requests++;
      try {
        // A redirect is never followed: fetch would resend both key headers to the new host.
        res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (transient++ < 2) { stats.retries++; await sleep(Math.min(maxBackoffMs, backoffMs * 2 ** transient)); continue; }
        const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        throw fail('network', `Alpaca: ${timeout ? 'request timed out' : 'could not connect'} (${clean(e?.cause?.code || e?.name || 'error')})`);
      }
      if (isRedirect(res)) throw fail('bad_response', `Alpaca: unexpected redirect (HTTP ${res.status || '3xx'}); it was not followed, so the keys were sent nowhere else`, { status: res.status || null });
      if (res.status === 429) {
        stats.rateLimited++;
        if (attempt >= maxRetries) throw fail('rate_limit', `Alpaca: rate limit reached (HTTP 429), still refused after ${maxRetries} retries`, { status: 429, retryAfterSec: 60 });
        stats.retries++;
        const hint = waitHint(res, now().getTime());
        await sleep(Math.min(maxBackoffMs, hint ?? backoffMs * 2 ** attempt));
        continue;
      }
      const body = await bodyOf(res);
      const msg = clean(body?.message);
      if (res.status === 401 || res.status === 403) throw fail('auth', `Alpaca: access denied (HTTP ${res.status}${msg ? `: ${msg}` : ''}). Check ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env; the free plan also refuses SIP data from the last 15 minutes.`, { status: res.status });
      if (res.status >= 500) {
        if (transient++ < 2) { stats.retries++; await sleep(Math.min(maxBackoffMs, backoffMs * 2 ** transient)); continue; }
        throw fail('server', `Alpaca: provider error (HTTP ${res.status})`, { status: res.status });
      }
      if (res.status === 404) throw fail('not_found', `Alpaca: not found (HTTP 404)${msg ? `: ${msg}` : ''}`, { status: 404 });
      if (res.status === 400 || res.status === 422) throw fail('bad_response', `Alpaca: request refused (HTTP ${res.status})${msg ? `: ${msg}` : ''}`, { status: res.status });
      if (!(res.status >= 200 && res.status < 300)) throw fail('bad_response', `Alpaca: unexpected HTTP ${res.status}`, { status: res.status });
      if (body === undefined || body === null || typeof body !== 'object') throw fail('bad_response', 'Alpaca: response was not valid JSON');
      return body;
    }
  }

  // Calls request() for each page until next_page_token is empty; onPage gets each body.
  async function paged(pathname, params, onPage) {
    let token = null, pages = 0;
    const seen = new Set();
    for (;;) {
      const body = await request(pathname, token ? { ...params, page_token: token } : params);
      pages++;
      stats.pages++;
      onPage(body);
      token = body.next_page_token || null;
      if (!token) return pages;
      if (seen.has(token)) throw fail('bad_response', 'Alpaca: the same next_page_token came back twice');
      seen.add(token);
      if (pages >= maxPages) throw fail('bad_response', `Alpaca: more than ${maxPages} pages for one request`);
    }
  }

  function checkSymbol(symbol) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!SYMBOL.test(sym)) throw fail('bad_response', `Alpaca: invalid symbol ${clean(symbol, 20)}`);
    return sym;
  }

  // Exchange-local dates -> request instants: 00:00 ET on `from` to the end
  // of `to`, never later than 16 minutes ago (free-plan SIP restriction).
  function range(from, to) {
    if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) throw fail('bad_response', 'Alpaca: from and to must be YYYY-MM-DD with from on or before to');
    const startMs = zonedToUtc(from, 0, 0, NY).getTime();
    const endOfTo = zonedToUtc(addDays(to, 1), 0, 0, NY).getTime() - 1000;
    return { startMs, endMs: Math.min(endOfTo, now().getTime() - FREE_PLAN_DELAY_MIN * MIN) };
  }

  // A session is complete (its daily bar final) 20 minutes after its close.
  const sessionComplete = (date) => {
    const b = regularSessionBounds(date, 'NYSE');
    return !!b && now().getTime() >= b.close.getTime() + BAR_FINAL_AFTER_CLOSE_MIN * MIN;
  };

  async function bars(sym, timeframe, startMs, endMs) {
    const out = [];
    let unreadable = 0;
    if (!(endMs > startMs)) return { list: out, pages: 0, unreadable };
    const params = { symbols: sym, timeframe, start: rfc(startMs), end: rfc(endMs), adjustment: ADJUSTMENT, feed: FEED, limit: String(PAGE_LIMIT), sort: 'asc' };
    const pages = await paged(BARS_PATH, params, (body) => {
      const list = body.bars == null ? [] : Array.isArray(body.bars) ? body.bars : body.bars[sym] || [];
      if (!Array.isArray(list)) throw fail('bad_response', 'Alpaca: bars is not a list');
      for (const b of list) {
        const ms = typeof b?.t === 'string' && RFC3339.test(b.t) ? Date.parse(b.t) : NaN;
        if (!Number.isFinite(ms)) { unreadable++; continue; }
        out.push({ ms, o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v), n: b.n == null ? null : num(b.n), vw: b.vw == null ? null : num(b.vw) });
      }
    });
    return { list: out, pages, unreadable };
  }

  const validOhlc = (b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0);

  return {
    id: 'alpaca',
    feed: FEED,
    adjustment: ADJUSTMENT,
    configured,
    stats: () => ({ ...stats }),

    // Raw daily SIP bars [{ date, o, h, l, c, v, n, vw }] for completed
    // sessions between two exchange-local dates. Alpaca returns the current
    // session's unfinished bar even with an earlier end, so bars are kept by
    // session date only once the session is complete. The array carries
    // .dropped (counts by reason) and .pages.
    async dailyBars(symbol, { from, to } = {}) {
      const sym = checkSymbol(symbol);
      const { startMs, endMs } = range(from, to);
      const r = await bars(sym, '1Day', startMs, endMs);
      const dropped = { unreadable: r.unreadable, outOfRange: 0, nonTradingDay: 0, incomplete: 0, invalid: 0, duplicates: 0 };
      const out = [], seen = new Set();
      for (const b of r.list) {
        const date = nyDate(b.ms);
        if (date < from || date > to) { dropped.outOfRange++; continue; }
        if (!isTradingDay(date, 'NYSE')) { dropped.nonTradingDay++; continue; }
        if (!sessionComplete(date)) { dropped.incomplete++; continue; }
        if (!validOhlc(b)) { dropped.invalid++; continue; }
        if (seen.has(date)) { dropped.duplicates++; continue; }
        seen.add(date);
        out.push({ date, o: b.o, h: b.h, l: b.l, c: b.c, v: Number.isFinite(b.v) ? b.v : null, n: Number.isFinite(b.n) ? b.n : null, vw: Number.isFinite(b.vw) ? b.vw : null });
      }
      out.dropped = dropped;
      out.pages = r.pages;
      return out;
    },

    // The 15-minute bar starting at each session's regular open (09:30 ET, from
    // the calendar, so daylight saving is handled): [{ date, o, h, l, c, v, vw }]
    // for completed sessions. Extended-hours bars are ignored.
    async first15(symbol, { from, to } = {}) {
      const sym = checkSymbol(symbol);
      const { startMs, endMs } = range(from, to);
      const r = await bars(sym, '15Min', startMs, endMs);
      const out = [], seen = new Set();
      for (const b of r.list) {
        const date = nyDate(b.ms);
        if (date < from || date > to || seen.has(date)) continue;
        const s = regularSessionBounds(date, 'NYSE');
        if (!s || b.ms !== s.open.getTime() || !sessionComplete(date) || !validOhlc(b)) continue;
        seen.add(date);
        out.push({ date, o: b.o, h: b.h, l: b.l, c: b.c, v: Number.isFinite(b.v) ? b.v : null, vw: Number.isFinite(b.vw) ? b.vw : null });
      }
      out.pages = r.pages;
      return out;
    },

    // Every corporate action of these symbols from 2015-01-01 to a year after
    // today (Alpaca filters by process or payable date, not ex-date, so the
    // caller filters by ex-date), flattened to one row per action.
    async corporateActions(symbols, { start = CORPORATE_ACTIONS_FROM, end = null } = {}) {
      const syms = [...new Set((Array.isArray(symbols) ? symbols : [symbols]).map(checkSymbol))];
      if (!syms.length) return [];
      const until = end || addDays(nyDate(now().getTime()), 365);
      if (!DATE.test(start) || !DATE.test(until)) throw fail('bad_response', 'Alpaca: corporate-action dates must be YYYY-MM-DD');
      const out = [], seen = new Set();
      const params = { symbols: syms.join(','), types: CORPORATE_ACTION_TYPES.join(','), start, end: until, limit: String(CORPORATE_ACTIONS_PAGE_LIMIT), sort: 'asc' };
      await paged(CORPORATE_ACTIONS_PATH, params, (body) => {
        const groups = body.corporate_actions || {};
        if (typeof groups !== 'object' || Array.isArray(groups)) throw fail('bad_response', 'Alpaca: corporate_actions is not an object');
        for (const [key, list] of Object.entries(groups)) {
          if (!Array.isArray(list)) continue;
          for (const raw of list) {
            const row = flattenAction(key, raw);
            if (!row || seen.has(row.id)) continue;
            seen.add(row.id);
            out.push(row);
          }
        }
      });
      return out.sort((a, b) => ((a.ex_date || a.process_date || '') < (b.ex_date || b.process_date || '') ? -1 : (a.ex_date || a.process_date || '') > (b.ex_date || b.process_date || '') ? 1 : a.id < b.id ? -1 : 1));
    },

    // SIP quotes [{ t, ap, bp }] from a session's open to 60 seconds later.
    async quotesWindow(symbol, date) {
      const sym = checkSymbol(symbol);
      const s = DATE.test(date || '') ? regularSessionBounds(date, 'NYSE') : null;
      if (!s) throw fail('bad_response', `Alpaca: ${clean(date, 20)} is not an NYSE session`);
      const startMs = s.open.getTime(), endMs = startMs + QUOTE_WINDOW_SEC * 1000;
      if (now().getTime() - FREE_PLAN_DELAY_MIN * MIN < endMs) throw fail('not_available', `Alpaca: quotes for ${date} are not available yet (the free plan needs them to be 15 minutes old)`);
      const out = [];
      const params = { symbols: sym, start: rfc(startMs), end: rfc(endMs), feed: FEED, limit: String(PAGE_LIMIT), sort: 'asc' };
      await paged(QUOTES_PATH, params, (body) => {
        const list = body.quotes == null ? [] : Array.isArray(body.quotes) ? body.quotes : body.quotes[sym] || [];
        if (!Array.isArray(list)) throw fail('bad_response', 'Alpaca: quotes is not a list');
        for (const q of list) {
          const ms = typeof q?.t === 'string' && RFC3339.test(q.t) ? Date.parse(q.t) : NaN;
          if (!Number.isFinite(ms) || ms < startMs || ms > endMs) continue;
          out.push({ t: q.t, ap: num(q.ap), bp: num(q.bp) });
        }
      });
      return out;
    },

    // News items for these symbols. Alpaca's start/end filter updated_at, not
    // created_at; createdFrom drops older items locally. Text is untrusted:
    // control characters are removed and only http(s) links are kept.
    async news(symbols, { start = null, end = null, createdFrom = null } = {}) {
      const syms = [...new Set((Array.isArray(symbols) ? symbols : [symbols]).map(checkSymbol))];
      if (!syms.length) return [];
      const params = { symbols: syms.join(','), limit: String(NEWS_PAGE_LIMIT), sort: 'asc', include_content: 'false' };
      if (start) params.start = rfc(Date.parse(start));
      if (end) params.end = rfc(Math.min(Date.parse(end), now().getTime()));
      const fromMs = createdFrom ? Date.parse(createdFrom) : null;
      const out = [], seen = new Set();
      await paged(NEWS_PATH, params, (body) => {
        if (!Array.isArray(body.news ?? [])) throw fail('bad_response', 'Alpaca: news is not a list');
        for (const n of body.news || []) {
          const item = newsItem(n);
          if (!item || seen.has(item.id)) continue;
          if (fromMs != null && Date.parse(item.created_at) < fromMs) continue;
          seen.add(item.id);
          out.push(item);
        }
      });
      return out;
    },
  };
}

// ---------- flattening ----------

const TYPE_OF = {
  forward_splits: 'forward_split', reverse_splits: 'reverse_split', cash_dividends: 'cash_dividend', stock_dividends: 'stock_dividend',
  name_changes: 'name_change', cash_mergers: 'cash_merger', stock_mergers: 'stock_merger', spin_offs: 'spin_off',
};
const dateOrNull = (v) => (typeof v === 'string' && DATE.test(v) ? v : null);
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const symOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);

// One Alpaca corporate action -> { id, type, symbol, cusip, ex_date, pay_date,
// process_date, ratio_old, ratio_new, rate, old_symbol, new_symbol, raw }.
// Mergers: symbol is the acquiree (whose shares are converted), new_symbol
// the acquirer; ex_date is the effective date. Spin-offs: symbol is the source.
export function flattenAction(groupKey, raw) {
  if (!raw || typeof raw !== 'object' || raw.id == null || raw.id === '') return null;
  const type = TYPE_OF[groupKey] || String(groupKey).replace(/s$/, '');
  const row = {
    id: String(raw.id), type, symbol: symOrNull(raw.symbol), cusip: raw.cusip ?? null,
    ex_date: dateOrNull(raw.ex_date), pay_date: dateOrNull(raw.payable_date), process_date: dateOrNull(raw.process_date),
    ratio_old: null, ratio_new: null, rate: numOrNull(raw.rate), old_symbol: null, new_symbol: null, raw,
  };
  if (type === 'forward_split' || type === 'reverse_split') {
    row.ratio_old = numOrNull(raw.old_rate);
    row.ratio_new = numOrNull(raw.new_rate);
    row.cusip = raw.cusip ?? raw.new_cusip ?? raw.old_cusip ?? null;
  } else if (type === 'name_change') {
    row.symbol = symOrNull(raw.new_symbol);
    row.old_symbol = symOrNull(raw.old_symbol);
    row.new_symbol = symOrNull(raw.new_symbol);
    row.cusip = raw.new_cusip ?? raw.old_cusip ?? null;
  } else if (type === 'cash_merger' || type === 'stock_merger') {
    row.symbol = symOrNull(raw.acquiree_symbol);
    row.old_symbol = symOrNull(raw.acquiree_symbol);
    row.new_symbol = symOrNull(raw.acquirer_symbol);
    row.cusip = raw.acquiree_cusip ?? null;
    row.ex_date = dateOrNull(raw.effective_date) ?? row.ex_date;
    if (type === 'stock_merger') { row.ratio_old = numOrNull(raw.acquiree_rate); row.ratio_new = numOrNull(raw.acquirer_rate); }
  } else if (type === 'spin_off') {
    row.symbol = symOrNull(raw.source_symbol);
    row.old_symbol = symOrNull(raw.source_symbol);
    row.new_symbol = symOrNull(raw.new_symbol);
    row.cusip = raw.source_cusip ?? null;
    row.ratio_old = numOrNull(raw.source_rate);
    row.ratio_new = numOrNull(raw.new_rate);
  }
  return row;
}

// One Alpaca news item, cleaned. Returns null without an id or a readable created_at.
export function newsItem(n) {
  if (!n || n.id == null || n.id === '') return null;
  const created = Date.parse(n.created_at), updated = Date.parse(n.updated_at);
  if (!Number.isFinite(created)) return null;
  const url = typeof n.url === 'string' && /^https?:\/\//i.test(n.url.trim()) ? n.url.trim().slice(0, 2000) : null;
  return {
    id: String(n.id),
    created_at: new Date(created).toISOString(),
    updated_at: Number.isFinite(updated) ? new Date(updated).toISOString() : null,
    headline: clean(n.headline, 1000) || null,
    summary: clean(n.summary, 4000) || null,
    // Alpaca leaves source empty and names Benzinga as the author.
    source: clean(n.source, 100) || clean(n.author, 100) || null,
    url,
    symbols: Array.isArray(n.symbols) ? [...new Set(n.symbols.map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL.test(s)))] : [],
  };
}
