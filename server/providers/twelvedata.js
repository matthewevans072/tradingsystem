// Twelve Data adapter (https://twelvedata.com/docs). Covers US and, on paid
// plans, Canadian listings. Quote timeliness depends on the user's plan, so it
// comes from settings rather than being assumed real-time.
import { getJson, ProviderError, RateLimiter, toNum } from './http.js';
import { zonedToUtc, NY, TORONTO } from '../time.js';
import { exchangeGroup, sessionAt } from '../calendar.js';

const BASE = 'https://api.twelvedata.com';
const RANGE_PAGE = 5000; // Twelve Data's largest outputsize

// time_series values (exchange-local datetimes) → UTC bars tagged by session.
function intradayRows(d, inst) {
  const tz = d.meta?.exchange_timezone || (exchangeGroup(inst.exchange) === 'TSX' ? TORONTO : NY);
  return (d.values || []).map((v) => {
    const [day, time] = v.datetime.split(' ');
    const [hh, mm] = time.split(':').map(Number);
    const at = zonedToUtc(day, hh, mm, tz);
    return { ts: at.toISOString(), o: toNum(v.open), h: toNum(v.high), l: toNum(v.low), c: toNum(v.close), v: toNum(v.volume), session: sessionAt(at, inst.exchange).session };
  });
}

