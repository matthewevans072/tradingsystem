// JSON API. Every handler receives the active workspace context (real or demo).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  computePortfolio, addTransaction, editTransaction, voidTransaction, setStrategy, updateInstrument, changeSymbol, addSplit,
  setCash, latestCash, deriveLedger,
} from './portfolio.js';
import { previewImport, applyImport, discardImport, CSV_TEMPLATE } from './importer.js';
import { runAssessments, latestAssessments, RISK_QUESTIONS, riskProfileStatus, DEFAULT_THRESHOLDS } from './assessments.js';
import { dailyBars, indicators, intradayBars } from './analytics.js';
import { listNews } from './news.js';
import { produceBriefing, searchBriefings, KINDS } from './briefings.js';
import { DEFAULT_ALERT_SETTINGS, alertSettings, ALERT_TYPES } from './alerts.js';
import { deliver, deliveryPrefs } from './delivery.js';
import { refreshQuotes, refreshFx, refreshDailyBars, refreshEarnings, refreshIntraday, providerStatus, DEFAULT_PROVIDER_SETTINGS, checkSplits } from './marketdata.js';
import { ingestNews } from './news.js';
import { getSetting, setSetting, nowIso, audit } from './db.js';
import { publicConfigStatus } from './config.js';
import { createBackup, listBackups, safeBackupPath, restoreBackup, validateBackupFile, backupDir } from './backup.js';
import { dbFileFor } from './context.js';
import { log } from './log.js';
import { CATEGORIES } from './catalog.js';
import { DEFAULT_SCHEDULE } from './scheduler.js';
import { todayIn, addDays, NY } from './time.js';
import { sessionAt } from './calendar.js';
import { analystAvailable } from './analyst.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const routes = [];
const r = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

