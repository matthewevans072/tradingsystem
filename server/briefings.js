// The three daily briefings (premarket 9:15, first-hour 10:30, before-close
// one hour before the regular close) plus on-demand "manual" briefings.
// Every briefing is saved, searchable, and records data freshness. A briefing
// that can't get fresh data is still saved, marked "partial", with the gaps
// stated, never filled with estimates.
import { computePortfolio } from './portfolio.js';
import { runAssessments } from './assessments.js';
import { refreshQuotes, refreshFx, refreshIntraday, refreshEarnings, refreshDailyBars, providerStatus } from './marketdata.js';
import { ingestNews, listNews, observedReaction } from './news.js';
import { analyzeNews, narrateBriefing, analystAvailable } from './analyst.js';
import { deliver } from './delivery.js';
import { dailyBars, indicators, intradayBars, sessionStats } from './analytics.js';
import { nowIso } from './db.js';
import { log } from './log.js';
import { previousTradingDay, nextTradingDay, regularSessionBounds, sessionAt, dayInfo } from './calendar.js';
import { todayIn, zonedToUtc, formatNy, NY } from './time.js';

export const KINDS = {
  premarket: 'Premarket briefing',
  first_hour: 'First-hour review',
  pre_close: 'Before-close briefing',
  manual: 'On-demand briefing',
};

const ACTION_ORDER = { SELL: 0, TRIM: 1, CONDITIONAL_ADD: 2, WAIT: 3, HOLD: 4, INSUFFICIENT_EVIDENCE: 5 };

