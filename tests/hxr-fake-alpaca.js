// A synthetic market for the HXR universe and a fake data.alpaca.markets that
// serves it (daily bars, 15-minute bars, corporate actions, quotes, news) to
// server/hxr/source.js. No network. The prices are made-up cycles that only
// exercise code paths (exits, buy-backs, splits, dividends); they are never
// results and say nothing about the real stocks.
import { tradingDays } from '../server/strategy/sessions.js';
import { regularSessionBounds } from '../server/calendar.js';
import { zonedToUtc, zonedParts, NY } from '../server/time.js';

export const KEY_ID = 'PKHXRTESTKEY0123456789';
export const SECRET_KEY = 'hxr-test-secret-abcdefghijklmnopqrstuvwxyz';
export const MARKET_END = '2026-11-20';
// The prospective crash: MU's close on this session is 35% below its open.
export const CRASH = { symbol: 'MU', date: '2026-10-26', factor: 0.65 };

const r4 = (x) => Math.round(x * 10000) / 10000;
const iso = (d) => d.toISOString();
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

// Prices in post-split units; raw prices before a split are ratio times higher.
const SPECS = {
  MU: { from: '2016-01-04', p0: 14, drift: 0.22, amp: 0.36, period: 100, phase: 0.0, seed: 11 },
  AMZN: { from: '2016-01-04', p0: 33, drift: 0.2, amp: 0.34, period: 100, phase: 0.2, seed: 12 },
  META: { from: '2016-01-04', p0: 100, drift: 0.18, amp: 0.38, period: 100, phase: -0.2, seed: 13 },
  TSLA: { from: '2016-01-04', p0: 15, drift: 0.25, amp: 0.4, period: 100, phase: 0.3, seed: 14 },
  VST: { from: '2017-05-10', p0: 16, drift: 0.2, amp: 0.34, period: 100, phase: -0.1, seed: 15 },
  HOOD: { from: '2021-07-29', p0: 38, drift: 0.1, amp: 0.4, period: 300, phase: 0.1, seed: 16 },
  MUU: { from: '2024-10-10', p0: 4, drift: 0.3, amp: 0.5, period: 300, phase: 0.0, seed: 17 },
  NBIS: { from: '2024-10-21', p0: 20, drift: 0.3, amp: 0.4, period: 300, phase: 0.2, seed: 18 },
  SPCX: { from: '2026-06-12', p0: 120, drift: 0.2, amp: 0.2, period: 300, phase: 0.0, seed: 19 },
  // hxr-prereg-2: GOOG in every basket; the robustness list R.
  GOOG: { from: '2016-01-04', p0: 37, drift: 0.18, amp: 0.3, period: 100, phase: 0.15, seed: 20 },
  INTC: { from: '2016-01-04', p0: 34, drift: -0.05, amp: 0.3, period: 300, phase: 0.05, seed: 21 },
  CSCO: { from: '2016-01-04', p0: 27, drift: 0.05, amp: 0.25, period: 300, phase: -0.15, seed: 22 },
  PYPL: { from: '2016-01-04', p0: 36, drift: 0.02, amp: 0.4, period: 300, phase: 0.25, seed: 23 },
  SNAP: { from: '2017-03-02', p0: 24, drift: -0.08, amp: 0.45, period: 300, phase: -0.25, seed: 24 },
};
export const SPLITS = { AMZN: [['2022-06-06', 20]], TSLA: [['2020-08-31', 5], ['2022-08-25', 3]], MUU: [['2026-07-15', 20]], GOOG: [['2022-07-18', 20]] };
// Full quoted spread at the open, in bps of mid.
const SPREAD_BPS = { MU: 6, AMZN: 4, META: 5, TSLA: 8, VST: 12, HOOD: 15, MUU: 30, NBIS: 25, SPCX: 40, GOOG: 4, INTC: 5, CSCO: 5, PYPL: 7, SNAP: 12 };

function rawFactor(sym, date) {
  return (SPLITS[sym] || []).filter(([d]) => date < d).reduce((a, [, r]) => a * r, 1);
}