export function matchRoute(method, pathname) {
  for (const rt of routes) {
    if (rt.method !== method) continue;
    const m = pathname.match(rt.re);
    if (m) return { handler: rt.handler, params: Object.fromEntries(rt.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const SETTING_KEYS = {
  providers: DEFAULT_PROVIDER_SETTINGS,
  delivery: { briefings: ['in_app'], alerts: ['in_app'] },
  alerts: DEFAULT_ALERT_SETTINGS,
  schedule: DEFAULT_SCHEDULE,
  riskProfile: {},
  assessmentThresholds: DEFAULT_THRESHOLDS,
  profile: { brokerage: '', snapshotConfirmed: null, cashConfirmed: null, dataBudget: '', notes: '' },
};

function describe(ctx, inst) {
  return ctx.catalog.describeInstrument(inst);
}

function enrichPositions(ctx, portfolio) {
  const assessments = new Map(latestAssessments(ctx.db).map((a) => [a.instrument_id, a]));
  const instruments = new Map(ctx.db.prepare('SELECT * FROM instruments').all().map((i) => [i.id, i]));
  for (const p of [...portfolio.positions, ...portfolio.closed]) {
    const inst = instruments.get(p.instrument_id);
    const d = describe(ctx, inst);
    p.description = d ? {
      oneLiner: d.oneLiner, name: d.name, type: d.type, category: d.category, aiConnection: d.aiConnection, leveraged: !!d.leveraged,
      dailyObjective: d.dailyObjective || null, sourceUrl: d.sourceUrl, lastReviewed: d.lastReviewed, verification: d.verification,
      identityWarning: !!d.identityWarning, missing: !!d.missing, otherListings: d.otherListings || [],
    } : null;
    if (!p.name && d?.name) p.name = d.name;
    p.assessment = assessments.get(p.instrument_id) || null;
    if (d?.category && !p.sector) p.sector = d.category;
  }
  return portfolio;
}

function portfolioFor(ctx) {
  const p = computePortfolio(ctx.db, { catalog: ctx.catalog });
  const assessed = new Set(ctx.db.prepare('SELECT DISTINCT instrument_id FROM assessments').all().map((r) => r.instrument_id));
  if (p.positions.some((x) => !assessed.has(x.instrument_id))) runAssessments(ctx, p);
  return enrichPositions(ctx, p);
}

// ---------- status & overview ----------

r('GET', '/api/status', (ctx, { app }) => {
  const db = ctx.db;
  const counts = {
    transactions: db.prepare('SELECT COUNT(*) n FROM transactions WHERE voided_at IS NULL').get().n,
    instruments: db.prepare('SELECT COUNT(*) n FROM instruments').get().n,
    unconfirmedInstruments: db.prepare(`SELECT COUNT(DISTINCT i.id) n FROM instruments i JOIN transactions t ON t.instrument_id = i.id
                                        WHERE t.voided_at IS NULL AND i.identity_status != 'confirmed'`).get().n,
    unconfirmedFields: db.prepare('SELECT COUNT(*) n FROM transactions WHERE voided_at IS NULL AND unconfirmed_fields IS NOT NULL').get().n,
    briefings: db.prepare("SELECT COUNT(*) n FROM briefings WHERE status IN ('ok','partial')").get().n,
  };
  const cash = latestCash(db);
  const profile = getSetting(db, 'profile', SETTING_KEYS.profile);
  const risk = riskProfileStatus(db);
  const cfgStatus = publicConfigStatus(ctx.cfg);
  const setup = [
    { id: 'brokerage', label: 'Tell Signal Desk your brokerage', done: !!profile.brokerage },
    { id: 'holdings', label: 'Import or enter your holdings', done: counts.transactions > 0 },
    { id: 'identity', label: 'Confirm each instrument (exchange, currency, issuer)', done: counts.transactions > 0 && counts.unconfirmedInstruments === 0 },
    { id: 'snapshot', label: 'Confirm holdings are current since the saved snapshot', done: profile.snapshotConfirmed === true },
    { id: 'cash', label: 'Confirm available cash in each currency', done: cash.length > 0 && cash.every((c) => c.confirmed) },
    { id: 'market', label: 'Connect a market-data provider', done: cfgStatus.marketProvider !== 'none' && (cfgStatus.configured.twelvedata || cfgStatus.configured.finnhub) },
    { id: 'delivery', label: 'Choose where reports are delivered', done: (deliveryPrefs(db).briefings || []).some((c) => c !== 'in_app') || profile.inAppOnly === true },
    { id: 'risk', label: 'Answer the risk questions (needed for position sizing)', done: risk.complete },
  ];
  return {
    app: 'Signal Desk', version: app.version, mode: ctx.mode, now: nowIso(), session: sessionAt(new Date()),
    config: cfgStatus, providers: providerStatus(ctx), analyst: analystAvailable(ctx),
    scheduler: ctx.mode === 'real' && app.scheduler ? app.scheduler.status() : { enabled: false, reason: ctx.mode === 'demo' ? 'Scheduler runs only for the real workspace' : 'Disabled in configuration' },
    counts, setup, profile, riskComplete: risk.complete,
    host: { platform: os.platform(), node: process.version, dataDir: ctx.cfg.dataDir },
  };
});

r('GET', '/api/overview', (ctx) => {
  const p = portfolioFor(ctx);
  const db = ctx.db;
  const today = todayIn(NY);
  const priced = p.positions.filter((x) => x.dailyPL != null);
  const byCcy = (c) => priced.filter((x) => x.currency === c).sort((a, b) => b.dailyPL - a.dailyPL);
  const contributors = {};
  for (const c of ['USD', 'CAD']) {
    const l = byCcy(c);
    contributors[c] = { top: l.filter((x) => x.dailyPL > 0).slice(0, 3), bottom: l.filter((x) => x.dailyPL < 0).slice(-3).reverse() };
  }
  // Sector exposure: CAD-equivalent if FX available, else per currency.
  const sectors = {};
  for (const x of p.positions) {
    if (x.marketValue == null) continue;
    const key = x.sector || 'unclassified';
    const v = p.combined ? (x.currency === 'USD' ? x.marketValue * p.combined.fxRate : x.marketValue) : null;
    sectors[key] = sectors[key] || { value: 0, byCurrency: { USD: 0, CAD: 0 } };
    if (v != null) sectors[key].value += v;
    sectors[key].byCurrency[x.currency] += x.marketValue;
  }
  const held = new Set(p.positions.map((x) => x.symbol));
  const events = db.prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date LIMIT 40').all(today, addDays(today, 30))
    .filter((e) => e.type === 'macro' || held.has(e.symbol)).map((e) => ({ ...e, details: e.details_json ? JSON.parse(e.details_json) : null }));
  const latestBriefing = db.prepare("SELECT id, kind, trading_date, generated_at, status, title, substr(text,1,600) preview, content_json FROM briefings WHERE status IN ('ok','partial') ORDER BY generated_at DESC LIMIT 1").get();
  let briefing = null;
  if (latestBriefing) {
    const c = JSON.parse(latestBriefing.content_json);
    briefing = { ...latestBriefing, content_json: undefined, narrative: c.narrative && !c.narrative.error ? c.narrative : null, priorities: (c.sections.find((s) => /priorit|Conditions/.test(s.heading))?.items || []).slice(0, 5), dataIssues: c.dataIssues };
  }
  const alerts = db.prepare('SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY triggered_at DESC LIMIT 8').all();
  const lastFailed = db.prepare("SELECT kind, trading_date, status, error FROM briefings WHERE status IN ('failed','missed') ORDER BY id DESC LIMIT 3").all();
  const assess = p.positions.map((x) => x.assessment).filter(Boolean);
  return {
    asOf: p.asOf, totals: p.totals, combined: p.combined, fx: p.fx, cash: p.cash, limitations: p.limitations, issues: p.issues,
    positions: p.positions.map((x) => ({
      instrument_id: x.instrument_id, symbol: x.symbol, name: x.name, currency: x.currency, marketValue: x.marketValue, weightPct: x.weightPct ?? x.weightInCurrencyPct,
      dailyPL: x.dailyPL, dailyPct: x.dailyPct, unrealizedPL: x.unrealizedPL, unrealizedPct: x.unrealizedPct, sector: x.sector, strategy: x.strategy,
      oneLiner: x.description?.oneLiner, freshness: x.quote?.freshness || 'missing', action: x.assessment?.action,
    })),
    contributors, sectors, events, briefing, alerts, lastFailed,
    actionCounts: assess.reduce((m, a) => { m[a.action] = (m[a.action] || 0) + 1; return m; }, {}),
    freshness: summarizeFreshness(p),
  };
});

function summarizeFreshness(p) {
  const qs = p.positions.map((x) => x.quote).filter(Boolean);
  const providers = [...new Set(qs.map((q) => q.provider))];
  const newest = qs.map((q) => q.quoteTime).filter(Boolean).sort().at(-1) || null;
  const oldest = qs.map((q) => q.quoteTime).filter(Boolean).sort()[0] || null;
  return {
    providers, newest, oldest,
    fresh: qs.filter((q) => q.freshness === 'fresh').length,
    stale: qs.filter((q) => q.freshness === 'stale').length,
    missing: p.positions.length - qs.filter((q) => q.price != null).length,
    timeliness: [...new Set(qs.map((q) => q.timeliness).filter(Boolean))],
    fx: p.fx ? { rate: p.fx.rate, asOf: p.fx.as_of, source: p.fx.source } : null,
  };
}

// ---------- positions & instruments ----------

r('GET', '/api/positions', (ctx) => {
  const p = portfolioFor(ctx);
  return { ...p, accounts: ctx.db.prepare('SELECT * FROM accounts ORDER BY name').all() };
});

r('GET', '/api/instruments/:id', (ctx, { params }) => {
  const db = ctx.db;
  const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(Number(params.id));
  if (!inst) throw new HttpError(404, 'Instrument not found');
  const desc = describe(ctx, inst);
  const full = ctx.catalog.lookup(inst.symbol, inst.exchange);
  const bars = dailyBars(db, inst.id, 260);
  const p = portfolioFor(ctx);
  const positions = p.positions.filter((x) => x.instrument_id === inst.id);
  return {
    instrument: inst,
    description: desc,
    research: desc?.identityWarning ? null : full,
    positions,
    closed: p.closed.filter((x) => x.instrument_id === inst.id),
    quote: positions[0]?.quote || null,
    indicators: indicators(bars),
    bars: bars.map((b) => ({ t: b.ts, c: b.c, h: b.h, l: b.l })),
    intraday: intradayBars(db, inst.id, todayIn(NY)),
    transactions: db.prepare(`SELECT t.*, a.name AS account FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE instrument_id = ? ORDER BY trade_date DESC, id DESC`).all(inst.id),
    corporateActions: db.prepare('SELECT * FROM corporate_actions WHERE instrument_id = ? ORDER BY effective_date DESC').all(inst.id),
    symbolHistory: db.prepare('SELECT * FROM symbol_history WHERE instrument_id = ? ORDER BY effective_date DESC').all(inst.id),
    assessments: db.prepare('SELECT payload_json FROM assessments WHERE instrument_id = ? ORDER BY id DESC LIMIT 10').all(inst.id).map((x) => JSON.parse(x.payload_json)),
    news: listNews(db, { symbol: inst.symbol, limit: 20 }),
    events: db.prepare('SELECT * FROM events WHERE symbol = ? ORDER BY date DESC LIMIT 20').all(inst.symbol),
    otherListings: ctx.catalog.otherListings(inst.symbol, inst.exchange),
  };
});

r('PATCH', '/api/instruments/:id', (ctx, { params, body }) => {
  const patch = {};
  for (const k of ['name', 'sec_type', 'provider_symbol', 'identity_status', 'identity_note']) if (k in body) patch[k] = body[k];
  if (patch.identity_status && !['confirmed', 'needs_confirmation'].includes(patch.identity_status)) throw new HttpError(400, 'Invalid identity status');
  if (patch.identity_status === 'confirmed' && !String(body.identity_note || '').trim()) throw new HttpError(400, 'Say how you confirmed it (e.g. "Brokerage statement shows NASDAQ, USD, issuer X")');
  return updateInstrument(ctx.db, Number(params.id), patch);
});

r('POST', '/api/instruments/:id/symbol-change', (ctx, { params, body }) => changeSymbol(ctx.db, Number(params.id), body.newSymbol, body.effectiveDate, body.note));
r('POST', '/api/instruments/:id/split', (ctx, { params, body }) => ({ added: addSplit(ctx.db, Number(params.id), body.effectiveDate, Number(body.ratioFrom), Number(body.ratioTo), body.note, 'manual') }));

r('GET', '/api/transactions', (ctx, { query }) => ctx.db.prepare(`SELECT t.*, a.name AS account, i.symbol, i.exchange FROM transactions t
   JOIN accounts a ON a.id = t.account_id LEFT JOIN instruments i ON i.id = t.instrument_id
   ${query.instrument_id ? 'WHERE t.instrument_id = ?' : ''} ORDER BY t.trade_date DESC, t.id DESC LIMIT 500`).all(...(query.instrument_id ? [Number(query.instrument_id)] : [])));

r('POST', '/api/transactions', (ctx, { body }) => {
  const t = { ...body, symbol: body.symbol?.trim().toUpperCase(), unconfirmed_fields: body.unconfirmed_fields || [] };
  const res = addTransaction(ctx.db, t, { source: body.source === 'screenshot' ? 'screenshot' : 'manual' });
  return res;
});
r('PATCH', '/api/transactions/:id', (ctx, { params, body }) => editTransaction(ctx.db, Number(params.id), body));
r('POST', '/api/transactions/:id/void', (ctx, { params, body }) => { voidTransaction(ctx.db, Number(params.id), body.reason); return { ok: true }; });

r('POST', '/api/positions/close', (ctx, { body }) => {
  const ledger = deriveLedger(ctx.db).lots.find((l) => l.account_id === Number(body.account_id) && l.instrument_id === Number(body.instrument_id));
  if (!ledger || ledger.shares <= 0) throw new HttpError(400, 'No open position to close');
  const inst = ctx.db.prepare('SELECT * FROM instruments WHERE id = ?').get(Number(body.instrument_id));
  if (!(Number(body.price) > 0)) throw new HttpError(400, 'Enter the actual sale price from your brokerage');
  return addTransaction(ctx.db, {
    account: ledger.account, type: 'SELL', trade_date: body.date || todayIn(NY), symbol: inst.symbol, exchange: inst.exchange, currency: inst.currency,
    quantity: ledger.shares, price: Number(body.price), fees: Number(body.fees || 0), note: body.note || 'Position closed',
  });
});

r('POST', '/api/positions/strategy', (ctx, { body }) => { setStrategy(ctx.db, Number(body.account_id), Number(body.instrument_id), body.strategy, body.thesis); return { ok: true }; });

r('POST', '/api/cash', (ctx, { body }) => { setCash(ctx.db, body); return { cash: latestCash(ctx.db) }; });

// ---------- import ----------

r('GET', '/api/import/template', () => ({ csv: CSV_TEMPLATE }));
r('GET', '/api/import', (ctx) => ctx.db.prepare('SELECT id, filename, status, rows_total, rows_new, rows_duplicate, rows_error, created_at, applied_at FROM import_batches ORDER BY id DESC LIMIT 20').all());
r('POST', '/api/import/preview', (ctx, { body }) => {
  if (!body.text || body.text.length > 5_000_000) throw new HttpError(400, 'CSV text missing or too large');
  return previewImport(ctx.db, { filename: String(body.filename || 'upload.csv').slice(0, 200), text: body.text });
});
r('POST', '/api/import/:id/apply', (ctx, { params }) => applyImport(ctx.db, Number(params.id)));
r('POST', '/api/import/:id/discard', (ctx, { params }) => { discardImport(ctx.db, Number(params.id)); return { ok: true }; });

r('GET', '/api/audit', (ctx, { query }) => ctx.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Number(query.limit) || 100, 1000)));

// ---------- intelligence ----------

r('GET', '/api/news', (ctx, { query }) => {
  const held = new Set(ctx.db.prepare(`SELECT DISTINCT i.symbol FROM instruments i JOIN transactions t ON t.instrument_id = i.id WHERE t.voided_at IS NULL`).all().map((x) => x.symbol));
  const items = listNews(ctx.db, { symbol: query.symbol, since: query.since, limit: Number(query.limit) || 80, minImportance: Number(query.min) || 1 });
  return items.map((n) => ({ ...n, affectsHoldings: n.symbols.filter((s) => held.has(s)) }));
});

r('GET', '/api/events', (ctx, { query }) => {
  const from = query.from || todayIn(NY);
  return ctx.db.prepare('SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 200').all(from).map((e) => ({ ...e, details: e.details_json ? JSON.parse(e.details_json) : null }));
});
r('POST', '/api/events', (ctx, { body }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw new HttpError(400, 'Date must be YYYY-MM-DD');
  if (!String(body.title || '').trim()) throw new HttpError(400, 'Title required');
  ctx.db.prepare(`INSERT INTO events (symbol, type, date, time_hint, title, details_json, source, source_url, fetched_at, first_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(symbol, type, date, source) DO NOTHING`)
    .run(body.symbol ? body.symbol.toUpperCase() : `MACRO-${Date.now()}`, body.type === 'earnings' ? 'earnings' : 'macro', body.date, body.time_hint || 'unknown', body.title.trim(), null, 'Entered manually', body.source_url || null, nowIso(), nowIso());
  return { ok: true };
});
r('DELETE', '/api/events/:id', (ctx, { params }) => { ctx.db.prepare("DELETE FROM events WHERE id = ? AND source = 'Entered manually'").run(Number(params.id)); return { ok: true }; });

// ---------- watchlist ----------

r('GET', '/api/watchlist', (ctx) => {
  const db = ctx.db;
  const held = new Set(db.prepare(`SELECT DISTINCT i.symbol FROM instruments i JOIN transactions t ON t.instrument_id = i.id WHERE t.voided_at IS NULL`).all().map((x) => x.symbol));
  const rows = db.prepare('SELECT * FROM watchlist ORDER BY category, symbol').all();
  const today = todayIn(NY);
  const items = rows.map((w) => {
    const d = ctx.catalog.lookup(w.symbol, w.exchange) || {};
    const inst = db.prepare('SELECT * FROM instruments WHERE symbol = ? AND exchange = ?').get(w.symbol, w.exchange);
    const q = inst ? db.prepare('SELECT * FROM quotes WHERE instrument_id = ?').get(inst.id) : null;
    const events = db.prepare('SELECT date, type, time_hint, source FROM events WHERE symbol = ? AND date >= ? ORDER BY date LIMIT 3').all(w.symbol, today);
    const news = listNews(db, { symbol: w.symbol, limit: 3, minImportance: 2 }).map((n) => ({ title: n.title, url: n.url, published_at: n.published_at, status: n.status, source_name: n.source_name }));
    return {
      symbol: w.symbol, exchange: w.exchange, category: w.category || d.category || 'other', note: w.note, held: held.has(w.symbol),
      name: d.name || null, currency: d.currency || inst?.currency || null,
      oneLiner: d.oneLiner || null, supplyChainRole: d.supplyChainRole || null, aiConnection: d.aiConnection || null,
      relationships: d.relationships || [], risks: d.risks || [], whyAttention: d.whyAttention || null, investigateIf: d.investigateIf || [],
      business: d.business || null, howItMakesMoney: d.howItMakesMoney || null, aiRole: d.aiRole || null,
      sourceUrl: d.sourceUrl || null, lastReviewed: d.lastReviewed || null, verification: d.verification || 'unverified',
      ambiguity: d.ambiguity || null,
      quote: q && q.price != null ? { price: q.price, changePct: q.change_pct, at: q.quote_time, provider: q.provider } : null,
      catalysts: events, news,
    };
  });
  return { categories: CATEGORIES.filter((c) => !c.id.endsWith('_etf')), items };
});
r('POST', '/api/watchlist', (ctx, { body }) => {
  const sym = String(body.symbol || '').trim().toUpperCase();
  if (!sym || !body.exchange) throw new HttpError(400, 'Symbol and exchange are required');
  ctx.db.prepare('INSERT OR IGNORE INTO watchlist (symbol, exchange, category, note, added_at) VALUES (?,?,?,?,?)').run(sym, body.exchange, body.category || null, body.note || null, nowIso());
  audit(ctx.db, 'watchlist', `${sym}|${body.exchange}`, 'add', null, body);
  return { ok: true };
});
r('DELETE', '/api/watchlist', (ctx, { query }) => {
  ctx.db.prepare('DELETE FROM watchlist WHERE symbol = ? AND exchange = ?').run(query.symbol, query.exchange);
  audit(ctx.db, 'watchlist', `${query.symbol}|${query.exchange}`, 'remove', null, null);
  return { ok: true };
});
r('PUT', '/api/descriptions', (ctx, { body }) => ctx.catalog.saveOverride(body.symbol, body.exchange, { ...body, lastReviewed: body.lastReviewed || todayIn(NY), verification: body.verification || 'user-reviewed' }));

// ---------- briefings & alerts ----------

r('GET', '/api/briefings', (ctx, { query }) => searchBriefings(ctx.db, { q: query.q, kind: query.kind, from: query.from, to: query.to, limit: Number(query.limit) || 60 }));
r('GET', '/api/briefings/:id', (ctx, { params }) => {
  const b = ctx.db.prepare('SELECT * FROM briefings WHERE id = ?').get(Number(params.id));
  if (!b) throw new HttpError(404, 'Briefing not found');
  return { ...b, content: b.content_json ? JSON.parse(b.content_json) : null, content_json: undefined, deliveries: ctx.db.prepare("SELECT * FROM deliveries WHERE ref_type = 'briefing' AND ref_id = ? ORDER BY id").all(b.id) };
});
r('POST', '/api/briefings/run', async (ctx, { body }) => {
  const kind = KINDS[body.kind] ? body.kind : 'manual';
  return produceBriefing(ctx, { kind: kind === 'manual' ? 'manual' : kind, tradingDate: todayIn(NY), deliverIt: body.deliver === true });
});

r('GET', '/api/alerts', (ctx) => ({
  alerts: ctx.db.prepare('SELECT * FROM alerts ORDER BY triggered_at DESC LIMIT 100').all(),
  rules: ctx.db.prepare('SELECT r.*, i.symbol FROM alert_rules r LEFT JOIN instruments i ON i.id = r.instrument_id ORDER BY r.id').all(),
  settings: alertSettings(ctx.db), types: ALERT_TYPES,
}));
r('POST', '/api/alerts/:id/ack', (ctx, { params }) => { ctx.db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(Number(params.id)); return { ok: true }; });
r('POST', '/api/alert-rules', (ctx, { body }) => {
  if (!['price_above', 'price_below'].includes(body.type)) throw new HttpError(400, 'Custom rules support price_above and price_below; other thresholds are set in alert settings');
  if (!(Number(body.price) > 0)) throw new HttpError(400, 'Price must be positive');
  ctx.db.prepare('INSERT INTO alert_rules (type, instrument_id, params_json, enabled, created_at) VALUES (?,?,?,1,?)').run(body.type, Number(body.instrument_id), JSON.stringify({ price: Number(body.price) }), nowIso());
  return { ok: true };
});
r('DELETE', '/api/alert-rules/:id', (ctx, { params }) => { ctx.db.prepare('DELETE FROM alert_rules WHERE id = ?').run(Number(params.id)); return { ok: true }; });

r('GET', '/api/deliveries', (ctx) => ctx.db.prepare('SELECT * FROM deliveries ORDER BY id DESC LIMIT 50').all());
r('POST', '/api/delivery/test', async (ctx, { body }) => {
  const ch = ['email', 'ntfy', 'in_app'].includes(body.channel) ? body.channel : 'in_app';
  return deliver(ctx, { refType: 'test', refId: null, title: 'Signal Desk test message', text: `Delivery test sent ${nowIso()}. If you can read this, ${ch} delivery works.`, channels: [ch] });
});

// ---------- settings ----------

r('GET', '/api/settings', (ctx) => {
  const out = {};
  for (const [k, d] of Object.entries(SETTING_KEYS)) out[k] = getSetting(ctx.db, k, d);
  return { settings: out, riskQuestions: RISK_QUESTIONS, config: publicConfigStatus(ctx.cfg) };
});
r('PUT', '/api/settings/:key', (ctx, { params, body }) => {
  if (!(params.key in SETTING_KEYS)) throw new HttpError(400, 'Unknown setting');
  if (params.key === 'delivery') {
    for (const list of [body.briefings, body.alerts]) if (!Array.isArray(list) || list.some((c) => !['in_app', 'email', 'ntfy'].includes(c))) throw new HttpError(400, 'Channels must be in_app, email or ntfy');
  }
  if (params.key === 'riskProfile') {
    for (const k of ['maxLossPerTradePct', 'maxPortfolioDrawdownPct']) {
      if (body[k] !== '' && body[k] != null && !(Number(body[k]) > 0 && Number(body[k]) <= 100)) throw new HttpError(400, `${k} must be a percentage between 0 and 100`);
    }
  }
  setSetting(ctx.db, params.key, body);
  if (params.key === 'providers') ctx.rebuildProviders();
  return { ok: true };
});

// ---------- data refresh & provider tests ----------

r('POST', '/api/refresh', async (ctx, { body }) => {
  const what = body.what || 'quotes';
  const out = {};
  if (what === 'fx' || what === 'all') out.fx = await refreshFx(ctx);
  if (what === 'quotes' || what === 'all') out.quotes = await refreshQuotes(ctx);
  if (what === 'bars' || what === 'all') out.bars = await refreshDailyBars(ctx);
  if (what === 'intraday') out.intraday = await refreshIntraday(ctx);
  if (what === 'earnings' || what === 'all') out.earnings = await refreshEarnings(ctx);
  if (what === 'splits') out.splits = await checkSplits(ctx);
  if (what === 'news' || what === 'all') out.news = await ingestNews(ctx);
  if (what === 'assess' || what === 'all' || what === 'quotes') out.assessments = runAssessments(ctx, computePortfolio(ctx.db, { catalog: ctx.catalog })).length;
  return out;
});

r('POST', '/api/providers/test', async (ctx) => {
  const results = [];
  const p = ctx.providers;
  const test = async (name, fn) => {
    const t0 = Date.now();
    try { results.push({ name, ok: true, detail: await fn(), ms: Date.now() - t0 }); } catch (e) { results.push({ name, ok: false, detail: e.message, kind: e.kind, ms: Date.now() - t0 }); }
  };
  if (p.market) {
    const probe = ctx.db.prepare("SELECT * FROM instruments WHERE identity_status = 'confirmed' LIMIT 1").get() || { id: 0, symbol: 'SPY', exchange: 'NYSE Arca', currency: 'USD' };
    await test(`${p.market.name} quote (${probe.symbol})`, async () => {
      const [res] = await p.market.getQuotes([probe]);
      if (!res.ok) throw res.error;
      return `${probe.symbol} ${res.quote.price} ${probe.currency} at ${res.quote.quote_time} (${res.quote.timeliness})`;
    });
  } else results.push({ name: 'Market data', ok: false, detail: 'No market-data provider configured (MARKET_DATA_PROVIDER in .env)' });
  if (p.fx) await test('Bank of Canada USD/CAD', async () => { const r2 = await p.fx.getUsdCad(); return `${r2.rate} for ${r2.as_of}`; });
  if (p.finnhub) await test('Finnhub news', async () => `${(await p.finnhub.getNews('AAPL', addDays(todayIn(NY), -2), todayIn(NY))).length} recent items for AAPL`);
  if (p.sec) await test('SEC EDGAR filings', async () => `${(await p.sec.getFilings('AAPL', addDays(todayIn(NY), -60))).length} filings for AAPL in 60 days`);
  results.push({ name: 'AI analyst (Anthropic)', ok: analystAvailable(ctx), detail: analystAvailable(ctx) ? `Configured (${ctx.cfg.anthropicModel}); used during briefings` : 'Not configured (optional)' });
  return results;
});

// ---------- backups & logs ----------

r('GET', '/api/backups', (ctx) => listBackups(ctx.cfg).filter((b) => b.name.includes(`-${ctx.mode}-`)));
r('POST', '/api/backups', (ctx) => createBackup(ctx, { reason: 'manual' }));
r('POST', '/api/backups/restore', (ctx, { body }) => restoreBackup(ctx, safeBackupPath(ctx.cfg, body.name), dbFileFor(ctx.cfg, ctx.mode)));
r('POST', '/api/backups/upload', (ctx, { body }) => {
  if (!body.dataBase64) throw new HttpError(400, 'No file');
  const buf = Buffer.from(body.dataBase64, 'base64');
  if (buf.length > 200 * 1024 * 1024) throw new HttpError(400, 'File too large');
  const tmp = path.join(backupDir(ctx.cfg), `uploaded-${Date.now()}.sqlite`);
  fs.writeFileSync(tmp, buf);
  try {
    validateBackupFile(tmp);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(400, e.message);
  }
  if (body.restore) return restoreBackup(ctx, tmp, dbFileFor(ctx.cfg, ctx.mode));
  return { saved: path.basename(tmp) };
});

r('GET', '/api/logs', (ctx, { query }) => log.recent(Math.min(Number(query.n) || 100, 300)));

r('GET', '/api/export', (ctx) => ({
  exportedAt: nowIso(), workspace: ctx.mode,
  accounts: ctx.db.prepare('SELECT * FROM accounts').all(),
  instruments: ctx.db.prepare('SELECT * FROM instruments').all(),
  transactions: ctx.db.prepare('SELECT * FROM transactions').all(),
  corporateActions: ctx.db.prepare('SELECT * FROM corporate_actions').all(),
  symbolHistory: ctx.db.prepare('SELECT * FROM symbol_history').all(),
  cashBalances: ctx.db.prepare('SELECT * FROM cash_balances').all(),
  positionMeta: ctx.db.prepare('SELECT * FROM position_meta').all(),
  watchlist: ctx.db.prepare('SELECT * FROM watchlist').all(),
  descriptions: ctx.db.prepare('SELECT * FROM descriptions').all(),
  settings: ctx.db.prepare('SELECT * FROM settings').all(),
}));

// ---------- Ask Signal Desk (chat agent) ----------

import { createBackend, chatConfig, spentToday, priceFor } from './agent/backend.js';
import { createConversation, listConversations, getConversation, deleteConversation, runChatTurn, isConversationBusy } from './agent/agent.js';
import { confirmProposal, rejectProposal } from './agent/proposals.js';
import { suggestQuestions } from './agent/suggestions.js';

export const CHAT_DISCLOSURE = [
  'Your question and the short text of earlier questions/answers in the same conversation.',
  'The results of the tools the model chooses to call for that question, which can include: holdings (tickers, shares, average cost, cost basis, market value, P/L, weights), account names, available cash, trade history and notes, your strategy/thesis text, saved assessments and briefings, stored quotes, price history, news and filings, and company profiles.',
  'Not sent: API keys or passwords, email/delivery settings, backups, log files, or anything from other conversations.',
  'The model provider (Anthropic, under the API key you configure) processes this data to generate the answer; see Anthropic\'s commercial terms and privacy policy for retention. Signal Desk stores conversations only in your local database.',
];

function backendFor(ctx) {
  ctx.chatBackend ||= createBackend(ctx.cfg);
  return ctx.chatBackend;
}

r('GET', '/api/chat/status', (ctx) => {
  const b = backendFor(ctx);
  const cc = chatConfig(ctx.cfg);
  return {
    available: !!b.available, reason: b.available ? null : b.reason, backend: b.name, model: b.model || cc.model, effort: cc.effort,
    dailyBudgetUsd: cc.dailyBudgetUsd, spentTodayUsd: Math.round(spentToday(ctx.cfg).usd * 10000) / 10000, spendSharedAcrossWorkspaces: true,
    pricingPerMillionTokens: (() => { const p = priceFor(cc.model, cc.priceOverride); return p ? { input: p[0], output: p[1], cacheRead: p[2], fromEnv: !priceFor(cc.model) } : null; })(),
    disclosure: CHAT_DISCLOSURE, workspace: ctx.mode,
  };
});
r('GET', '/api/chat/suggestions', (ctx, { query }) => suggestQuestions(ctx, { page: query.page, symbol: query.symbol }));
r('GET', '/api/chat/conversations', (ctx) => listConversations(ctx.db));
r('POST', '/api/chat/conversations', (ctx, { body }) => ({ id: createConversation(ctx.db, body.title || 'New conversation') }));
r('GET', '/api/chat/conversations/:id', (ctx, { params }) => {
  const c = getConversation(ctx.db, Number(params.id));
  if (!c) throw new HttpError(404, 'Conversation not found');
  return c;
});
r('DELETE', '/api/chat/conversations/:id', (ctx, { params }) => {
  if (isConversationBusy(ctx, params.id)) throw new HttpError(409, 'This conversation is still answering a question. Delete it when the answer arrives.');
  if (!deleteConversation(ctx.db, Number(params.id))) throw new HttpError(404, 'Conversation not found');
  audit(ctx.db, 'chat_conversation', params.id, 'delete', null, null);
  return { ok: true };
});
r('POST', '/api/chat/conversations/:id/messages', (ctx, { params, body }) => {
  const conversationId = Number(params.id);
  if (!ctx.db.prepare('SELECT 1 FROM chat_conversations WHERE id = ?').get(conversationId)) throw new HttpError(404, 'Conversation not found');
  if (isConversationBusy(ctx, conversationId)) throw new HttpError(409, 'This conversation is still answering the previous question.');
  if (!String(body.text || '').trim()) throw new HttpError(400, 'Ask a question');
  const pageContext = body.pageContext && typeof body.pageContext === 'object'
    ? { page: String(body.pageContext.page || '').slice(0, 40) || null, symbol: body.pageContext.symbol ? String(body.pageContext.symbol).toUpperCase().slice(0, 15) : null }
    : null;
  return {
    __stream: (emit, signal) => runChatTurn(ctx, { conversationId, userText: body.text, pageContext, backend: backendFor(ctx), onEvent: emit, signal }),
  };
});
// The conversation id ties a confirmation to the panel that showed the proposal.
const proposalConv = (body) => {
  const id = Number(body?.conversationId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'conversationId is required');
  return id;
};
r('POST', '/api/chat/proposals/:id/confirm', (ctx, { params, body }) => confirmProposal(ctx, Number(params.id), { conversationId: proposalConv(body) }));
r('POST', '/api/chat/proposals/:id/reject', (ctx, { params, body }) => rejectProposal(ctx, Number(params.id), { conversationId: proposalConv(body) }));

// ---------- Strategy Lab (simulation only; server/strategy/api.js) ----------

import { registerLabRoutes } from './strategy/api.js';
registerLabRoutes(r, HttpError);
