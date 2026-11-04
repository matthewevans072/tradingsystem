// A synthetic 5-minute market for QQQ and a fake data.alpaca.markets that serves it (daily and 5-minute bars) to
// server/hxr/source.js for the ICT Lab tests. No network. The prices are made-up and only exercise code paths;
// they are never results and say nothing about the real ETF. Planting options let tests create extended-hours
// bars, misaligned timestamps, bad OHLC, missing slots, missing sessions and a daily bar that disagrees with its
// session.
import { tradingDays } from '../server/strategy/sessions.js';
import { dayInfo } from '../server/calendar.js';
import { zonedToUtc, NY } from '../server/time.js';

export const KEY_ID = 'PKICTLABTESTKEY0123456789';
export const SECRET_KEY = 'ict-lab-test-secret-abcdefghijklmnopqrstuv';
export const CLOCK = () => new Date('2026-11-04T15:00:00Z');

const r2 = (x) => Math.round(x * 100) / 100;
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

// { [sym]: { sessions: Map(date -> [{ ms, minutes, second, o, h, l, c, v }]), daily: Map(date -> { o, h, l, c, v }) } }
export function buildMarket({ symbols = ['QQQ'], from, to, seed = 7, extended = true, misaligned = {}, badOhlc = {}, missingSlots = {}, missingSessions = {}, dailyTweak = {}, volatility = 0.004 } = {}) {
  const out = {};
  symbols.forEach((sym, si) => {
    const rand = rng(seed + si * 101);
    const sessions = new Map(), daily = new Map();
    let price = 180;
    for (const d of tradingDays(from, to)) {
      if ((missingSessions[sym] || []).includes(d)) continue;
      const info = dayInfo(d, 'NYSE');
      const n = (info.closeMin - info.openMin) / 5;
      const bars = [];
      const mk = (minutes, second = 0) => {
        const o = price;
        const c = r2(o * (1 + volatility * (rand() - 0.5)));
        const h = r2(Math.max(o, c) * (1 + 0.001 * rand())), l = r2(Math.min(o, c) * (1 - 0.001 * rand()));
        price = c;
        return { ms: zonedToUtc(d, Math.floor(minutes / 60), minutes % 60, NY).getTime() + second * 1000, minutes, second, o: r2(o), h, l, c, v: 1000 + Math.round(1000 * rand()) };
      };
      if (extended) { bars.push(mk(9 * 60 + 20)); bars.push(mk(9 * 60 + 25)); }
      let dh = -Infinity, dl = Infinity, dOpen = null, dClose = null;
      for (let i = 0; i < n; i++) {
        const b = mk(info.openMin + 5 * i);
        if (dOpen == null) dOpen = b.o;
        dClose = b.c;
        if ((missingSlots[sym]?.[d] || []).includes(i)) continue;
        if (badOhlc[sym]?.[d] === i) { const t = b.h; b.h = b.l; b.l = t; }
        dh = Math.max(dh, b.h); dl = Math.min(dl, b.l);
        bars.push(b);
      }
      if ((misaligned[sym] || []).includes(d)) bars.push({ ...mk(9 * 60 + 32), minutes: 9 * 60 + 32 });
      if (extended) { bars.push(mk(info.closeMin)); bars.push(mk(info.closeMin + 5)); }
      sessions.set(d, bars);
      const tw = dailyTweak[sym]?.[d] || {};
      daily.set(d, { o: dOpen, h: r2(dh + (tw.h || 0)), l: r2(dl + (tw.l || 0)), c: dClose, v: 5000 });
    }
    out[sym] = { sessions, daily };
  });
  return out;
}

// The market as engine inputs: { daily: [{ date, o, h, l, c }], sessions: [{ date, full, bars: [{ idx, o, h, l, c }] }] }.
export function inputsOf(market, sym = 'QQQ') {
  const sessions = [...market[sym].sessions].map(([date, bars]) => {
    const regular = bars.filter((b) => b.second === 0 && b.minutes >= 570 && b.minutes < dayInfo(date, 'NYSE').closeMin && b.minutes % 5 === 0);
    return { date, full: (dayInfo(date, 'NYSE').closeMin - 570) / 5, bars: regular.map((b) => ({ idx: (b.minutes - 570) / 5, o: b.o, h: b.h, l: b.l, c: b.c })) };
  });
  const daily = [...market[sym].daily].map(([date, d]) => ({ date, ...d }));
  return { daily, sessions };
}

const iso = (ms) => new Date(ms).toISOString();
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });

function paged(list, q, key, limit, shape) {
  const offset = Number(q.page_token || 0);
  const page = list.slice(offset, offset + limit);
  const next = offset + limit < list.length ? String(offset + limit) : null;
  return res(200, { [key]: shape(page), next_page_token: next });
}

export function fakeAlpaca({ market, handler = null } = {}) {
  const calls = [];
  const series = new Map();
  const seriesOf = (sym) => {
    if (!series.has(sym)) {
      const daily = [], m5 = [];
      for (const [d, b] of market[sym].daily) daily.push({ ms: zonedToUtc(d, 0, 0, NY).getTime(), t: iso(zonedToUtc(d, 0, 0, NY).getTime()), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: 10, vw: b.c });
      for (const [, bars] of market[sym].sessions) for (const b of bars) m5.push({ ms: b.ms, t: iso(b.ms), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: 5, vw: b.c });
      m5.sort((a, b) => a.ms - b.ms);
      series.set(sym, { daily, m5 });
    }
    return series.get(sym);
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url, origin: u.origin, path: u.pathname, q: Object.fromEntries(u.searchParams), headers: init.headers || {}, redirect: init.redirect };
    calls.push(call);
    if (handler) { const r = await handler(call); if (r) return r; }
    if (call.headers['APCA-API-KEY-ID'] !== KEY_ID || call.headers['APCA-API-SECRET-KEY'] !== SECRET_KEY) return res(401, { message: 'unauthorized' });
    const q = call.q;
    if (u.pathname === '/v2/stocks/bars') {
      const sym = q.symbols;
      if (!market[sym]) return res(200, { bars: {}, next_page_token: null });
      const start = Date.parse(q.start), end = Date.parse(q.end);
      const { daily, m5 } = seriesOf(sym);
      const list = (q.timeframe === '1Day' ? daily : q.timeframe === '5Min' ? m5 : []).filter((x) => x.ms >= start && x.ms <= end).map(({ ms, ...x }) => x);
      return paged(list, q, 'bars', Number(q.limit) || 10000, (page) => ({ [sym]: page }));
    }
    return res(404, { message: 'not found' });
  };
  return { fetchImpl, calls };
}
