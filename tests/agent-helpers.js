// Shared fixtures for the Ask Signal Desk tests: a seeded workspace and a
// scripted backend that stands in for the model.
import path from 'node:path';
import { tempDir, putQuote } from './helpers.js';
import { loadConfig } from '../server/config.js';
import { createContext } from '../server/context.js';
import { addTransaction, findInstrument, updateInstrument, setCash } from '../server/portfolio.js';
import { zonedToUtc } from '../server/time.js';

export const NOW = zonedToUtc('2026-10-21', 14, 0); // regular session

export function makeCtx() {
  const dir = tempDir();
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none' });
  const ctx = createContext(cfg, 'real');
  return ctx;
}

export function seed(ctx) {
  addTransaction(ctx.db, { type: 'BASELINE', trade_date: '2026-09-30', account: 'TFSA', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 100, price: 90, fees: 0, fx_rate_cad: 1.36 });
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 120, fees: 5 });
  for (const s of [['NBIS', 'NASDAQ'], ['VRT', 'NYSE']]) {
    const i = findInstrument(ctx.db, ...s);
    updateInstrument(ctx.db, i.id, { identity_status: 'confirmed', identity_note: 'test' });
  }
  putQuote(ctx.db, findInstrument(ctx.db, 'NBIS', 'NASDAQ').id, { price: 101.5, prev_close: 104, change: -2.5, change_pct: -2.4, high: 105, low: 100.8, quote_time: new Date(NOW - 5 * 60000).toISOString(), timeliness: 'delayed', delay_minutes: 15 });
  putQuote(ctx.db, findInstrument(ctx.db, 'VRT', 'NYSE').id, { price: 130, prev_close: 128, change: 2, change_pct: 1.56, high: 131, low: 127, quote_time: new Date(NOW - 3 * 3600000).toISOString(), timeliness: 'delayed', delay_minutes: 15 });
  setCash(ctx.db, { account: 'TFSA', currency: 'USD', amount: 250, asOf: '2026-10-20', confirmed: true });
  ctx.db.prepare("INSERT INTO fx_rates VALUES ('USDCAD', 1.38, '2026-10-20', 'Bank of Canada daily rate', ?)").run(NOW.toISOString());
}

// Scripted backend: `script` is a list of functions (messages) -> content blocks.
export function scripted(script) {
  let i = 0;
  const calls = [];
  return {
    name: 'scripted', available: true, model: 'scripted-model', config: { dailyBudgetUsd: 0, maxToolRounds: 8 },
    calls,
    async create({ system, tools, messages }) {
      calls.push({ system, tools, messages: JSON.parse(JSON.stringify(messages)) });
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      const content = step(messages);
      return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } };
    },
  };
}
let idn = 0;
export const use = (name, input) => ({ type: 'tool_use', id: `tu_${++idn}`, name, input });
export const lastResults = (messages) => {
  const m = messages.at(-1);
  return Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result').map((b) => (b.is_error ? { error: b.content } : JSON.parse(b.content))) : [];
};
export const answer = (a) => [use('submit_answer', { horizon: null, what_would_change_it: null, alternatives: [], affected_symbols: [], follow_up_questions: [], confidence: 'not_applicable', details: [], ...a })];

export const RECORD_TABLES = ['transactions', 'cash_balances', 'alert_rules', 'position_meta', 'instruments', 'accounts', 'corporate_actions', 'settings', 'watchlist', 'descriptions'];
export function snapshot(db) {
  return Object.fromEntries(RECORD_TABLES.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]));
}

