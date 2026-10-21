// News & filings intelligence. Everything retrieved here is untrusted text:
// it is stored and displayed as data (escaped in the UI), never executed, and
// when it is passed to the optional AI analyst it is fenced as data.
import crypto from 'node:crypto';
import { log } from './log.js';
import { addDays, todayIn, zonedToUtc, NY } from './time.js';
import { exchangeGroup, dayInfo } from './calendar.js';

const PRESS_WIRES = ['business wire', 'businesswire', 'pr newswire', 'prnewswire', 'globenewswire', 'globe newswire', 'accesswire', 'newsfile', 'cision'];
const REPUTABLE = ['reuters', 'bloomberg', 'wall street journal', 'wsj', 'financial times', 'ft.com', 'cnbc', 'associated press', 'ap news',
  'marketwatch', "barron's", 'barrons', 'the globe and mail', 'globe and mail', 'nikkei', 'the information', 'axios', 'new york times', 'yahoo'];
const UNCONFIRMED_WORDS = /\b(reportedly|rumou?r|sources? (?:say|said)|people familiar|in talks|considering|could be|may be weighing|exploring|speculat)/i;
const HIGH_WORDS = /\b(earnings|results|guidance|outlook|forecast|acqui|merger|to buy|takeover|offering|dilut|downgrad|upgrad|sec |investigation|lawsuit|recall|bankrupt|delist|restat|ceo|cfo|resign|contract|award|partnership|export (?:ban|control|restriction)|tariff|split)/i;
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'as', 'at', 'by', 'from', 'is', 'are', 'its', 'after', 'says', 'said', 'inc', 'corp', 'co', 'ltd', 'stock', 'shares']);

export function classifySource(item) {
  if (item.source_type) return item.source_type;
  const s = `${item.source_name || ''} ${item.url || ''}`.toLowerCase();
  if (PRESS_WIRES.some((w) => s.includes(w))) return 'press_release';
  if (REPUTABLE.some((w) => s.includes(w))) return 'media';
  return 'other';
}

export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|guccounter|cmpid|ref$|src$)/i.test(k)) url.searchParams.delete(k);
    return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return String(u || '');
  }
}

export function clusterKey(title) {
  const words = String(title || '').toLowerCase().replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8).sort().join(' ');
}