export function createTwelveData({ apiKey, plan = {}, fetchImpl } = {}) {
  const limiter = new RateLimiter({ perMinute: plan.perMinute || 8, perDay: plan.perDay || 800 });
  const delayFor = (exchange) => {
    const g = exchangeGroup(exchange);
    return g === 'TSX' ? (plan.delayMinutesCA ?? 15) : (plan.delayMinutesUS ?? 15);
  };

  async function call(path, params, cost = 1) {
    if (!apiKey) throw new ProviderError('auth', 'Twelve Data API key is not configured');
    await limiter.take(cost);
    const qs = new URLSearchParams({ ...params, apikey: apiKey });
    let data;
    try {
      data = await getJson(`${BASE}${path}?${qs}`, { fetchImpl, label: 'Twelve Data' });
    } catch (e) {
      if (e.kind === 'rate_limit') limiter.backoff(e.retryAfterSec || 60);
      throw e;
    }
    if (data && data.status === 'error') {
      const code = Number(data.code);
      if (code === 429) { limiter.backoff(60); throw new ProviderError('rate_limit', `Twelve Data: ${data.message}`); }
      if (code === 401 || code === 403) throw new ProviderError('auth', `Twelve Data: ${data.message}`);
      if (code === 404 || code === 400) throw new ProviderError('not_found', `Twelve Data: ${data.message}`);
      throw new ProviderError('bad_response', `Twelve Data: ${data.message || 'error'}`);
    }
    return data;
  }

  function symbolParams(inst) {
    const sym = inst.provider_symbol || inst.symbol;
    if (inst.provider_symbol && inst.provider_symbol.includes(':')) return { symbol: inst.provider_symbol };
    const g = exchangeGroup(inst.exchange);
    if (g === 'TSX') return { symbol: sym, exchange: inst.exchange === 'TSXV' ? 'TSXV' : 'TSX' };
    return { symbol: sym };
  }

  function parseQuote(q, inst, now) {
    const price = toNum(q.close);
    if (price == null) throw new ProviderError('bad_response', `Twelve Data: no price for ${inst.symbol}`);
    const ts = toNum(q.timestamp);
    const quoteTime = ts ? new Date(ts * 1000).toISOString() : null;
    if (q.currency && q.currency !== inst.currency) {
      throw new ProviderError('bad_response', `Twelve Data returned ${inst.symbol} in ${q.currency}, but the instrument trades in ${inst.currency}. The symbol mapping may be wrong.`);
    }
    const out = {
      provider: 'Twelve Data',
      price,
      prev_close: toNum(q.previous_close),
      change: toNum(q.change),
      change_pct: toNum(q.percent_change),
      open: toNum(q.open), high: toNum(q.high), low: toNum(q.low),
      volume: toNum(q.volume), avg_volume: toNum(q.average_volume),
      session: q.is_market_open ? 'regular' : sessionAt(now, inst.exchange).session,
      quote_time: quoteTime,
      timeliness: delayFor(inst.exchange) === 0 ? 'real-time' : 'delayed',
      delay_minutes: delayFor(inst.exchange),
      provider_exchange: q.exchange || null,
      provider_name: q.name || null,
    };
    const ext = toNum(q.extended_price);
    if (ext != null && q.extended_timestamp) {
      const et = new Date(Number(q.extended_timestamp) * 1000);
      out.ext_price = ext;
      out.ext_change_pct = toNum(q.extended_percent_change);
      out.ext_time = et.toISOString();
      out.ext_session = sessionAt(et, inst.exchange).session;
    }
    return out;
  }

  return {
    id: 'twelvedata',
    name: 'Twelve Data',
    capabilities: { quotes: true, dailyBars: true, intradayBars: true, extendedHours: !!plan.extendedHours, earnings: true, splits: true, news: false },
    usage: () => limiter.usage(),

    async getQuotes(instruments, now = new Date()) {
      const results = [];
      for (const inst of instruments) {
        try {
          const params = symbolParams(inst);
          if (plan.extendedHours) params.prepost = 'true';
          const q = await call('/quote', params, 1);
          results.push({ instrument_id: inst.id, ok: true, quote: parseQuote(q, inst, now) });
        } catch (e) {
          results.push({ instrument_id: inst.id, ok: false, error: e });
          if (e.kind === 'auth') break; // no point hammering with a bad key
        }
      }
      return results;
    },

    async getDailyBars(inst, outputsize = 260) {
      const d = await call('/time_series', { ...symbolParams(inst), interval: '1day', outputsize: String(outputsize), order: 'ASC' }, 1);
      return (d.values || []).map((v) => ({
        ts: v.datetime.slice(0, 10), o: toNum(v.open), h: toNum(v.high), l: toNum(v.low), c: toNum(v.close), v: toNum(v.volume), session: 'regular',
      }));
    },

    // Intraday bars for one exchange-local date, tagged by session.
    async getIntradayBars(inst, date, interval = '5min') {
      const params = { ...symbolParams(inst), interval, start_date: `${date} 00:00:00`, end_date: `${date} 23:59:59`, order: 'ASC' };
      if (plan.extendedHours) params.prepost = 'true';
      const d = await call('/time_series', params, 1);
      return intradayRows(d, inst);
    },

    // Regular-session intraday bars between two exchange-local dates (Strategy
    // Lab history), oldest first. A response at the 5,000-bar cap may cover
    // either end of the range, so both uncovered sides are requested next; each
    // page is one request through the rate limiter.
    async getIntradayRange(inst, from, to, interval = '15min') {
      const out = new Map();
      const todo = [[`${from} 00:00:00`, `${to} 23:59:59`]];
      for (let page = 0; todo.length && page < 100; page++) {
        const [lo, hi] = todo.shift();
        const d = await call('/time_series', { ...symbolParams(inst), interval, start_date: lo, end_date: hi, outputsize: String(RANGE_PAGE), order: 'ASC' }, 1);
        const values = [...(d.values || [])].sort((a, b) => (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0));
        for (const b of intradayRows({ ...d, values }, inst)) out.set(b.ts, b);
        if (values.length < RANGE_PAGE) continue;
        const first = values[0].datetime, last = values[values.length - 1].datetime;
        if (first > lo && first < hi) todo.push([lo, first]);
        if (last < hi && last > lo) todo.push([last, hi]);
      }
      return [...out.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    },

    // instruments: { id, symbol, exchange, provider_symbol }. Each calendar row
    // names its exchange, so a ticker matches only its own listing (T on the
    // TSX is not T on the NYSE). A calendar with no Canadian rows at all does
    // not cover Canada on this plan: TSX listings are reported as not covered.
    async getEarnings(instruments, from, to) {
      const d = await call('/earnings_calendar', { start_date: from, end_date: to }, 1);
      const rows = Object.entries(d.earnings || {}).flatMap(([date, list]) => list.map((e) => ({ ...e, date })));
      // A row without an exchange is taken as a US listing; other markets match nothing.
      const rowGroup = (e) => (!e.exchange ? 'NYSE' : exchangeGroup(e.exchange) === 'TSX' ? 'TSX' : /^(NYSE|NASDAQ|AMEX|CBOE|BATS|OTC)/i.test(e.exchange) ? 'NYSE' : null);
      const canada = rows.some((e) => rowGroup(e) === 'TSX');
      const events = [], notCovered = [];
      for (const inst of instruments) {
        const g = exchangeGroup(inst.exchange);
        if (g === 'TSX' && !canada) {
          notCovered.push({ symbol: inst.symbol, exchange: inst.exchange, reason: 'non-US listing not covered by Twelve Data' });
          continue;
        }
        const sym = (inst.provider_symbol || inst.symbol).split(':')[0].toUpperCase();
        for (const e of rows) {
          if (String(e.symbol).toUpperCase() !== sym || rowGroup(e) !== g) continue;
          const t = String(e.time || '').toLowerCase();
          events.push({
            instrument_id: inst.id ?? null, symbol: inst.symbol, date: e.date, exchange: e.exchange || inst.exchange || null,
            time_hint: t.includes('pre') || t.includes('before') ? 'bmo' : t.includes('after') ? 'amc' : 'unknown',
            details: { epsEstimate: toNum(e.eps_estimate), epsActual: toNum(e.eps_actual), surprisePct: toNum(e.surprise_prc) },
            source: 'Twelve Data earnings calendar',
          });
        }
      }
      return { events, notCovered };
    },

    async getSplits(inst) {
      const d = await call('/splits', { ...symbolParams(inst), range: 'full' }, 1);
      return (d.splits || []).map((s) => ({ date: s.date, from: toNum(s.from_factor), to: toNum(s.to_factor), description: s.description }));
    },

    async getFx() {
      const q = await call('/quote', { symbol: 'USD/CAD' }, 1);
      return { rate: toNum(q.close), as_of: new Date(Number(q.timestamp) * 1000).toISOString(), source: 'Twelve Data USD/CAD' };
    },
  };
}