// { SYM: Map(date -> { o, h, l, c, v, n, vw, vw15 }) } of raw (unadjusted) daily bars.
export function buildMarket(end = MARKET_END) {
  const out = {};
  for (const [sym, s] of Object.entries(SPECS)) {
    const rand = rng(s.seed);
    const days = tradingDays(s.from, end);
    const bars = new Map();
    let prev = null, noise = 0;
    days.forEach((d, i) => {
      noise = 0.85 * noise + 0.012 * (rand() - 0.5);
      let close = s.p0 * Math.exp((s.drift * i) / 252 + s.amp * Math.sin((2 * Math.PI * i) / s.period + s.phase) + noise);
      if (sym === CRASH.symbol && d >= CRASH.date) close *= CRASH.factor;
      const open = prev == null ? close : prev * (1 + 0.006 * (rand() - 0.5));
      const f = rawFactor(sym, d);
      const o = open * f, c = close * f;
      const h = Math.max(o, c) * (1.002 + 0.004 * rand()), l = Math.min(o, c) * (0.998 - 0.004 * rand());
      bars.set(d, { o: r4(o), h: r4(h), l: r4(l), c: r4(c), v: Math.round(1e6 + 5e5 * rand()), n: 1000 + Math.round(500 * rand()), vw: r4((o + c) / 2), vw15: r4(o * (1 + 0.0016 * (rand() - 0.5))) });
      prev = close;
    });
    out[sym] = bars;
  }
  return out;
}

// Alpaca-shaped corporate actions (field names as in the real responses).
export function corporateActions() {
  const q = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const divs = [];
  const quarterly = (sym, from, to, rate, { noPayDate = () => false } = {}) => {
    for (let y = 2016; y <= 2026; y++) {
      for (const m of [2, 5, 8, 11]) {
        const ex = q(y, m, 14);
        if (ex < from || ex > to) continue;
        const pay = noPayDate(ex) ? null : q(y, m, 28);
        divs.push({ cusip: `${sym}CUSIP`, ex_date: ex, foreign: false, id: `div-${sym}-${ex}`, ...(pay ? { payable_date: pay } : {}), process_date: pay || ex, rate, record_date: ex, special: false, symbol: sym });
      }
    }
  };
  quarterly('MU', '2023-01-01', '2026-12-31', 0.115);
  quarterly('META', '2024-02-01', '2026-12-31', 0.5);
  quarterly('VST', '2019-01-01', '2026-12-31', 0.125, { noPayDate: (ex) => ex < '2020-03-01' });
  // The old SPCX (an ETF) paid dividends before SpaceX listed: ignored by HXR.
  divs.push({ cusip: '19423L672', ex_date: '2025-12-19', id: 'div-SPCX-old', payable_date: '2025-12-23', process_date: '2025-12-23', rate: 0.4, symbol: 'SPCX' });
  return {
    forward_splits: Object.entries(SPLITS).flatMap(([sym, list]) => list.map(([d, r]) => ({ cusip: `${sym}CUSIP`, ex_date: d, id: `split-${sym}-${d}`, new_rate: r, old_rate: 1, payable_date: d, process_date: d, record_date: d, symbol: sym }))),
    cash_dividends: divs,
    name_changes: [
      { id: 'nc-fb-meta', new_cusip: 'METACUSIP', new_symbol: 'META', old_cusip: 'METACUSIP', old_symbol: 'FB', process_date: '2022-06-09' },
      { id: 'nc-spcx-spck', new_cusip: '19423L672', new_symbol: 'SPCK', old_cusip: '19423L672', old_symbol: 'SPCX', process_date: '2026-04-07' },
    ],
    cash_mergers: [{ acquiree_cusip: '29279N102', acquiree_symbol: 'ENGH', acquirer_cusip: 'VSTCUSIP', acquirer_symbol: 'VST', effective_date: '2024-03-04', id: 'merger-engh', process_date: '2024-03-04', rate: 86.5 }],
  };
}

const actionSymbols = (a) => [a.symbol, a.old_symbol, a.new_symbol, a.acquiree_symbol, a.acquirer_symbol].filter(Boolean);
const etMidnight = (d) => zonedToUtc(d, 0, 0, NY);
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });

function paged(list, q, key, limit, shape) {
  const offset = Number(q.page_token || 0);
  const page = list.slice(offset, offset + limit);
  const next = offset + limit < list.length ? String(offset + limit) : null;
  return res(200, { [key]: shape(page), next_page_token: next });
}

