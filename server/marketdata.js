// Market-data service: chooses providers, refreshes quotes/bars/FX/earnings
// and stores them. A failed refresh never overwrites the last valid value;
// it records the error next to it so the UI can label the quote as stale.
import { createTwelveData } from './providers/twelvedata.js';
import { createFinnhub } from './providers/finnhub.js';
import { createSec } from './providers/sec.js';
import { createBankOfCanada } from './providers/boc.js';
import { createDemoProvider } from './providers/demo.js';
import { getSetting, setSetting, nowIso } from './db.js';
import { log } from './log.js';
import { todayIn, addDays, NY } from './time.js';
import { exchangeGroup } from './calendar.js';

export const DEFAULT_PROVIDER_SETTINGS = {
  twelvedata: { perMinute: 8, perDay: 800, delayMinutesUS: 15, delayMinutesCA: 15, extendedHours: false },
  finnhub: { perMinute: 55, delayMinutesUS: 0 },
};

export function buildProviders(ctx) {
  const { cfg, db, mode } = ctx;
  if (mode === 'demo') return { market: createDemoProvider(), news: [], fx: null, earnings: null };
  const ps = getSetting(db, 'providers', DEFAULT_PROVIDER_SETTINGS);
  const fetchImpl = ctx.fetchImpl;
  const td = cfg.secrets.TWELVEDATA_API_KEY ? createTwelveData({ apiKey: cfg.secrets.TWELVEDATA_API_KEY, plan: ps.twelvedata, fetchImpl }) : null;
  const fh = cfg.secrets.FINNHUB_API_KEY ? createFinnhub({ apiKey: cfg.secrets.FINNHUB_API_KEY, plan: ps.finnhub, fetchImpl }) : null;
  const sec = cfg.secContactEmail ? createSec({ contactEmail: cfg.secContactEmail, fetchImpl }) : null;
  let market = null;
  if (cfg.marketProvider === 'twelvedata') market = td;
  else if (cfg.marketProvider === 'finnhub') market = fh;
  return {
    market,
    news: [fh, sec].filter(Boolean),
    fx: createBankOfCanada({ fetchImpl }),
    earnings: td || fh,
    finnhub: fh,
    sec,
  };
}

const status = new Map(); // per-context provider status for the UI

export function providerStatus(ctx) {
  return status.get(ctx.mode) || {};
}

function setStatus(ctx, key, value) {
  const s = status.get(ctx.mode) || {};
  s[key] = { ...value, at: nowIso() };
  status.set(ctx.mode, s);
}

export function heldInstruments(db) {
  return db.prepare(`SELECT DISTINCT i.* FROM instruments i JOIN transactions t ON t.instrument_id = i.id WHERE t.voided_at IS NULL`).all();
}

export function trackedInstruments(db) {
  // Held instruments plus watchlist entries that have an instrument row.
  return db.prepare(`SELECT DISTINCT i.* FROM instruments i
    LEFT JOIN transactions t ON t.instrument_id = i.id AND t.voided_at IS NULL
    LEFT JOIN watchlist w ON w.symbol = i.symbol AND w.exchange = i.exchange
    WHERE t.id IS NOT NULL OR w.symbol IS NOT NULL`).all();
}

export function storeQuote(db, instrumentId, q) {
  db.prepare(`INSERT INTO quotes (instrument_id, provider, price, prev_close, change, change_pct, open, high, low, volume, avg_volume,
      ext_price, ext_change_pct, ext_session, ext_time, session, quote_time, fetched_at, timeliness, delay_minutes, last_error, last_error_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)
    ON CONFLICT(instrument_id) DO UPDATE SET provider=excluded.provider, price=excluded.price, prev_close=excluded.prev_close,
      change=excluded.change, change_pct=excluded.change_pct, open=excluded.open, high=excluded.high, low=excluded.low,
      volume=excluded.volume, avg_volume=excluded.avg_volume, ext_price=excluded.ext_price, ext_change_pct=excluded.ext_change_pct,
      ext_session=excluded.ext_session, ext_time=excluded.ext_time, session=excluded.session, quote_time=excluded.quote_time,
      fetched_at=excluded.fetched_at, timeliness=excluded.timeliness, delay_minutes=excluded.delay_minutes,
      last_error=NULL, last_error_at=NULL`).run(
    instrumentId, q.provider, q.price, q.prev_close ?? null, q.change ?? null, q.change_pct ?? null,
    q.open ?? null, q.high ?? null, q.low ?? null, q.volume ?? null, q.avg_volume ?? null,
    q.ext_price ?? null, q.ext_change_pct ?? null, q.ext_session ?? null, q.ext_time ?? null,
    q.session ?? null, q.quote_time ?? null, nowIso(), q.timeliness ?? null, q.delay_minutes ?? null);
}