function fmt(n, dp = 2) {
  return n == null ? 'n/a' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function pct(n) {
  return n == null ? 'n/a' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
}

// Refresh everything a briefing needs. Each step reports its own failure.
export async function collectData(ctx, kind, { now = new Date() } = {}) {
  const steps = [];
  const run = async (name, fn) => {
    try { steps.push({ name, ok: true, result: await fn() }); } catch (e) { steps.push({ name, ok: false, error: e.message }); }
  };
  await run('fx', () => refreshFx(ctx));
  await run('quotes', () => refreshQuotes(ctx, { now }));
  if (kind === 'premarket' || kind === 'manual') {
    await run('dailyBars', () => refreshDailyBars(ctx));
    await run('earnings', () => refreshEarnings(ctx));
  }
  if (kind === 'first_hour' || kind === 'pre_close') await run('intraday', () => refreshIntraday(ctx, { date: todayIn(NY, now) }));
  await run('news', () => ingestNews(ctx, { now, days: kind === 'premarket' ? 4 : 2 }));
  return steps;
}

function priorBriefing(db, kind, tradingDate) {
  const r = db.prepare(`SELECT * FROM briefings WHERE kind = ? AND trading_date = ? AND status IN ('ok','partial') ORDER BY id DESC LIMIT 1`).get(kind, tradingDate);
  return r ? { ...r, content: JSON.parse(r.content_json) } : null;
}

export async function buildBriefing(ctx, { kind, tradingDate, now = new Date(), collect = true }) {
  const { db, catalog } = ctx;
  const steps = collect ? await collectData(ctx, kind, { now }) : [];
  const portfolio = computePortfolio(db, { now, catalog });
  const assessments = runAssessments(ctx, portfolio, { now });
  const held = portfolio.positions.map((p) => p.symbol);
  const prevDay = previousTradingDay(tradingDate);
  const nextDay = nextTradingDay(tradingDate);
  const sinceIso = kind === 'premarket'
    ? zonedToUtc(prevDay, 16, 0, NY).toISOString()
    : (priorBriefing(db, 'premarket', tradingDate)?.generated_at || zonedToUtc(tradingDate, 4, 0, NY).toISOString());

  // News for holdings (and watchlist, lower priority).
  let news = listNews(db, { since: sinceIso, limit: 60, minImportance: 2 })
    .filter((n) => n.symbols.some((s) => held.includes(s)));
  for (const n of news) {
    const p = portfolio.positions.find((x) => n.symbols.includes(x.symbol));
    if (p && !n.reaction) {
      const r = observedReaction(db, n, p.instrument_id);
      if (r) { n.reaction = r; db.prepare('UPDATE news SET reaction_json = ? WHERE id = ?').run(JSON.stringify(r), n.id); }
    }
  }
  if (analystAvailable(ctx)) {
    const todo = news.filter((n) => !n.analysis && n.importance >= 3).slice(0, 8);
    if (todo.length) {
      await analyzeNews(ctx, todo, { holdings: held });
      news = news.map((n) => {
        const r = db.prepare('SELECT analysis_json FROM news WHERE id = ?').get(n.id);
        return r?.analysis_json ? { ...n, analysis: JSON.parse(r.analysis_json) } : n;
      });
    }
  }

  const events = db.prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date').all(tradingDate, nextDay);
  const watch = new Set(db.prepare('SELECT symbol FROM watchlist').all().map((r) => r.symbol));
  const catalysts = events
    .filter((e) => e.type === 'macro' || held.includes(e.symbol) || watch.has(e.symbol))
    .map((e) => ({ ...e, held: held.includes(e.symbol), details: e.details_json ? JSON.parse(e.details_json) : null }));

  // Data quality summary.
  const dataIssues = [];
  for (const p of portfolio.positions) {
    if (p.identityStatus !== 'confirmed') dataIssues.push(`${p.symbol}: instrument identity not confirmed — not priced.`);
    else if (!p.quote || p.quote.price == null) dataIssues.push(`${p.symbol}: no valid quote${p.quote?.lastError ? ` (${p.quote.lastError})` : ''}.`);
    else if (p.quote.freshness === 'stale') dataIssues.push(`${p.symbol}: quote is stale — ${p.quote.freshnessReason}.`);
  }
  for (const s of steps) if (!s.ok) dataIssues.push(`${s.name} refresh failed: ${s.error}`);
  const qs = steps.find((s) => s.name === 'quotes')?.result;
  if (qs?.message?.startsWith('No market-data provider')) dataIssues.push('No market-data provider is configured, so prices are not current.');
  if (ctx.mode !== 'demo') {
    if (!ctx.providers.finnhub && !ctx.providers.sec) dataIssues.push('No news or filings sources are connected, so overnight developments were not checked.');
    if (!ctx.providers.earnings) dataIssues.push('No earnings-calendar source is connected, so upcoming earnings may be missing.');
  }

  const positions = portfolio.positions.map((p) => {
    const bars = dailyBars(db, p.instrument_id);
    const ind = indicators(bars);
    const priorBar = [...bars].reverse().find((b) => b.ts < tradingDate) || null;
    const intraday = sessionStats(intradayBars(db, p.instrument_id, tradingDate));
    const q = p.quote;
    const dayRangePos = q && q.price != null && q.high != null && q.low != null && q.high > q.low && q.freshness === 'fresh'
      ? Math.round(((q.price - q.low) / (q.high - q.low)) * 100) : null;
    return {
      symbol: p.symbol, exchange: p.exchange, currency: p.currency, strategy: p.strategy, shares: p.shares,
      price: p.price, changePct: q?.changePct ?? null, dailyPL: p.dailyPL, unrealizedPct: p.unrealizedPct,
      weightPct: p.weightPct ?? p.weightInCurrencyPct ?? null,
      quote: q ? { provider: q.provider, at: q.quoteTime, timeliness: q.timeliness, freshness: q.freshness, session: q.session, high: q.high, low: q.low, open: q.open, prevClose: q.prevClose, volume: q.volume, avgVolume: q.avgVolume, ext: q.ext } : null,
      levels: {
        prevClose: q?.prevClose ?? null,
        prevDayHigh: priorBar?.h ?? null,
        prevDayLow: priorBar?.l ?? null,
        prevDayDate: priorBar?.ts ?? null,
        sma20: ind.sma20, sma50: ind.sma50, high20: ind.high20, low20: ind.low20, atr14: ind.atr14,
      },
      intraday,
      dayRangePos,
    };
  });

  const sections = [];
  const S = (heading, items, note) => sections.push({ heading, items, note });
  const assessBy = new Map(assessments.map((a) => [a.symbol, a]));
  const ordered = [...assessments].sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action]);

  const newsItems = news.slice(0, 20).map((n) => ({
    text: n.title, symbols: n.symbols.filter((s) => held.includes(s)), url: n.url, source: n.source_name || n.provider,
    at: n.published_at, eventAt: n.event_at, status: n.status, sourceType: n.source_type,
    reaction: n.reaction, analysis: n.analysis, related: n.related?.length || 0,
  }));
  const catalystItems = catalysts.map((e) => ({
    text: `${e.symbol || 'Macro'}: ${e.type === 'earnings' ? 'earnings' : e.title} on ${e.date}${e.time_hint && e.time_hint !== 'unknown' ? ` (${e.time_hint === 'bmo' ? 'before open' : e.time_hint === 'amc' ? 'after close' : 'during market'})` : ''}${e.held ? ' — held' : ' — watchlist'}`,
    source: e.source, at: e.fetched_at,
  }));

  if (kind === 'premarket' || kind === 'manual') {
    S('Overnight and after-hours developments', newsItems, newsItems.length ? null : 'No material news or filings for your holdings since the last close from configured sources.');
    S('Earnings and scheduled events (today and next session)', catalystItems, catalystItems.length ? null : 'No scheduled earnings for holdings or watchlist in this window from configured sources. Macro events can be added on the Intelligence page.');
    const pm = positions.filter((p) => p.quote?.ext && p.quote.ext.session === 'pre' && p.quote.ext.time >= zonedToUtc(tradingDate, 4, 0, NY).toISOString());
    S('Verified premarket moves', pm.map((p) => ({
      symbol: p.symbol, text: `${p.symbol} ${fmt(p.quote.ext.price)} ${p.currency} (${pct(p.quote.ext.changePct)} vs prior close) at ${formatNy(p.quote.ext.time)}`,
      source: p.quote.provider,
    })), pm.length ? 'Premarket trading is thin: prices can move on small volume and may not hold at the open.' : 'No verified premarket quotes. Your data plan may not include extended-hours prices; none are estimated.');
    S('Key levels to watch', positions.filter((p) => p.levels.sma50 != null || p.levels.prevClose != null).map((p) => ({
      symbol: p.symbol,
      text: `${p.symbol}: prior close ${fmt(p.levels.prevClose)}${p.levels.prevDayHigh != null ? `; prior session (${p.levels.prevDayDate}) range ${fmt(p.levels.prevDayLow)}–${fmt(p.levels.prevDayHigh)}` : ''}; 20-day range ${fmt(p.levels.low20)}–${fmt(p.levels.high20)}; 20/50-day avg ${fmt(p.levels.sma20)} / ${fmt(p.levels.sma50)}`,
    })));
    S('Position priorities for the session', ordered.map((a) => ({ symbol: a.symbol, action: a.action, text: `${a.symbol} — ${label(a.action)}: ${a.reason}`, detail: `Act if: ${a.trigger} Invalidated by: ${a.invalidation}` })));
  }

  if (kind === 'first_hour') {
    S('Opening range and session so far', positions.map((p) => {
      const or = p.intraday.openingRange, reg = p.intraday.regular;
      if (or && reg) return { symbol: p.symbol, text: `${p.symbol}: first ${or.minutes} min range ${fmt(or.low)}–${fmt(or.high)}; session so far ${fmt(reg.low)}–${fmt(reg.high)} (from ${reg.bars} five-minute bars); last ${fmt(p.price)}` };
      if (p.quote?.high != null) return { symbol: p.symbol, text: `${p.symbol}: session high/low so far ${fmt(p.quote.low)}–${fmt(p.quote.high)} as reported by ${p.quote.provider}; open ${fmt(p.quote.open)}; last ${fmt(p.price)}. Opening range unavailable (no intraday bars on this plan).` };
      return { symbol: p.symbol, text: `${p.symbol}: no session data available.` };
    }));
    S('Volume', positions.filter((p) => p.quote?.volume != null).map((p) => ({
      symbol: p.symbol,
      text: `${p.symbol}: ${Math.round(p.quote.volume).toLocaleString()} shares so far${p.quote.avgVolume ? ` vs ${Math.round(p.quote.avgVolume).toLocaleString()} average for a full day` : ''}.`,
    })), 'Volume so far is compared with a full-day average; early-session volume is normally a fraction of it.');
    S('News since the premarket briefing and observed reaction', newsItems, newsItems.length ? 'Reactions are observed price moves, not proof of cause.' : 'No new material items since the premarket briefing.');
    S('Changes from the premarket assessment', diffAssessments(priorBriefing(db, 'premarket', tradingDate), assessments));
    S('Conditions to wait, hold or reduce', ordered.map((a) => ({ symbol: a.symbol, action: a.action, text: `${a.symbol} — ${label(a.action)}. Act if: ${a.trigger}`, detail: `Invalidated by: ${a.invalidation}` })));
  }

  if (kind === 'pre_close') {
    const t = portfolio.totals;
    S('Session performance', [
      ...['USD', 'CAD'].filter((c) => t[c].positions).map((c) => ({ text: `${c} holdings: ${fmtSigned(t[c].dailyPL)} ${c} today (${pct(t[c].dailyPct)})${t[c].complete ? '' : ' — some positions unpriced'}` })),
      ...positions.map((p) => ({ symbol: p.symbol, text: `${p.symbol}: ${pct(p.changePct)} today, ${fmtSigned(p.dailyPL)} ${p.currency}` })),
    ]);
    S("Position in today's range", positions.filter((p) => p.dayRangePos != null).map((p) => ({
      symbol: p.symbol, text: `${p.symbol}: ${p.dayRangePos}% of the way from today's low (${fmt(p.quote.low)}) to high (${fmt(p.quote.high)}) so far.`,
    })), 'Range is the regular session so far; the final high or low may still change in the last hour.');
    S('Material changes in thesis or assessment', diffAssessments(priorBriefing(db, 'first_hour', tradingDate) || priorBriefing(db, 'premarket', tradingDate), assessments));
    S('Conditions for taking profits or reducing risk', ordered.map((a) => ({ symbol: a.symbol, action: a.action, text: `${a.symbol} — ${label(a.action)}. ${a.trigger}`, detail: `Main risk: ${a.downside}` })));
    const overnight = catalysts.filter((e) => (e.date === tradingDate && e.time_hint === 'amc') || (e.date === nextDay));
    S('Overnight and next-session catalysts', overnight.map((e) => ({ text: `${e.symbol || 'Macro'}: ${e.type} ${e.date}${e.time_hint === 'amc' ? ' after the close' : e.time_hint === 'bmo' ? ' before the open' : ''}`, source: e.source })),
      overnight.length ? null : 'No scheduled earnings or events for holdings tonight or next session from configured sources.');
  }

  const content = {
    kind, title: `${KINDS[kind]} — ${tradingDate}`, tradingDate, generatedAt: nowIso(),
    session: sessionAt(now).session,
    portfolioSummary: {
      USD: pick(portfolio.totals.USD), CAD: pick(portfolio.totals.CAD),
      combined: portfolio.combined, limitations: portfolio.limitations,
    },
    positions, assessments, catalysts: catalystItems, news: newsItems.map((n, i) => ({ id: news[i]?.id, ...n, source_name: n.source, published_at: n.at, title: n.text })),
    sections, dataIssues,
    freshness: {
      providers: providerStatus(ctx),
      fx: portfolio.fx ? { rate: portfolio.fx.rate, asOf: portfolio.fx.as_of, source: portfolio.fx.source } : null,
      steps: steps.map((s) => ({ name: s.name, ok: s.ok, error: s.error })),
    },
    isDemo: ctx.mode === 'demo',
  };
  content.narrative = await narrateBriefing(ctx, content);
  return content;
}