// news: [{ id, created_at, updated_at, headline, summary, author, url, symbols, availableAt }];
// an item is served once the clock reaches availableAt (updated_at filters as Alpaca's start/end do).
export function fakeAlpaca({ clock, market = buildMarket(), news = [], handler = null } = {}) {
  const calls = [];
  const actions = corporateActions();
  // Per symbol, every daily and 15-minute bar with its instant, computed once.
  const series = new Map();
  const seriesOf = (sym) => {
    if (!series.has(sym)) {
      const daily = [], m15 = [];
      for (const [d, b] of market[sym]) {
        daily.push({ t: iso(etMidnight(d)), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw });
        const open = regularSessionBounds(d).open.getTime();
        m15.push({ t: iso(new Date(open - 15 * 60000)), o: b.o * 0.999, h: b.o, l: b.o * 0.998, c: b.o, v: 900, n: 9, vw: b.o * 0.999 });
        m15.push({ t: iso(new Date(open)), o: b.o, h: b.o * 1.003, l: b.o * 0.997, c: b.o * 1.001, v: 50000, n: 400, vw: b.vw15 });
      }
      for (const x of [...daily, ...m15]) x.ms = Date.parse(x.t);
      series.set(sym, { daily, m15 });
    }
    return series.get(sym);
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url, origin: u.origin, path: u.pathname, q: Object.fromEntries(u.searchParams), headers: init.headers || {} };
    calls.push(call);
    if (handler) { const r = await handler(call); if (r) return r; }
    if (call.headers['APCA-API-KEY-ID'] !== KEY_ID || call.headers['APCA-API-SECRET-KEY'] !== SECRET_KEY) return res(401, { message: 'unauthorized' });
    const q = call.q;
    if (u.pathname === '/v2/stocks/bars') {
      const sym = q.symbols;
      if (!market[sym]) return res(200, { bars: {}, next_page_token: null });
      const start = Date.parse(q.start), end = Date.parse(q.end);
      const { daily, m15 } = seriesOf(sym);
      const list = (q.timeframe === '1Day' ? daily : m15).filter((x) => x.ms >= start && x.ms <= end).map(({ ms, ...x }) => x);
      return paged(list, q, 'bars', Number(q.limit) || 10000, (page) => ({ [sym]: page }));
    }
    if (u.pathname === '/v2/stocks/quotes') {
      const sym = q.symbols, start = Date.parse(q.start);
      const date = zonedParts(new Date(start), NY).date;
      const b = market[sym]?.get(date);
      if (!b) return res(200, { quotes: {}, next_page_token: null });
      const half = SPREAD_BPS[sym] / 2 / 10000;
      const quotes = [0, 5, 10, 20, 40].map((s, i) => {
        const mid = b.o * (1 + 0.0004 * (i - 2));
        return { t: iso(new Date(start + s * 1000 + 250)), ap: r4(mid * (1 + half)), as: 3, ax: 'K', bp: r4(mid * (1 - half)), bs: 5, bx: 'Q', c: ['R'], z: 'C' };
      });
      quotes.push({ t: iso(new Date(start + 30000)), ap: b.o, bp: 0, as: 1, bs: 1, c: [], z: 'C' }); // unusable, dropped
      return res(200, { quotes: { [sym]: quotes }, next_page_token: null });
    }
    if (u.pathname === '/v1/corporate-actions') {
      const want = new Set(q.symbols.split(','));
      const groups = Object.fromEntries(Object.entries(actions).map(([k, list]) => [k, list.filter((a) => actionSymbols(a).some((s) => want.has(s)))]));
      return res(200, { corporate_actions: groups, next_page_token: null });
    }
    if (u.pathname === '/v1beta1/news') {
      const want = new Set(q.symbols.split(','));
      const now = clock().getTime();
      const list = news.filter((n) => Date.parse(n.availableAt ?? n.updated_at) <= now && n.symbols.some((s) => want.has(s))
        && (!q.start || Date.parse(n.updated_at) >= Date.parse(q.start)) && (!q.end || Date.parse(n.updated_at) <= Date.parse(q.end)))
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
        .map(({ availableAt, ...n }) => ({ content: '', images: [], source: '', ...n }));
      return paged(list, q, 'news', Number(q.limit) || 50, (page) => page);
    }
    return res(404, { message: 'not found' });
  };
  return { fetchImpl, calls };
}
