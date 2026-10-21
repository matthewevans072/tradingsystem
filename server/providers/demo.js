// Synthetic data for the separate DEMO workspace only. It is never used for
// the real portfolio, and every value it produces is labelled "Demo (synthetic)".
import { sessionAt } from '../calendar.js';
import { addTransaction, setCash, setStrategy, findInstrument, updateInstrument } from '../portfolio.js';
import { nowIso } from '../db.js';

function hash(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const BASE = { NVDA: 180, VRT: 120, MU: 110, VFV: 150, XEQT: 33, SOXL: 25, CEG: 300, ANET: 130 };

function synthPrice(symbol, dayIndex) {
  const b = BASE[symbol] || 50;
  const h = hash(symbol);
  return +(b * (1 + 0.06 * Math.sin(dayIndex / 9 + h * 6) + 0.02 * Math.sin(dayIndex / 2.3 + h * 3))).toFixed(2);
}

export function createDemoProvider() {
  return {
    id: 'demo',
    name: 'Demo (synthetic)',
    capabilities: { quotes: true, dailyBars: true, intradayBars: false, extendedHours: false, earnings: false, splits: false, news: false },
    usage: () => ({ today: 0 }),
    async getQuotes(instruments, now = new Date()) {
      const day = Math.floor(now.getTime() / 86400000);
      return instruments.map((inst) => {
        const price = synthPrice(inst.symbol, day);
        const prev = synthPrice(inst.symbol, day - 1);
        return {
          instrument_id: inst.id, ok: true,
          quote: {
            provider: 'Demo (synthetic)', price, prev_close: prev, change: +(price - prev).toFixed(2),
            change_pct: +(((price - prev) / prev) * 100).toFixed(2),
            open: prev, high: +(Math.max(price, prev) * 1.01).toFixed(2), low: +(Math.min(price, prev) * 0.99).toFixed(2),
            volume: Math.round(1e6 * (1 + hash(inst.symbol + day))), avg_volume: 1e6,
            session: sessionAt(now, inst.exchange).session, quote_time: now.toISOString(),
            timeliness: 'synthetic', delay_minutes: 0,
          },
        };
      });
    },
    async getDailyBars(inst, n = 120) {
      const today = Math.floor(Date.now() / 86400000);
      const out = [];
      for (let d = today - n; d <= today; d++) {
        const dt = new Date(d * 86400000);
        if ([0, 6].includes(dt.getUTCDay())) continue;
        const c = synthPrice(inst.symbol, d), o = synthPrice(inst.symbol, d - 1);
        out.push({ ts: dt.toISOString().slice(0, 10), o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 1e6, session: 'regular' });
      }
      return out;
    },
  };
}

export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) n FROM transactions').get().n > 0) return false;
  const rows = [
    ['TFSA', 'BASELINE', '2026-08-01', 'VFV', 'TSX', 'CAD', 20, 140, 'long_term', 'etf'],
    ['TFSA', 'BASELINE', '2026-08-01', 'XEQT', 'TSX', 'CAD', 100, 31, 'long_term', 'etf'],
    ['TFSA', 'BUY', '2026-08-12', 'NVDA', 'NASDAQ', 'USD', 8, 172, 'swing', 'stock'],
    ['TFSA', 'BUY', '2026-09-03', 'VRT', 'NYSE', 'USD', 10, 118, 'swing', 'stock'],
    ['TFSA', 'BUY', '2026-09-15', 'MU', 'NASDAQ', 'USD', 6, 104, 'swing', 'stock'],
    ['TFSA', 'BUY', '2026-09-22', 'SOXL', 'NYSE Arca', 'USD', 20, 27, 'swing', 'etf'],
  ];
  for (const [account, type, date, symbol, exchange, currency, q, p, strategy, secType] of rows) {
    addTransaction(db, {
      account, type, trade_date: date, symbol, exchange, currency, quantity: q, price: p, fees: 0, strategy, sec_type: secType,
      fx_rate_cad: currency === 'USD' ? 1.37 : null, note: 'DEMO DATA',
    }, { source: 'manual' });
    const inst = findInstrument(db, symbol, exchange);
    updateInstrument(db, inst.id, { identity_status: 'confirmed', identity_note: 'Demo workspace' });
  }
  setCash(db, { account: 'TFSA', currency: 'CAD', amount: 250, asOf: '2026-10-01', source: 'demo' });
  setCash(db, { account: 'TFSA', currency: 'USD', amount: 40, asOf: '2026-10-01', source: 'demo' });
  db.prepare("INSERT OR REPLACE INTO fx_rates VALUES ('USDCAD', 1.38, ?, 'Demo (synthetic)', ?)").run(new Date().toISOString().slice(0, 10), nowIso());
  return true;
}

export { setStrategy };
