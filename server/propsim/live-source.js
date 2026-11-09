// The live account's market-data client (LIVE-1.md section 3): Alpaca's free real-time IEX feed, 1-minute bars of one
// symbol, raw. Only https://data.alpaca.markets is called (the host check and the redirect test are HXR's, imported
// unchanged); a redirect is never followed, so the keys go nowhere else; error messages pass through redact() and
// never include a URL or a header. Nothing dated before the live data bound is requested. No trading, paper-trading or
// account endpoint exists here; nothing can place or prepare an order.
import { ALPACA_DATA_ORIGIN, BARS_PATH, assertAlpacaDataUrl, isRedirect } from '../hxr/source.js';
import { ProviderError } from '../providers/http.js';
import { redact } from '../config.js';
import { zonedParts, NY } from '../time.js';
import { LIVE_DATA_FROM } from './live-config.js';

const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const rfc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
export const FEED = 'iex';

export function createIexSource({ keyId, secretKey, fetchImpl = globalThis.fetch, timeoutMs = 20000, dataFrom = LIVE_DATA_FROM, maxPages = 20 } = {}) {
  const secrets = { secrets: { ALPACA_API_KEY_ID: keyId || '', ALPACA_API_SECRET_KEY: secretKey || '' } };
  const fail = (kind, message, extra) => new ProviderError(kind, redact(message, secrets), extra);
  async function request(params) {
    if (!(keyId && secretKey)) throw fail('auth', 'Alpaca keys are not configured (ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env)');
    const url = assertAlpacaDataUrl(`${ALPACA_DATA_ORIGIN}${BARS_PATH}?${new URLSearchParams(params)}`);
    let res;
    try { res = await fetchImpl(url, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw fail('network', `Alpaca IEX: ${e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'request timed out' : 'could not connect'} (${clean(e?.cause?.code || e?.name || 'error')})`); }
    if (isRedirect(res)) throw fail('bad_response', `Alpaca IEX: unexpected redirect (HTTP ${res.status || '3xx'}); it was not followed, so the keys were sent nowhere else`);
    let body = null;
    try { const t = await res.text(); body = t ? JSON.parse(t) : null; } catch { body = undefined; }
    if (res.status === 429) throw fail('rate_limit', 'Alpaca IEX: rate limit reached (HTTP 429)');
    if (res.status === 401 || res.status === 403) throw fail('auth', `Alpaca IEX: access denied (HTTP ${res.status})`);
    if (!(res.status >= 200 && res.status < 300)) throw fail('bad_response', `Alpaca IEX: HTTP ${res.status}${body?.message ? `: ${clean(body.message)}` : ''}`);
    if (!body || typeof body !== 'object') throw fail('bad_response', 'Alpaca IEX: response was not valid JSON');
    return body;
  }
  // Completed 1-minute bars of `symbol` from startMs to endMs: [{ ms, date (New York), minutes (after midnight New York), o, h, l, c, v }].
  async function bars1m(symbol, startMs, endMs) {
    const sym = String(symbol || '').toUpperCase();
    if (!SYMBOL.test(sym)) throw fail('bad_response', 'Alpaca IEX: invalid symbol');
    if (!(endMs > startMs)) return [];
    if (zonedParts(new Date(startMs), NY).date < dataFrom) throw fail('bad_response', `prop-sim live: a request before ${dataFrom} is refused`);
    const out = [];
    let token = null;
    for (let page = 0; page < maxPages; page++) {
      const params = { symbols: sym, timeframe: '1Min', start: rfc(startMs), end: rfc(endMs), adjustment: 'raw', feed: FEED, limit: '10000', sort: 'asc' };
      if (token) params.page_token = token;
      const body = await request(params);
      const list = body.bars == null ? [] : Array.isArray(body.bars) ? body.bars : body.bars[sym] || [];
      for (const b of list) {
        const ms = typeof b?.t === 'string' && RFC3339.test(b.t) ? Date.parse(b.t) : NaN;
        const v = [b?.o, b?.h, b?.l, b?.c].map(Number);
        if (!Number.isFinite(ms) || !v.every((x) => Number.isFinite(x) && x > 0)) continue;
        const p = zonedParts(new Date(ms), NY);
        out.push({ ms, date: p.date, minutes: p.minutes, o: v[0], h: v[1], l: v[2], c: v[3], v: Number(b.v) || 0 });
      }
      token = body.next_page_token || null;
      if (!token) return out;
    }
    throw fail('bad_response', `Alpaca IEX: more than ${maxPages} pages`);
  }
  return { bars1m, feed: FEED };
}