export function storeQuoteError(db, instrumentId, providerName, message) {
  const r = db.prepare('UPDATE quotes SET last_error = ?, last_error_at = ? WHERE instrument_id = ?').run(message, nowIso(), instrumentId);
  if (!r.changes) {
    db.prepare(`INSERT INTO quotes (instrument_id, provider, price, fetched_at, last_error, last_error_at) VALUES (?,?,NULL,?,?,?)`)
      .run(instrumentId, providerName, nowIso(), message, nowIso());
  }
}

export async function refreshQuotes(ctx, { now = new Date(), instruments } = {}) {
  const { db } = ctx;
  const p = ctx.providers.market;
  const list = instruments || trackedInstruments(db);
  if (!p) {
    setStatus(ctx, 'quotes', { ok: false, message: 'No market-data provider configured' });
    return { ok: 0, failed: [], skipped: list.length, message: 'No market-data provider configured' };
  }
  // Instruments whose identity is unconfirmed are not priced: a wrong mapping
  // would show a confident but wrong number.
  const priced = list.filter((i) => i.identity_status === 'confirmed');
  const unconfirmed = list.filter((i) => i.identity_status !== 'confirmed');
  const results = await p.getQuotes(priced, now);
  let ok = 0;
  const failed = [];
  for (const r of results) {
    const inst = priced.find((i) => i.id === r.instrument_id);
    if (r.ok) {
      const prev = db.prepare('SELECT price FROM quotes WHERE instrument_id = ?').get(r.instrument_id);
      if (prev?.price && r.quote.price && Math.abs(r.quote.price / prev.price - 1) > 0.6) {
        log.warn('quotes', `${inst.symbol}: price moved >60% vs last stored value; check for a split or symbol change`);
      }
      storeQuote(db, r.instrument_id, r.quote);
      ok += 1;
    } else {
      storeQuoteError(db, r.instrument_id, p.name, r.error.message);
      failed.push({ symbol: inst.symbol, exchange: inst.exchange, kind: r.error.kind, message: r.error.message });
    }
  }
  // Instruments skipped after an auth failure.
  for (const inst of priced) {
    if (!results.find((r) => r.instrument_id === inst.id)) {
      storeQuoteError(db, inst.id, p.name, 'Not refreshed: provider rejected the request');
      failed.push({ symbol: inst.symbol, exchange: inst.exchange, kind: 'skipped', message: 'Not refreshed after an earlier provider error' });
    }
  }
  for (const inst of unconfirmed) {
    storeQuoteError(db, inst.id, p.name, 'Instrument identity not confirmed; not priced');
  }
  const message = `${ok} updated, ${failed.length} failed${unconfirmed.length ? `, ${unconfirmed.length} awaiting identity confirmation` : ''}`;
  setStatus(ctx, 'quotes', { ok: failed.length === 0, message, provider: p.name, usage: p.usage?.() });
  if (failed.length) log.warn('quotes', message, failed.map((f) => `${f.symbol}: ${f.message}`));
  return { ok, failed, unconfirmed: unconfirmed.map((i) => i.symbol), message };
}

export async function refreshFx(ctx) {
  const fx = ctx.providers.fx;
  if (!fx) return null;
  try {
    // Every observation returned is stored (upsert by date), not just the
    // latest, so a business day missed while the app was off leaves no gap.
    const rows = fx.getUsdCadRecent ? await fx.getUsdCadRecent() : [await fx.getUsdCad()];
    const st = ctx.db.prepare('INSERT OR REPLACE INTO fx_rates (pair, rate, as_of, source, fetched_at) VALUES (?,?,?,?,?)');
    for (const x of rows) st.run(x.pair, x.rate, x.as_of, x.source, nowIso());
    const r = rows.at(-1);
    setStatus(ctx, 'fx', { ok: true, message: `USD/CAD ${r.rate} (${r.source}, ${r.as_of})` });
    return r;
  } catch (e) {
    setStatus(ctx, 'fx', { ok: false, message: e.message });
    log.warn('fx', e.message);
    return null;
  }
}