function similarity(a, b) {
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

export function assessItem(item) {
  const sourceType = classifySource(item);
  const text = `${item.title} ${item.summary || ''}`;
  let status = item.status;
  if (!status) {
    if (UNCONFIRMED_WORDS.test(text)) status = 'unconfirmed';
    else if (sourceType === 'filing' || sourceType === 'press_release') status = 'confirmed';
    else if (sourceType === 'media') status = 'reported';
    else status = 'unconfirmed';
  }
  let importance = item.importance;
  if (!importance) {
    importance = HIGH_WORDS.test(item.title) ? (sourceType === 'other' ? 2 : 3) : (sourceType === 'other' ? 1 : 2);
  }
  return { sourceType, status, importance };
}

// Insert normalized items; returns counts. Duplicates (same URL / provider id)
// are skipped; near-identical headlines are grouped under one cluster.
export function storeNews(db, items, { now = new Date() } = {}) {
  let inserted = 0, duplicates = 0;
  const recent = db.prepare('SELECT id, cluster_key, status, title FROM news WHERE published_at >= ?').all(new Date(now - 4 * 86400000).toISOString());
  for (const raw of items) {
    if (!raw.title) continue;
    const dedupeKey = crypto.createHash('sha256').update(raw.url ? normalizeUrl(raw.url) : `${raw.provider}:${raw.provider_id || raw.title}`).digest('hex');
    const { sourceType, status, importance } = assessItem(raw);
    let ck = clusterKey(raw.title);
    const match = recent.find((r) => r.cluster_key && similarity(r.cluster_key, ck) >= 0.75);
    if (match) ck = match.cluster_key;
    const r = db.prepare(`INSERT INTO news (dedupe_key, cluster_key, title, url, source_name, source_type, published_at, event_at, fetched_at,
                          summary, symbols_json, status, importance, provider)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`).run(
      dedupeKey, ck, String(raw.title).slice(0, 500), raw.url || null, raw.source_name || null, sourceType,
      raw.published_at || null, raw.event_at || null, now.toISOString(), String(raw.summary || '').slice(0, 2000),
      JSON.stringify([...new Set((raw.related || []).map((s) => s.toUpperCase()))]), status, importance, raw.provider || 'unknown');
    if (r.changes) {
      inserted += 1;
      recent.push({ id: r.lastInsertRowid, cluster_key: ck, status, title: raw.title });
    } else duplicates += 1;
  }
  flagConflicts(db);
  return { inserted, duplicates };
}

// Mark clusters where one source denies or contradicts what another reports.
export function flagConflicts(db) {
  const rows = db.prepare(`SELECT cluster_key, GROUP_CONCAT(title, ' || ') titles, COUNT(*) n FROM news
                           WHERE cluster_key IS NOT NULL GROUP BY cluster_key HAVING n > 1`).all();
  for (const r of rows) {
    const denies = /\b(denies|denied|no plans|not in talks|false|refutes|rejects report)\b/i.test(r.titles);
    if (denies) db.prepare("UPDATE news SET status = 'conflicting' WHERE cluster_key = ?").run(r.cluster_key);
  }
}

export async function ingestNews(ctx, { symbols, days = 3, now = new Date() } = {}) {
  const { db } = ctx;
  const all = symbols || db.prepare(`SELECT DISTINCT i.symbol, i.exchange FROM instruments i
     LEFT JOIN transactions t ON t.instrument_id = i.id AND t.voided_at IS NULL
     WHERE t.id IS NOT NULL AND i.identity_status = 'confirmed'`).all();
  const to = todayIn(NY, now);
  const from = addDays(to, -days);
  const report = { inserted: 0, duplicates: 0, errors: [] };
  const fh = ctx.providers.finnhub;
  const sec = ctx.providers.sec;
  for (const { symbol, exchange } of all) {
    const us = exchangeGroup(exchange) === 'NYSE';
    if (fh && us) {
      try {
        const r = storeNews(db, await fh.getNews(symbol, from, to), { now });
        report.inserted += r.inserted; report.duplicates += r.duplicates;
      } catch (e) {
        report.errors.push(`${symbol} news: ${e.message}`);
        if (e.kind === 'auth' || e.kind === 'rate_limit') break;
      }
    }
    if (sec && us) {
      try {
        const r = storeNews(db, await sec.getFilings(symbol, addDays(to, -14)), { now });
        report.inserted += r.inserted; report.duplicates += r.duplicates;
      } catch (e) {
        report.errors.push(`${symbol} filings: ${e.message}`);
      }
    }
  }
  if (report.errors.length) log.warn('news', `${report.errors.length} news source errors`, report.errors.slice(0, 5));
  return report;
}

// Observed price reaction around publication, from stored bars only.
// This describes what the price did, not why.
export function observedReaction(db, newsRow, instrumentId) {
  if (!newsRow.published_at) return null;
  const pub = newsRow.published_at;
  const bars = db.prepare(`SELECT * FROM bars WHERE instrument_id = ? AND interval = '5min' AND ts >= ? ORDER BY ts LIMIT 7`).all(instrumentId, pub);
  const before = db.prepare(`SELECT * FROM bars WHERE instrument_id = ? AND interval = '5min' AND ts < ? ORDER BY ts DESC LIMIT 1`).get(instrumentId, pub);
  if (before && bars.length >= 6) {
    const after = bars[5];
    const pct = ((after.c - before.c) / before.c) * 100;
    return {
      method: '30 minutes after publication vs last price before it (5-minute bars)',
      fromPrice: before.c, toPrice: after.c, pct: Math.round(pct * 100) / 100,
      caveat: 'Observed move only. Other news, market-wide moves or sector flows may explain it.',
    };
  }
  // Daily bars: from the last close at or before publication to the first
  // close after it. An item published after the close (or on a weekend) is
  // measured from that close to the next session's close; if that session
  // has not closed yet there is nothing to report.
  const exchange = db.prepare('SELECT exchange FROM instruments WHERE id = ?').get(instrumentId)?.exchange || 'NYSE';
  const closeAt = (date) => {
    const info = dayInfo(date, exchange);
    return zonedToUtc(date, Math.floor((info.closeMin ?? 960) / 60), (info.closeMin ?? 960) % 60, info.tz).toISOString();
  };
  const daily = db.prepare(`SELECT * FROM bars WHERE instrument_id = ? AND interval = '1day' AND ts >= ? AND ts <= ? ORDER BY ts`)
    .all(instrumentId, addDays(pub.slice(0, 10), -10), addDays(pub.slice(0, 10), 10));
  const prev = daily.filter((b) => closeAt(b.ts) <= pub).at(-1);
  const next = daily.find((b) => closeAt(b.ts) > pub);
  if (prev && next) {
    return {
      method: `Daily close ${prev.ts} to ${next.ts}`,
      fromPrice: prev.c, toPrice: next.c, pct: Math.round(((next.c - prev.c) / prev.c) * 10000) / 100,
      caveat: 'Full-day move; it cannot be attributed to this item without intraday evidence.',
    };
  }
  return null;
}

export function listNews(db, { symbol, since, limit = 100, minImportance = 1 } = {}) {
  const rows = db.prepare(`SELECT * FROM news WHERE importance >= ? ${since ? 'AND published_at >= ?' : ''}
                           ORDER BY published_at DESC LIMIT ?`).all(...[minImportance, ...(since ? [since] : []), limit * 3]);
  const out = [];
  const seenCluster = new Map();
  for (const r of rows) {
    const symbols = JSON.parse(r.symbols_json);
    if (symbol && !symbols.includes(symbol.toUpperCase())) continue;
    const item = { ...r, symbols, analysis: r.analysis_json ? JSON.parse(r.analysis_json) : null, reaction: r.reaction_json ? JSON.parse(r.reaction_json) : null };
    delete item.analysis_json; delete item.reaction_json; delete item.symbols_json;
    if (r.cluster_key && seenCluster.has(r.cluster_key)) {
      seenCluster.get(r.cluster_key).related.push({ id: r.id, title: r.title, url: r.url, source_name: r.source_name, published_at: r.published_at });
      continue;
    }
    item.related = [];
    if (r.cluster_key) seenCluster.set(r.cluster_key, item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
