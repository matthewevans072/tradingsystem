// Security descriptions ("what does it actually do?") and the AI-infrastructure
// research universe. Base data comes from server/catalog/securities.json
// (sourced from official company/fund pages, with source URL and review date);
// user-reviewed edits are stored in the database and take precedence.
//
// A description is attached only on an exact symbol + exchange match, so a
// ticker that exists on two exchanges never borrows the wrong company's text.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { nowIso, audit } from './db.js';

export const CATEGORIES = [
  { id: 'compute', label: 'Compute & chip design' },
  { id: 'semi_mfg', label: 'Semiconductor manufacturing & equipment' },
  { id: 'memory', label: 'Memory & storage' },
  { id: 'networking', label: 'Networking' },
  { id: 'datacenter', label: 'Data centers & AI cloud' },
  { id: 'cooling_electrical', label: 'Cooling & electrical equipment' },
  { id: 'power_grid', label: 'Electricity generation & grid' },
  { id: 'robotics', label: 'Robotics & industrial components' },
  { id: 'materials', label: 'Critical materials' },
  { id: 'broad_etf', label: 'Broad-market ETFs' },
  { id: 'thematic_etf', label: 'Sector & thematic ETFs' },
];

// Exchanges that are interchangeable for matching US listings in the catalog.
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'NYSE Arca', 'NYSE American', 'Cboe BZX']);

export function loadCatalogFile(file = path.join(ROOT, 'server', 'catalog', 'securities.json')) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(d.securities) ? d.securities : [];
  } catch {
    return [];
  }
}

// Tickers whose identity must be confirmed from the brokerage record before
// any description or price feed is attached.
export const ALWAYS_CONFIRM = new Set(['SPCX']);

export function createCatalog(db, entries = loadCatalogFile()) {
  const base = entries.map((e) => ({
    ...e,
    symbol: String(e.symbol).toUpperCase(),
    requiresConfirmation: ALWAYS_CONFIRM.has(String(e.symbol).toUpperCase()) || /identity not confirmed/i.test(e.oneLiner || ''),
  }));

  function overrides() {
    return new Map(db.prepare('SELECT * FROM descriptions').all().map((r) => [`${r.symbol}|${r.exchange}`, JSON.parse(r.data_json)]));
  }

  function exchangeMatches(a, b) {
    if (a === b) return true;
    // A catalog entry for "NASDAQ" also matches a holding recorded on "NASDAQ";
    // US listings of the same ticker are unique across US venues.
    return US_EXCHANGES.has(a) && US_EXCHANGES.has(b);
  }

  // For holdings, pass the instrument so ambiguous tickers only get a
  // description after the user has confirmed exactly which security it is.
  function describeInstrument(inst) {
    const d = lookup(inst.symbol, inst.exchange);
    const confirmed = inst.identity_status === 'confirmed';
    if (!d) {
      return { oneLiner: null, missing: true, otherListings: otherListings(inst.symbol, inst.exchange) };
    }
    if ((d.ambiguity || d.requiresConfirmation || ALWAYS_CONFIRM.has(inst.symbol)) && !confirmed) {
      return {
        oneLiner: 'Identity not confirmed — check brokerage record before relying on any description.',
        identityWarning: true, ambiguity: d.ambiguity || null, candidate: { name: d.name, exchange: d.exchange, sourceUrl: d.sourceUrl },
      };
    }
    if (d.currency && inst.currency && d.currency !== inst.currency && !d.userEdited) {
      return { oneLiner: `Catalog lists ${d.symbol} on ${d.exchange} in ${d.currency}, but this holding is in ${inst.currency}. Confirm the instrument.`, identityWarning: true };
    }
    return d;
  }

  function lookup(symbol, exchange) {
    const sym = String(symbol).toUpperCase();
    const ov = overrides();
    const own = [...ov.entries()].find(([k]) => {
      const [s, ex] = k.split('|');
      return s === sym && exchangeMatches(ex, exchange);
    });
    const b = base.find((e) => e.symbol === sym && exchangeMatches(e.exchange, exchange));
    if (!b && !own) return null;
    const merged = { ...(b || {}), ...(own ? { ...own[1], userEdited: true } : {}) };
    // Ambiguous identities (e.g. SPCX) never auto-attach a company description.
    if (merged.requiresConfirmation) {
      return { ...merged, oneLiner: merged.oneLiner || 'Identity not confirmed — check brokerage record.', identityWarning: true };
    }
    return merged;
  }

  function otherListings(symbol, exchange) {
    const sym = String(symbol).toUpperCase();
    return base.filter((e) => e.symbol === sym && !exchangeMatches(e.exchange, exchange)).map((e) => ({ exchange: e.exchange, name: e.name, currency: e.currency }));
  }

  function saveOverride(symbol, exchange, data) {
    const sym = String(symbol).toUpperCase();
    const before = db.prepare('SELECT data_json FROM descriptions WHERE symbol = ? AND exchange = ?').get(sym, exchange);
    const clean = {};
    for (const k of ['oneLiner', 'business', 'howItMakesMoney', 'aiRole', 'aiConnection', 'supplyChainRole', 'risks', 'whyAttention',
      'investigateIf', 'sourceUrl', 'lastReviewed', 'verification', 'name', 'leveraged', 'dailyObjective', 'category']) {
      if (k in data) clean[k] = data[k];
    }
    if (clean.oneLiner && clean.oneLiner.length > 140) throw new Error('Keep the one-line description under 140 characters');
    if (clean.aiConnection && !['direct', 'indirect', 'speculative', 'none'].includes(clean.aiConnection)) throw new Error('AI connection must be direct, indirect, speculative or none');
    const merged = { ...(before ? JSON.parse(before.data_json) : {}), ...clean };
    db.prepare(`INSERT INTO descriptions (symbol, exchange, data_json, updated_at) VALUES (?,?,?,?)
                ON CONFLICT(symbol, exchange) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
      .run(sym, exchange, JSON.stringify(merged), nowIso());
    audit(db, 'description', `${sym}|${exchange}`, 'update', before ? JSON.parse(before.data_json) : null, merged);
    return lookup(sym, exchange);
  }

  return { lookup, describeInstrument, otherListings, saveOverride, all: () => base, categories: CATEGORIES };
}

// Default research universe: every non-ETF catalog entry.
export function seedWatchlist(db, catalog) {
  if (db.prepare('SELECT COUNT(*) n FROM watchlist').get().n > 0) return 0;
  let n = 0;
  for (const e of catalog.all()) {
    if (e.type === 'etf' || e.requiresConfirmation || !e.category || e.category.endsWith('_etf')) continue;
    db.prepare('INSERT OR IGNORE INTO watchlist (symbol, exchange, category, added_at) VALUES (?,?,?,?)').run(e.symbol, e.exchange, e.category, nowIso());
    n += 1;
  }
  return n;
}
