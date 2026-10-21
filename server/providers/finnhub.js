// Finnhub adapter (https://finnhub.io/docs/api). The free tier provides US
// quotes, company news and the earnings calendar; historical candles and
// non-US exchanges generally require a paid plan.
import { getJson, ProviderError, RateLimiter, toNum } from './http.js';
import { exchangeGroup, sessionAt } from '../calendar.js';

const BASE = 'https://finnhub.io/api/v1';

export function createFinnhub({ apiKey, plan = {}, fetchImpl } = {}) {
  const limiter = new RateLimiter({ perMinute: plan.perMinute || 55, perDay: plan.perDay || 0 });

  async function call(path, params) {
    if (!apiKey) throw new ProviderError('auth', 'Finnhub API key is not configured');
    await limiter.take(1);
    const qs = new URLSearchParams(params);
    try {
      return await getJson(`${BASE}${path}?${qs}`, { fetchImpl, label: 'Finnhub', headers: { 'X-Finnhub-Token': apiKey } });
    } catch (e) {
      if (e.kind === 'rate_limit') limiter.backoff(e.retryAfterSec || 60);
      throw e;
    }
  }

  function providerSymbol(inst) {
    if (inst.provider_symbol) return inst.provider_symbol;
    return exchangeGroup(inst.exchange) === 'TSX' ? `${inst.symbol}.TO` : inst.symbol;
  }

  return {
    id: 'finnhub',
    name: 'Finnhub',
    capabilities: { quotes: true, dailyBars: false, intradayBars: false, extendedHours: false, earnings: true, splits: false, news: true },
    usage: () => limiter.usage(),

    async getQuotes(instruments, now = new Date()) {
      const results = [];
      for (const inst of instruments) {
        try {
          const q = await call('/quote', { symbol: providerSymbol(inst) });
          // Finnhub answers unknown symbols with zeros rather than an error.
          if (!q || !toNum(q.c) || !toNum(q.t)) throw new ProviderError('not_found', `Finnhub has no quote for ${inst.symbol} (${inst.exchange})`);
          const qt = new Date(q.t * 1000);
          results.push({
            instrument_id: inst.id, ok: true,
            quote: {
              provider: 'Finnhub', price: toNum(q.c), prev_close: toNum(q.pc), change: toNum(q.d), change_pct: toNum(q.dp),
              open: toNum(q.o), high: toNum(q.h), low: toNum(q.l), volume: null, avg_volume: null,
              session: sessionAt(now, inst.exchange).session,
              quote_time: qt.toISOString(),
              timeliness: exchangeGroup(inst.exchange) === 'TSX' ? 'delayed' : (plan.delayMinutesUS === 0 ? 'real-time' : 'delayed'),
              delay_minutes: exchangeGroup(inst.exchange) === 'TSX' ? 15 : (plan.delayMinutesUS ?? 0),
            },
          });
        } catch (e) {
          results.push({ instrument_id: inst.id, ok: false, error: e });
          if (e.kind === 'auth') break;
        }
      }
      return results;
    },

    // instruments: { id, symbol, exchange, provider_symbol }. The earnings
    // calendar is queried by US ticker: a TSX listing is not covered (its bare
    // ticker can be a different US company, and an empty answer for '.TO'
    // would read as "no date"), so it is reported back as not covered.
    async getEarnings(instruments, from, to) {
      const events = [], notCovered = [];
      for (const inst of instruments) {
        if (exchangeGroup(inst.exchange) === 'TSX') {
          notCovered.push({ symbol: inst.symbol, exchange: inst.exchange, reason: 'non-US listing not covered by Finnhub' });
          continue;
        }
        const sym = providerSymbol(inst);
        const d = await call('/calendar/earnings', { from, to, symbol: sym });
        for (const e of d.earningsCalendar || []) {
          if (String(e.symbol).toUpperCase() !== sym.toUpperCase()) continue;
          events.push({
            instrument_id: inst.id ?? null, symbol: inst.symbol, exchange: inst.exchange ?? null,
            date: e.date, time_hint: ['bmo', 'amc', 'dmh'].includes(e.hour) ? e.hour : 'unknown',
            details: {
              epsEstimate: toNum(e.epsEstimate), epsActual: toNum(e.epsActual),
              revenueEstimate: toNum(e.revenueEstimate), revenueActual: toNum(e.revenueActual), quarter: e.quarter, year: e.year,
            },
            source: 'Finnhub earnings calendar',
          });
        }
      }
      return { events, notCovered };
    },

    async getNews(symbol, from, to) {
      const d = await call('/company-news', { symbol, from, to });
      return (Array.isArray(d) ? d : []).map((n) => ({
        title: n.headline, url: n.url, source_name: n.source, published_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
        summary: n.summary || '', related: String(n.related || symbol).split(',').map((x) => x.trim()).filter(Boolean),
        provider: 'Finnhub', provider_id: n.id,
      }));
    },
  };
}
