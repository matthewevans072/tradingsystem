// Historical 15-minute bars from Alpaca's market-data API for the Strategy Lab
// (strategy/DATA-READINESS.md). History only: no quotes, no streaming, no
// trading API, and nothing here can place or prepare an order. The keys come
// from .env (ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY, read by
// server/config.js and registered as secrets, so redact() masks them); they go
// only into the two request headers and never into a URL, an error or a log.
//
// Where each behaviour comes from (keep in step with DATA-READINESS.md):
//   [docs]       Alpaca's documentation as summarised by the 2026-10-22 research
//                (official-domain search summaries, not fetched pages).
//   [reference]  Alpaca's API reference as known before that research; not
//                re-checked by it. Confirm on the first real pull.
//   [unverified] not stated by any official page found; the first real pull
//                (and the readiness checklist) must confirm or refute it.
//
//   endpoint GET https://data.alpaca.markets/v2/stocks/bars, query
//     symbols, timeframe=15Min, start, end, limit, page_token, sort ......... [reference]
//   headers APCA-API-KEY-ID / APCA-API-SECRET-KEY ........................... [reference]
//   response { bars: { SYMBOL: [{ t, o, h, l, c, v, n, vw }] }, next_page_token } [reference]
//   limit at most 10,000 bars per page, counted across all symbols .......... [reference]
//   adjustment: raw is the default; split adjusts price AND volume .......... [docs]
//   feed=sip is the consolidated tape (100% of volume); pass it explicitly .. [docs]
//   history since 2016 on the free Basic plan .............................. [docs]
//   free plan: SIP data only when older than 15 minutes; `end` must be at
//     least 15 minutes old or the request is refused ....................... [docs]
//   timestamps are RFC-3339 UTC and mark the bar START ...................... [unverified]
//   15Min bars include extended-hours trades (04:00-20:00 ET) ............... [unverified]
//     -> filtered to the regular session either way (data.js normalizeBars)
//   free-plan rate limit about 200 requests/minute; HTTP 429 when exceeded .. [unverified]
//   split adjustment is reliable around split dates ........................ [unverified]
//     (forum reports of unadjusted SIP bars; readiness.js checks NVDA's splits)
import { ProviderError, sleep as realSleep } from '../../providers/http.js';
import { normalizeBars } from '../data.js';
import { barInfo } from '../sessions.js';
import { zonedToUtc, addDays, NY, TORONTO } from '../../time.js';
import { exchangeGroup } from '../../calendar.js';

export const ALPACA_BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
export const ALPACA_TIMEFRAME = '15Min';
export const ALPACA_ADJUSTMENT = 'split';
export const ALPACA_FEED = 'sip';
export const ALPACA_PAGE_LIMIT = 10000;
// The free plan refuses SIP data from the last 15 minutes; one extra minute of margin.
export const FREE_PLAN_DELAY_MIN = 16;

const MIN = 60000;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rfc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
const num = (v) => (v == null || v === '' ? NaN : Number(v));

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
const isRedirect = (res) => res?.type === 'opaqueredirect' || (res?.status >= 300 && res?.status < 400);

// Seconds to wait from Retry-After (seconds) or X-RateLimit-Reset (UNIX
// seconds); null when neither is usable. Which header Alpaca sends is unverified.
function waitHint(res, nowMs) {
  const raw = headerOf(res, 'retry-after'), rawReset = headerOf(res, 'x-ratelimit-reset');
  const ra = raw == null || raw === '' ? NaN : Number(raw);
  if (Number.isFinite(ra) && ra >= 0) return ra;
  const reset = rawReset == null || rawReset === '' ? NaN : Number(rawReset);
  if (Number.isFinite(reset) && reset > 1e9) return Math.max(0, reset - nowMs / 1000);
  return null;
}