function pick(t) {
  return { marketValue: t.marketValue, dailyPL: t.dailyPL, dailyPct: t.dailyPct, unrealizedPL: t.unrealizedPL, unrealizedPct: t.unrealizedPct, cash: t.cash, complete: t.complete };
}
function fmtSigned(n) {
  return n == null ? 'n/a' : `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
}
export function label(a) {
  return { HOLD: 'Hold', TRIM: 'Trim', SELL: 'Sell', WAIT: 'Wait', CONDITIONAL_ADD: 'Conditional add', INSUFFICIENT_EVIDENCE: 'Insufficient evidence' }[a] || a;
}

function diffAssessments(prior, current) {
  if (!prior) return [{ text: 'No earlier briefing today to compare with.' }];
  const before = new Map((prior.content.assessments || []).map((a) => [a.symbol, a]));
  const items = [];
  for (const a of current) {
    const b = before.get(a.symbol);
    if (!b) items.push({ symbol: a.symbol, text: `${a.symbol}: new — ${label(a.action)}.` });
    else if (b.action !== a.action) items.push({ symbol: a.symbol, action: a.action, text: `${a.symbol}: ${label(b.action)} → ${label(a.action)}. ${a.reason}` });
  }
  return items.length ? items : [{ text: 'No assessment changed since the earlier briefing.' }];
}

export function renderText(content) {
  const lines = [];
  lines.push(content.title.toUpperCase());
  if (content.isDemo) lines.push('*** DEMO DATA — NOT YOUR PORTFOLIO ***');
  lines.push(`Generated ${formatNy(content.generatedAt)}`);
  lines.push('');
  if (content.narrative && !content.narrative.error) {
    lines.push(content.narrative.headline);
    lines.push(content.narrative.summary);
    lines.push(`(${content.narrative.label})`);
    lines.push('');
  }
  const ps = content.portfolioSummary;
  for (const c of ['USD', 'CAD']) {
    const t = ps[c];
    if (!t || !t.marketValue && t.cash == null) continue;
    lines.push(`${c}: value ${fmt(t.marketValue)} | today ${fmtSigned(t.dailyPL)} (${pct(t.dailyPct)}) | unrealized ${fmtSigned(t.unrealizedPL)} (${pct(t.unrealizedPct)}) | cash ${t.cash == null ? 'not recorded' : fmt(t.cash)}`);
  }
  if (ps.combined) lines.push(`Combined (CAD at ${ps.combined.fxRate} ${ps.combined.fxSource}, ${ps.combined.fxAsOf}): ${fmt(ps.combined.total)}`);
  lines.push('');
  for (const s of content.sections) {
    lines.push(`## ${s.heading}`);
    if (s.note) lines.push(`  (${s.note})`);
    if (!s.items.length && !s.note) lines.push('  (none)');
    for (const it of s.items) {
      lines.push(`- ${it.text}${it.status ? ` [${it.status}]` : ''}${it.source ? ` — ${it.source}` : ''}${it.at ? `, ${formatNy(it.at)}` : ''}`);
      if (it.detail) lines.push(`    ${it.detail}`);
      if (it.reaction) lines.push(`    Observed: ${pct(it.reaction.pct)} (${it.reaction.method}). ${it.reaction.caveat}`);
      if (it.analysis) lines.push(`    Why it may matter (AI interpretation): ${it.analysis.whyItMatters}`);
      if (it.url) lines.push(`    ${it.url}`);
    }
    lines.push('');
  }
  if (content.dataIssues.length) {
    lines.push('## Data limitations');
    for (const d of content.dataIssues) lines.push(`- ${d}`);
    for (const l of content.portfolioSummary.limitations || []) lines.push(`- ${l}`);
    lines.push('');
  }
  lines.push('Signal Desk is a monitoring and research tool. It does not place trades. Assessments are rule-based and conditional; verify before acting.');
  return lines.join('\n');
}