export function storeBars(db, instrumentId, interval, bars, provider) {
  const st = db.prepare(`INSERT OR REPLACE INTO bars (instrument_id, interval, ts, o, h, l, c, v, session, provider) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const b of bars) st.run(instrumentId, interval, b.ts, b.o, b.h, b.l, b.c, b.v, b.session || null, provider);
}

export async function refreshDailyBars(ctx, { instruments, force = false } = {}) {
  const p = ctx.providers.market;
  if (!p?.capabilities.dailyBars) return { ok: 0, message: 'Provider does not supply daily history' };
  const list = (instruments || trackedInstruments(ctx.db)).filter((i) => i.identity_status === 'confirmed');
  let ok = 0;
  const failed = [];
  for (const inst of list) {
    const last = ctx.db.prepare("SELECT MAX(ts) ts FROM bars WHERE instrument_id = ? AND interval = '1day'").get(inst.id)?.ts;
    if (!force && last && last >= addDays(todayIn(NY), -1)) continue;
    try {
      const bars = await p.getDailyBars(inst, last ? 30 : 260);
      storeBars(ctx.db, inst.id, '1day', bars, p.name);
      ok += 1;
    } catch (e) {
      failed.push({ symbol: inst.symbol, message: e.message });
      if (e.kind === 'auth' || e.kind === 'rate_limit') break;
    }
  }
  setStatus(ctx, 'dailyBars', { ok: !failed.length, message: `${ok} refreshed, ${failed.length} failed` });
  return { ok, failed };
}

export async function refreshIntraday(ctx, { date = todayIn(NY), instruments } = {}) {
  const p = ctx.providers.market;
  if (!p?.capabilities.intradayBars) return { ok: 0, unsupported: true };
  const list = (instruments || ctx.db.prepare(`SELECT DISTINCT i.* FROM instruments i JOIN transactions t ON t.instrument_id = i.id WHERE t.voided_at IS NULL`).all())
    .filter((i) => i.identity_status === 'confirmed');
  let ok = 0;
  const failed = [];
  for (const inst of list) {
    try {
      const bars = await p.getIntradayBars(inst, date, '5min');
      storeBars(ctx.db, inst.id, '5min', bars, p.name);
      ok += 1;
    } catch (e) {
      failed.push({ symbol: inst.symbol, message: e.message });
      if (e.kind === 'auth' || e.kind === 'rate_limit') break;
    }
  }
  setStatus(ctx, 'intraday', { ok: !failed.length, message: `${ok} refreshed, ${failed.length} failed` });
  return { ok, failed };
}

export async function refreshEarnings(ctx, { days = 60, lookbackDays = 10, symbols: only } = {}) {
  const p = ctx.providers.earnings;
  if (!p) return { ok: 0, message: 'No earnings source configured' };
  // Holdings plus watchlist names, so research questions have dates too. Each
  // is a listing (symbol + exchange): the same ticker on another exchange can
  // be a different company.
  const held = trackedInstruments(ctx.db).filter((i) => i.identity_status === 'confirmed');
  const watch = ctx.db.prepare(`SELECT w.symbol, w.exchange, i.id, i.provider_symbol FROM watchlist w
    LEFT JOIN instruments i ON i.symbol = w.symbol AND i.exchange = w.exchange`).all();
  // Calendars match a ticker by market (US or Canada), so two US exchange names for
  // one ticker are one listing: the first (held before watched, or one with a record).
  const listings = new Map();
  for (const i of [...held, ...watch]) {
    const k = `${i.symbol}|${exchangeGroup(i.exchange)}`;
    if (!listings.has(k) || (listings.get(k).id == null && i.id != null)) listings.set(k, { id: i.id ?? null, symbol: i.symbol, exchange: i.exchange, provider_symbol: i.provider_symbol ?? null });
  }
  let instruments = [...listings.values()];
  // A named ticker that is neither held nor watched is checked as a US listing.
  if (only?.length) instruments = instruments.filter((i) => only.includes(i.symbol)).concat(only.filter((s) => !instruments.some((i) => i.symbol === s)).map((s) => ({ id: null, symbol: s, exchange: null, provider_symbol: null })));
  if (!instruments.length) return { ok: 0 };
  const symbols = [...new Set(instruments.map((i) => i.symbol))];
  const today = todayIn(NY);
  const from = addDays(today, -lookbackDays);
  const to = addDays(today, days);
  try {
    // Providers return { events, notCovered } (listings they cannot check); a plain list is events only.
    const res = await p.getEarnings(instruments, from, to);
    const { events: found, notCovered = [] } = Array.isArray(res) ? { events: res } : res;
    // Events are linked to the listing they were matched to, not to any instrument with that ticker.
    const idFor = (e) => e.instrument_id ?? instruments.find((i) => i.id != null && i.symbol === e.symbol && (!e.exchange || exchangeGroup(i.exchange) === exchangeGroup(e.exchange)))?.id ?? null;
    // The events table keeps one row per ticker, date and source: when two listings of a ticker
    // report the same date, the first listing asked about keeps it, so the row's history does
    // not flip between them on every refresh.
    const rank = (e) => { const n = instruments.findIndex((i) => i.id != null && i.id === idFor(e)); return n < 0 ? instruments.length : n; };
    const byKey = new Map();
    for (const e of found) {
      const k = `${e.symbol}|${e.date}|${e.source}`;
      if (!byKey.has(k) || rank(e) < rank(byKey.get(k))) byKey.set(k, e);
    }
    const list = [...byKey.values()];
    // A listing without an instrument record does not unlink a row from one in the same market.
    const exchangeOf = new Map(ctx.db.prepare('SELECT id, exchange FROM instruments').all().map((i) => [i.id, i.exchange]));
    const linkFor = (e, row) => idFor(e) ?? (exchangeOf.has(row.instrument_id) && exchangeGroup(exchangeOf.get(row.instrument_id)) === exchangeGroup(e.exchange) ? row.instrument_id : null);
    const now = nowIso();
    const existing = ctx.db.prepare("SELECT * FROM events WHERE type = 'earnings' AND symbol = ? AND date = ? AND source = ?");
    const insert = ctx.db.prepare(`INSERT INTO events (instrument_id, symbol, type, date, time_hint, title, details_json, source, fetched_at, first_seen_at)
      VALUES (?, ?, 'earnings', ?, ?, ?, ?, ?, ?, ?)`);
    const update = ctx.db.prepare('UPDATE events SET instrument_id = ?, time_hint = ?, details_json = ?, fetched_at = ? WHERE id = ?');
    for (const e of list) {
      const row = existing.get(e.symbol, e.date, e.source);
      const details = { ...(e.details || {}) };
      if (!row) { insert.run(idFor(e), e.symbol, e.date, e.time_hint, `${e.symbol} earnings`, JSON.stringify(details), e.source, now, now); continue; }
      // Keep a history of changes to timing and estimates so "what changed" can report them.
      const old = row.details_json ? JSON.parse(row.details_json) : {};
      const changes = [...(old.changes || [])];
      if ((row.time_hint || null) !== (e.time_hint || null)) changes.push({ field: 'timing', from: row.time_hint, to: e.time_hint, at: now });
      for (const k of ['epsEstimate', 'revenueEstimate', 'epsActual', 'revenueActual']) {
        if (details[k] != null && old[k] !== details[k]) changes.push({ field: k, from: old[k] ?? null, to: details[k], at: now });
      }
      update.run(linkFor(e, row), e.time_hint, JSON.stringify({ ...details, ...(old.previousDate ? { previousDate: old.previousDate, dateChangedAt: old.dateChangedAt } : {}), ...(changes.length ? { changes: changes.slice(-10) } : {}) }), now, row.id);
    }
    // Future dates from this source that the provider no longer lists were superseded (a moved
    // date): the new date of the same listing remembers the old one. The same drops dates stored
    // for a listing that is not covered (an earlier bare-ticker match), unless a covered listing
    // still returns them.
    const returned = new Set(list.map((e) => `${e.symbol}|${e.date}`));
    const sources = [...new Set(list.map((e) => e.source))];
    const sameListing = (e, row) => row.instrument_id == null || idFor(e) == null || idFor(e) === row.instrument_id;
    for (const src of sources) {
      for (const row of ctx.db.prepare("SELECT id, symbol, instrument_id, date FROM events WHERE type = 'earnings' AND source = ? AND date >= ? AND date <= ?").all(src, today, to)) {
        if (!symbols.includes(row.symbol) || returned.has(`${row.symbol}|${row.date}`)) continue;
        const moved = list.filter((e) => e.symbol === row.symbol && e.source === src && sameListing(e, row)).sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(row.date)) - Math.abs(Date.parse(b.date) - Date.parse(row.date)))[0];
        if (moved) {
          const target = existing.get(moved.symbol, moved.date, src);
          const det = target?.details_json ? JSON.parse(target.details_json) : {};
          if (target) ctx.db.prepare('UPDATE events SET details_json = ? WHERE id = ?').run(JSON.stringify({ ...det, previousDate: row.date, dateChangedAt: now }), target.id);
        }
        ctx.db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
      }
    }
    // A listing the provider cannot check keeps no future date from it, even when nothing else
    // came back from the provider.
    const providerSources = [...new Set([`${p.name} earnings calendar`, ...sources])];
    for (const n of notCovered) {
      const id = instruments.find((i) => i.symbol === n.symbol && i.exchange === n.exchange)?.id ?? null;
      for (const row of ctx.db.prepare(`SELECT id, symbol, instrument_id, date FROM events WHERE type = 'earnings' AND symbol = ? AND date >= ? AND source IN (${providerSources.map(() => '?').join(',')})`).all(n.symbol, today, ...providerSources)) {
        if (!returned.has(`${row.symbol}|${row.date}`) && (row.instrument_id == null || row.instrument_id === id)) ctx.db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
      }
    }
    // Coverage is kept per ticker, so checking one ticker leaves the others' record intact.
    const prev = getSetting(ctx.db, 'earningsCoverage', null);
    const bySymbol = only?.length && prev?.bySymbol ? { ...prev.bySymbol } : {};
    const uncovered = only?.length && prev?.notCovered ? { ...prev.notCovered } : {};
    // A ticker counts as checked only when every listing of it asked about was covered;
    // otherwise get_events must not read "no date" into the silence.
    const missed = new Map(notCovered.map((n) => [n.symbol, n]));
    for (const s of symbols) {
      if (missed.has(s)) { delete bySymbol[s]; uncovered[s] = { exchange: missed.get(s).exchange, reason: missed.get(s).reason, at: now }; }
      else { bySymbol[s] = { at: now, from, to }; delete uncovered[s]; }
    }
    setSetting(ctx.db, 'earningsCoverage', { symbols: Object.keys(bySymbol), bySymbol, notCovered: uncovered, from, to, at: now, source: p.name });
    const checked = symbols.filter((s) => !missed.has(s)).length;
    setStatus(ctx, 'earnings', { ok: true, message: `${list.length} earnings dates for ${checked} symbols${missed.size ? `; not covered: ${[...missed.keys()].join(', ')}` : ''}` });
    return { ok: list.length, symbols: checked, notCovered };
  } catch (e) {
    setStatus(ctx, 'earnings', { ok: false, message: e.message });
    return { ok: 0, error: e.message };
  }
}

// Splits reported by the provider are stored as events for the user to review;
// they are not applied to the ledger automatically.
export async function checkSplits(ctx) {
  const p = ctx.providers.market;
  if (!p?.capabilities.splits) return { checked: 0 };
  const held = heldInstruments(ctx.db).filter((i) => i.identity_status === 'confirmed');
  let found = 0;
  for (const inst of held) {
    const first = ctx.db.prepare('SELECT MIN(trade_date) d FROM transactions WHERE instrument_id = ? AND voided_at IS NULL').get(inst.id).d;
    try {
      for (const s of await p.getSplits(inst)) {
        if (s.date < first) continue;
        const applied = ctx.db.prepare("SELECT 1 FROM corporate_actions WHERE instrument_id = ? AND type = 'SPLIT' AND effective_date = ?").get(inst.id, s.date);
        if (applied) continue;
        ctx.db.prepare(`INSERT OR IGNORE INTO events (instrument_id, symbol, type, date, title, details_json, source, fetched_at, first_seen_at)
          VALUES (?, ?, 'split', ?, ?, ?, ?, ?, ?)`).run(inst.id, inst.symbol, s.date, `${inst.symbol} split ${s.from}:${s.to} — review`, JSON.stringify(s), p.name, nowIso(), nowIso());
        found += 1;
      }
    } catch (e) {
      if (e.kind === 'auth' || e.kind === 'rate_limit') break;
    }
  }
  return { checked: held.length, found };
}