export function createAlpacaSource({
  keyId, secretKey, fetchImpl = globalThis.fetch, sleep = realSleep, now = () => new Date(), baseUrl = ALPACA_BARS_URL,
  limit = ALPACA_PAGE_LIMIT, maxRetries = 6, backoffMs = 1000, maxBackoffMs = 60000, timeoutMs = 30000, maxPages = 1000,
} = {}) {
  const stats = { requests: 0, pages: 0, retries: 0, rateLimited: 0 };
  const configured = !!(keyId && secretKey);

  async function request(params) {
    if (!configured) throw new ProviderError('auth', 'Alpaca keys are not configured (ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env)');
    const url = `${baseUrl}?${new URLSearchParams(params)}`;
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
        throw new ProviderError('network', `Alpaca: ${timeout ? 'request timed out' : 'could not connect'} (${clean(e?.cause?.code || e?.name || 'error')})`);
      }
      if (isRedirect(res)) throw new ProviderError('bad_response', `Alpaca: unexpected redirect (HTTP ${res.status || '3xx'}); it was not followed, so the keys were sent nowhere else`, { status: res.status || null });
      if (res.status === 429) {
        stats.rateLimited++;
        const hint = waitHint(res, now().getTime());
        if (attempt >= maxRetries) {
          throw new ProviderError('rate_limit', `Alpaca: rate limit reached (HTTP 429), still refused after ${maxRetries} retries`, { status: 429, retryAfterSec: hint ?? 60 });
        }
        stats.retries++;
        await sleep(Math.min(maxBackoffMs, hint != null ? hint * 1000 : backoffMs * 2 ** attempt));
        continue;
      }
      const body = await bodyOf(res);
      const msg = clean(body?.message);
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('auth', `Alpaca: access denied (HTTP ${res.status}${msg ? `: ${msg}` : ''}). Check ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env; the free plan also refuses SIP data from the last 15 minutes.`, { status: res.status });
      }
      if (res.status >= 500) {
        if (transient++ < 2) { stats.retries++; await sleep(Math.min(maxBackoffMs, backoffMs * 2 ** transient)); continue; }
        throw new ProviderError('server', `Alpaca: provider error (HTTP ${res.status})`, { status: res.status });
      }
      if (res.status === 404) throw new ProviderError('not_found', `Alpaca: not found (HTTP 404)${msg ? `: ${msg}` : ''}`, { status: 404 });
      if (res.status === 400 || res.status === 422) throw new ProviderError('bad_response', `Alpaca: request refused (HTTP ${res.status})${msg ? `: ${msg}` : ''}`, { status: res.status });
      if (!(res.status >= 200 && res.status < 300)) throw new ProviderError('bad_response', `Alpaca: unexpected HTTP ${res.status}`, { status: res.status });
      if (body === undefined || body === null || typeof body !== 'object') throw new ProviderError('bad_response', 'Alpaca: response was not valid JSON');
      return body;
    }
  }

  // Every bar for one symbol between two instants (ms), following
  // next_page_token. Bars come back as received (UTC strings), with counts of
  // timestamps that are not RFC-3339 UTC.
  async function rawBars(symbol, startMs, endMs) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) throw new ProviderError('bad_response', `Alpaca: invalid symbol ${clean(symbol)}`);
    const out = [];
    const ts = { utc: 0, offset: 0, unreadable: 0, unreadableSample: [] };
    let token = null, pages = 0;
    const seenTokens = new Set();
    if (!(endMs > startMs)) return { bars: out, pages, timestamps: ts };
    for (;;) {
      const params = {
        symbols: sym, timeframe: ALPACA_TIMEFRAME, start: rfc(startMs), end: rfc(endMs),
        adjustment: ALPACA_ADJUSTMENT, feed: ALPACA_FEED, limit: String(limit), sort: 'asc',
      };
      if (token) params.page_token = token;
      const body = await request(params);
      pages++;
      stats.pages++;
      const list = body.bars == null ? [] : Array.isArray(body.bars) ? body.bars : body.bars[sym] || [];
      if (!Array.isArray(list)) throw new ProviderError('bad_response', 'Alpaca: bars is not a list');
      for (const b of list) {
        const t = typeof b?.t === 'string' ? b.t : '';
        const m = t.match(RFC3339);
        const ms = m ? Date.parse(t) : NaN;
        if (!Number.isFinite(ms)) {
          ts.unreadable++;
          if (ts.unreadableSample.length < 5) ts.unreadableSample.push(clean(b?.t));
          continue;
        }
        if (m[1] === 'Z') ts.utc++; else ts.offset++;
        out.push({ t: new Date(ms).toISOString(), o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v), n: b.n ?? null, vw: b.vw ?? null });
      }
      token = body.next_page_token || null;
      if (!token) break;
      if (seenTokens.has(token)) throw new ProviderError('bad_response', 'Alpaca: the same next_page_token came back twice');
      seenTokens.add(token);
      if (pages >= maxPages) throw new ProviderError('bad_response', `Alpaca: more than ${maxPages} pages for one request`);
    }
    return { bars: out, pages, timestamps: ts };
  }

  // Exchange-local dates -> instants: from 00:00 on `from` to the end of `to`,
  // and never later than 16 minutes ago (free-plan SIP restriction).
  function rangeOf(inst, from, to) {
    if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) throw new ProviderError('bad_response', 'Alpaca: from and to must be YYYY-MM-DD with from on or before to');
    const tz = exchangeGroup(inst.exchange) === 'TSX' ? TORONTO : NY;
    const startMs = zonedToUtc(from, 0, 0, tz).getTime();
    const endOfTo = zonedToUtc(addDays(to, 1), 0, 0, tz).getTime() - 1000;
    const endMs = Math.min(endOfTo, now().getTime() - FREE_PLAN_DELAY_MIN * MIN);
    return { startMs, endMs, clampedEnd: endMs < endOfTo };
  }

  const source = {
    id: 'alpaca',
    name: 'Alpaca',
    adjustment: ALPACA_ADJUSTMENT,
    feed: ALPACA_FEED,
    timeframe: ALPACA_TIMEFRAME,
    configured,
    stats: () => ({ ...stats }),

    // Same shape as a market-data provider's getIntradayRange: every bar the
    // API returned (extended hours included if Alpaca sends them), UTC.
    async getIntradayRange(inst, from, to) {
      const { startMs, endMs } = rangeOf(inst, from, to);
      const r = await rawBars(inst.provider_symbol || inst.symbol, startMs, endMs);
      return r.bars.map((b) => ({ ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    },

    // Regular-session 15-minute bars for the Lab (data.js normalizeBars), with
    // what was dropped and why, so the readiness checklist can report it.
    async getHistory(inst, from, to) {
      const exchange = inst.exchange || 'NYSE';
      const { startMs, endMs, clampedEnd } = rangeOf(inst, from, to);
      const r = await rawBars(inst.provider_symbol || inst.symbol, startMs, endMs);
      const session = { regular: 0, preMarket: 0, afterHours: 0, nonTradingDay: 0, offGrid: 0 };
      for (const b of r.bars) {
        const bi = barInfo(Date.parse(b.t), exchange, 15);
        if (bi.inSession) { if (bi.aligned) session.regular++; else session.offGrid++; }
        else if (bi.reason === 'before the open') session.preMarket++;
        else if (bi.reason === 'after the close') session.afterHours++;
        else session.nonTradingDay++;
      }
      const n = normalizeBars(r.bars, { exchange, intervalMinutes: 15, inputIntervalMinutes: 15 });
      return {
        bars: n.bars, rawBars: r.bars.length, pages: r.pages, dropped: n.dropped, session, timestamps: r.timestamps,
        request: { endpoint: baseUrl, timeframe: ALPACA_TIMEFRAME, adjustment: ALPACA_ADJUSTMENT, feed: ALPACA_FEED, start: rfc(startMs), end: rfc(endMs), endClampedForFreePlan: clampedEnd },
      };
    },
  };
  return source;
}