// Create/update a briefing row and deliver it. Scheduled briefings use a
// unique slot key so each one is generated at most once.
export async function produceBriefing(ctx, { kind, tradingDate, slotKey = null, scheduledFor = null, now = new Date(), collect = true, deliverIt = true }) {
  const { db } = ctx;
  let id;
  if (slotKey) {
    const existing = db.prepare('SELECT * FROM briefings WHERE slot_key = ?').get(slotKey);
    if (existing && ['ok', 'partial', 'missed'].includes(existing.status)) return { id: existing.id, status: existing.status, duplicate: true };
    if (existing) {
      id = existing.id;
      db.prepare("UPDATE briefings SET status = 'running', attempts = attempts + 1 WHERE id = ?").run(id);
    }
  }
  if (!id) {
    id = Number(db.prepare(`INSERT INTO briefings (kind, trading_date, slot_key, scheduled_for, status, attempts, title, is_demo)
                            VALUES (?,?,?,?, 'running', 1, ?, ?)`).run(kind, tradingDate, slotKey, scheduledFor, `${KINDS[kind]} — ${tradingDate}`, ctx.mode === 'demo' ? 1 : 0).lastInsertRowid);
  }
  try {
    const content = await buildBriefing(ctx, { kind, tradingDate, now, collect });
    const text = renderText(content);
    const status = content.dataIssues.length ? 'partial' : 'ok';
    db.prepare('UPDATE briefings SET status = ?, generated_at = ?, content_json = ?, text = ?, title = ?, error = NULL WHERE id = ?')
      .run(status, content.generatedAt, JSON.stringify(content), text, content.title, id);
    let delivery = [];
    if (deliverIt) delivery = await deliver(ctx, { refType: 'briefing', refId: id, title: `Signal Desk — ${content.title}`, text });
    log.info('briefing', `${content.title}: ${status}; delivery ${delivery.map((d) => `${d.channel}=${d.status}`).join(', ')}`);
    return { id, status, delivery };
  } catch (e) {
    db.prepare("UPDATE briefings SET status = 'failed', error = ? WHERE id = ?").run(e.message, id);
    log.error('briefing', `${kind} ${tradingDate} failed`, e);
    return { id, status: 'failed', error: e.message };
  }
}

export function searchBriefings(db, { q, kind, from, to, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (q) { where.push('(text LIKE ? OR title LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (from) { where.push('trading_date >= ?'); args.push(from); }
  if (to) { where.push('trading_date <= ?'); args.push(to); }
  return db.prepare(`SELECT id, kind, trading_date, scheduled_for, generated_at, status, attempts, title, error, is_demo,
                     substr(text, 1, 400) AS preview FROM briefings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                     ORDER BY COALESCE(generated_at, scheduled_for) DESC, id DESC LIMIT ?`).all(...args, limit);
}

export { dayInfo, regularSessionBounds };
