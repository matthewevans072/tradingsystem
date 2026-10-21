// Position assessments: HOLD / TRIM / SELL / WAIT / CONDITIONAL ADD /
// INSUFFICIENT EVIDENCE.
//
// Principles enforced in code:
// - No action is derived from distance to the entry price. Unrealized P/L is
//   shown as context only.
// - A fall alone never produces an add; a rise alone never produces a sell.
// - CONDITIONAL ADD requires confirmed available cash in the position's
//   currency; personalised sizing requires a completed risk profile.
// - Long-term ETF holdings are judged on portfolio fit, not short-term signals.
// - Missing, stale or unconfirmed data yields INSUFFICIENT EVIDENCE.
import { dailyBars, indicators, trendState } from './analytics.js';
import { getSetting, nowIso } from './db.js';
import { addDays, todayIn, NY } from './time.js';
import { nextTradingDay } from './calendar.js';

export const DEFAULT_THRESHOLDS = {
  reviewWeightPct: 25,       // single position weight that triggers a concentration review
  earningsWindowDays: 7,     // calendar days before earnings treated as event risk
  leveragedHoldDays: 10,     // trading-day horizon after which leveraged-ETF decay is flagged
};

export const RISK_QUESTIONS = [
  { id: 'maxLossPerTradePct', q: 'Maximum loss you accept on a single trade, as % of the total portfolio', type: 'number' },
  { id: 'maxPortfolioDrawdownPct', q: 'Maximum decline of the whole portfolio you could tolerate before cutting risk (%)', type: 'number' },
  { id: 'typicalHoldingPeriod', q: 'Typical holding period for swing trades', type: 'text' },
  { id: 'nearTermCashNeeds', q: 'Money you may need to withdraw in the next 12 months (amount and currency, or "none")', type: 'text' },
  { id: 'usesBorrowing', q: 'Do you use margin or other borrowing to invest? (yes/no)', type: 'text' },
  { id: 'accountTypes', q: 'Account types holding these positions (e.g. TFSA, RRSP, FHSA, non-registered)', type: 'text' },
];

export function riskProfileStatus(db) {
  const rp = getSetting(db, 'riskProfile', {});
  const missing = RISK_QUESTIONS.filter((q) => rp[q.id] === undefined || rp[q.id] === null || rp[q.id] === '').map((q) => q.id);
  return { profile: rp, complete: missing.length === 0, missing };
}

const conf = (lvl) => ({ low: 'Low — limited evidence', moderate: 'Moderate — consistent signals, not decisive', limited: 'Limited — data incomplete' }[lvl] || lvl);

export function assessPosition(ctx, pos, { portfolio, catalogEntry, events, news, now = new Date() }) {
  const { db } = ctx;
  const userTh = getSetting(db, 'assessmentThresholds', {});
  const th = { ...DEFAULT_THRESHOLDS, ...userTh };
  const thLabel = userTh.reviewWeightPct != null ? `your ${th.reviewWeightPct}% review threshold` : `the ${th.reviewWeightPct}% review threshold (an app default, not a limit you set — change it in Settings)`;
  const sources = [];
  const notes = [];
  const out = {
    instrument_id: pos.instrument_id, symbol: pos.symbol, exchange: pos.exchange, currency: pos.currency,
    strategy: pos.strategy, createdAt: now.toISOString(), method: 'rules',
  };
  const q = pos.quote;
  const cashCcy = portfolio.totals[pos.currency];
  const cashOk = cashCcy.cash != null && cashCcy.cash > 0 && cashCcy.cashConfirmed;
  const risk = riskProfileStatus(db);
  const ctxLines = [];
  if (pos.unrealizedPct != null) ctxLines.push(`Context only: position is ${pos.unrealizedPct >= 0 ? 'up' : 'down'} ${Math.abs(pos.unrealizedPct)}% from your average cost; this does not drive the assessment.`);
  let trend = 'unknown';
  const weight = pos.weightPct ?? pos.weightInCurrencyPct ?? null;
  if (q) sources.push({ label: `${q.provider} quote`, at: q.quoteTime, freshness: q.freshness, timeliness: q.timeliness });

  // --- data sufficiency gates ---
  if (pos.identityStatus !== 'confirmed') {
    return finish({
      action: 'INSUFFICIENT_EVIDENCE', horizon: '—',
      reason: 'The exact security behind this ticker has not been confirmed, so no price or research is attached to it.',
      trigger: 'Confirm the instrument (exchange, currency, issuer) from your brokerage record in Positions.',
      invalidation: '—', downside: 'Acting on the wrong security’s data.', confidence: conf('limited'),
    });
  }
  if (!q || q.price == null || q.freshness === 'missing') {
    return finish({
      action: 'INSUFFICIENT_EVIDENCE', horizon: '—',
      reason: 'No valid quote is available for this position.', trigger: 'Configure or fix the market-data provider.',
      invalidation: '—', downside: 'Unknown current value.', confidence: conf('limited'),
    });
  }
  if (q.freshness === 'stale') notes.push(`Quote is stale (${q.freshnessReason}); conclusions may be out of date.`);

  const bars = dailyBars(db, pos.instrument_id);
  const ind = indicators(bars);
  if (bars.length) sources.push({ label: `Daily price history (${bars.length} sessions)`, at: ind.lastDate });
  const price = q.price;
  trend = trendState(ind, price);
  const today = todayIn(NY, now);
  const nextEarn = events.find((e) => e.type === 'earnings' && e.symbol === pos.symbol && e.date >= today);
  const earnSoon = nextEarn && nextEarn.date <= addDays(today, th.earningsWindowDays);
  if (nextEarn) sources.push({ label: `${nextEarn.source}: earnings ${nextEarn.date}${nextEarn.time_hint && nextEarn.time_hint !== 'unknown' ? ' ' + nextEarn.time_hint.toUpperCase() : ''}`, at: nextEarn.fetched_at });
  const majorNews = news.filter((n) => n.symbols.includes(pos.symbol) && n.importance >= 3).slice(0, 3);
  for (const n of majorNews) sources.push({ label: n.title, url: n.url, at: n.published_at, status: n.status });

  const leveraged = !!catalogEntry?.leveraged;

  const levels = {};
  if (ind.sma20) levels.sma20 = round(ind.sma20);
  if (ind.sma50) levels.sma50 = round(ind.sma50);
  if (ind.low20) levels.low20 = round(ind.low20);
  if (ind.high20) levels.high20 = round(ind.high20);
  if (ind.atr14) levels.atr14 = round(ind.atr14);

  // --- leveraged / inverse products ---
  if (leveraged) {
    notes.push(`Leveraged/inverse fund: ${catalogEntry.dailyObjective || 'objective resets daily'}. Returns over more than one day depend on the path of prices and can differ sharply from the multiple of the index return, especially in volatile markets.`);
    if (pos.strategy === 'long_term') {
      return finish({
        action: 'TRIM', horizon: 'Review now',
        reason: 'This fund resets its leverage daily, which makes it a poor fit for a long-term classification. Holding it for months exposes you to volatility decay.',
        trigger: 'Decide whether this is really a short-term trade; if so reclassify it as swing with an exit plan, otherwise reduce toward a level you would accept losing a large share of.',
        invalidation: 'You deliberately want daily-leveraged exposure over a long period and accept path-dependent losses.',
        downside: 'A sharp fall in the underlying index can produce losses several times larger, and choppy markets erode value even if the index ends flat.',
        confidence: conf('moderate'), levels,
      });
    }
  }

  // --- long-term holdings: portfolio fit, not signals ---
  if (pos.strategy === 'long_term') {
    const diversifiedFund = catalogEntry?.category === 'broad_etf' && !leveraged;
    if (weight != null && weight > th.reviewWeightPct && diversifiedFund) {
      notes.push(`Weight ${weight}% is above the ${th.reviewWeightPct}% single-position threshold, but this is a diversified broad-market fund, so the concentration rule for single companies does not apply. Check overlap with your other US large-cap holdings.`);
    }
    if (weight != null && weight > th.reviewWeightPct && !diversifiedFund) {
      return finish({
        action: 'TRIM', horizon: 'Months (portfolio construction)',
        reason: `This position is ${weight}% of the portfolio, above ${thLabel}, so one holding drives much of the result.`,
        trigger: `Consider trimming toward ${th.reviewWeightPct}% if you want to cap single-position exposure; spreading it over several sessions reduces timing risk.`,
        invalidation: 'You intend this to be a concentrated core holding (for example a diversified broad-market ETF).',
        downside: 'A large decline in this one holding would dominate the portfolio’s result.', confidence: conf('moderate'), levels,
      });
    }
    return finish({
      action: 'HOLD', horizon: 'Long term (quarters to years)',
      reason: catalogEntry?.type === 'etf'
        ? 'Long-term fund position; no portfolio-level trigger (concentration or mandate change) is present. Daily price swings are not a reason to act on a core holding.'
        : 'Classified as long-term; no concentration or event trigger is present. Review the business thesis at the next earnings report rather than on price moves.',
      trigger: `Reassess if weight exceeds ${th.reviewWeightPct}%, the fund/company materially changes, or your cash needs change.`,
      invalidation: catalogEntry?.type === 'etf' ? 'A change to the fund’s mandate, fees or structure, or a change in your own goals.' : 'A quarterly report or filing that undermines the reason you own it.',
      downside: 'Broad market declines; this assessment does not try to time them.', confidence: conf('moderate'), levels,
    });
  }

  // --- swing / unclassified: needs history ---
  if (ind.bars < 50) {
    return finish({
      action: 'INSUFFICIENT_EVIDENCE', horizon: 'Days to weeks',
      reason: `Only ${ind.bars} sessions of price history are stored; at least 50 are needed for trend levels.`,
      trigger: 'History will build automatically once the provider supplies daily bars.', invalidation: '—',
      downside: 'Unknown trend context.', confidence: conf('limited'), levels,
    });
  }

  const stopRef = ind.low20 != null ? Math.min(ind.low20, ind.sma50 ?? Infinity) : ind.sma50;
  if (earnSoon) {
    return finish({
      action: 'WAIT', horizon: `Until after earnings on ${nextEarn.date}`,
      reason: `Earnings are scheduled for ${nextEarn.date}${nextEarn.time_hint === 'amc' ? ' after the close' : nextEarn.time_hint === 'bmo' ? ' before the open' : ''}. The reaction can gap the price past normal stop levels, so new exposure is not justified before the report.`,
      trigger: `Re-evaluate after the report: guidance and the first full session’s reaction matter more than the headline beat/miss. If you want less event risk, reducing before ${nextEarn.date} is the lever.`,
      invalidation: 'Earnings date moves, or you have decided in advance to hold through the event with a defined maximum loss.',
      downside: `Overnight gap after results; recent daily range is about ${ind.atrPct ? ind.atrPct.toFixed(1) + '%' : 'unknown'} and gaps can be several times that.`,
      confidence: conf('moderate'), levels,
    });
  }

  if (weight != null && weight > th.reviewWeightPct) {
    return finish({
      action: 'TRIM', horizon: 'Days to weeks',
      reason: `Position weight ${weight}% exceeds ${thLabel} for a single trade.`,
      trigger: `Reduce toward ${th.reviewWeightPct}% if you want single-trade risk within that threshold.`,
      invalidation: 'You accept the concentration deliberately and have a defined exit level.',
      downside: 'A single adverse move has an outsized effect on the whole portfolio.', confidence: conf('moderate'), levels,
    });
  }

  if (trend === 'downtrend') {
    const brokeLow = ind.low20 != null && price < ind.low20 * 1.0;
    return finish({
      action: brokeLow ? 'SELL' : 'WAIT', horizon: 'Days to weeks',
      reason: brokeLow
        ? `Price is below its 20- and 50-day averages, the 20-day average is falling, and it has broken its 20-day low (${round(ind.low20)}). For a swing trade, the setup that justified it is no longer present.`
        : `Price is below its 20- and 50-day averages and the 20-day average is falling. A lower price alone is not a reason to add.`,
      trigger: brokeLow
        ? `Exit or reduce unless price recovers above ${round(ind.sma20)} (20-day average) promptly.`
        : `Reduce if it closes below ${round(ind.low20)} (20-day low). Consider adding only after it reclaims ${round(ind.sma50)} (50-day average) — and only with available cash.`,
      invalidation: `A close back above the 50-day average (${round(ind.sma50)}) with the 20-day average turning up.`,
      downside: `Continuation lower; typical daily range is about ${round(ind.atr14)} (${ind.atrPct?.toFixed(1)}%).`,
      confidence: conf('low'), levels,
    });
  }

  if (trend === 'uptrend') {
    const nearSupport = ind.sma20 && ind.atr14 && price - ind.sma20 <= ind.atr14 && price >= ind.sma20;
    const extended = ind.sma20 && ind.atr14 && price - ind.sma20 > 3 * ind.atr14;
    if (nearSupport && cashOk) {
      const sizing = sizeTrade({ risk, portfolio, price, stop: stopRef, currency: pos.currency });
      return finish({
        action: 'CONDITIONAL_ADD', horizon: 'Days to weeks',
        reason: `Uptrend (price above rising 20-day and 50-day averages) and price is within one daily range of the 20-day average (${round(ind.sma20)}), so the distance to a logical stop is relatively small.`,
        trigger: `Only if price holds above ${round(ind.sma20)} on a closing basis and no earnings are within ${th.earningsWindowDays} days.`,
        invalidation: `Close below ${round(stopRef)} (lower of 20-day low and 50-day average).`,
        downside: `Trend failure; loss to the invalidation level would be about ${round(((price - stopRef) / price) * 100)}% from here.`,
        confidence: conf('low'), levels, sizing,
      });
    }
    return finish({
      action: 'HOLD', horizon: 'Days to weeks',
      reason: extended
        ? `Uptrend intact, but price is more than three daily ranges above its 20-day average (${round(ind.sma20)}), so adding here would mean a distant stop. A rise alone is not a reason to sell.`
        : `Uptrend intact: price above rising 20-day and 50-day averages.`,
      trigger: `Consider taking partial profits or tightening risk if it closes below ${round(ind.sma20)}; exit plan if it closes below ${round(stopRef)}.`,
      invalidation: `Close below ${round(stopRef)}.`,
      downside: `Pullback toward the 20-day average (${round(ind.sma20)}), about ${round(((price - ind.sma20) / price) * 100)}% below.`,
      confidence: conf('low'), levels,
      ...(nearSupport && !cashOk ? { note: 'Setup would qualify for a conditional add, but no confirmed available cash in this currency.' } : {}),
    });
  }

  return finish({
    action: 'WAIT', horizon: 'Days to weeks',
    reason: 'Mixed signals: price and its 20/50-day averages do not agree on a direction. No action is clearly better than doing nothing.',
    trigger: `Reduce on a close below ${round(stopRef)}; reconsider adding only after a close above ${round(ind.high20)} (20-day high) with available cash.`,
    invalidation: 'A clear break in either direction.', downside: `Range-bound chop; daily range about ${ind.atrPct?.toFixed(1)}%.`,
    confidence: conf('low'), levels,
  });

  function finish(a) {
    if (!cashOk && a.action === 'CONDITIONAL_ADD') a.action = 'WAIT';
    const cashNote = cashCcy.cash == null
      ? `Available ${pos.currency} cash is not recorded; adds are not considered.`
      : !cashCcy.cashConfirmed ? `Available ${pos.currency} cash (${cashCcy.cash}) is unconfirmed; adds are not considered until you confirm it.`
        : cashCcy.cash <= 0 ? `No available ${pos.currency} cash; adds would require new money, which is not assumed.` : null;
    return {
      ...out, ...a,
      notes: [...notes, ...ctxLines, ...(cashNote ? [cashNote] : []), ...(a.note ? [a.note] : [])],
      sources, dataAsOf: q?.quoteTime || null, trend, weightPct: weight,
      sizing: a.sizing || (a.action === 'CONDITIONAL_ADD' ? null : undefined),
      sizingStatus: risk.complete ? 'available' : `Personalised sizing withheld until the risk questions are answered (${risk.missing.length} unanswered).`,
    };
  }
}

function round(n, dp = 2) {
  return n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp;
}

// Fixed-fractional sizing from the user's own stated maximum loss per trade.
export function sizeTrade({ risk, portfolio, price, stop, currency }) {
  if (!risk.complete) return null;
  const rp = risk.profile;
  if (String(rp.usesBorrowing).toLowerCase().startsWith('y')) {
    // We still never assume margin is available for new buys.
  }
  const total = portfolio.combined?.total ?? null;
  if (total == null || !(stop < price)) return null;
  const fx = portfolio.combined.fxRate;
  const totalInCcy = currency === 'USD' ? total / fx : total;
  const maxLoss = totalInCcy * (Number(rp.maxLossPerTradePct) / 100);
  const perShareRisk = price - stop;
  const cash = portfolio.totals[currency].cash || 0;
  const byRisk = Math.floor(maxLoss / perShareRisk);
  const byCash = Math.floor(cash / price);
  const shares = Math.max(0, Math.min(byRisk, byCash));
  return {
    shares, currency,
    maxLoss: round(maxLoss), perShareRisk: round(perShareRisk), limitedBy: byCash < byRisk ? 'available cash' : 'max loss per trade',
    explanation: `Max loss ${rp.maxLossPerTradePct}% of portfolio ≈ ${round(maxLoss)} ${currency}; risk per share ${round(perShareRisk)} to stop ${round(stop)} → up to ${byRisk} shares; available cash allows ${byCash}.`,
  };
}

export function runAssessments(ctx, portfolio, { now = new Date() } = {}) {
  const { db, catalog } = ctx;
  const events = db.prepare('SELECT * FROM events WHERE date >= ? ORDER BY date').all(todayIn(NY, now));
  const news = db.prepare('SELECT * FROM news WHERE published_at >= ? ORDER BY published_at DESC').all(new Date(now - 5 * 86400000).toISOString())
    .map((n) => ({ ...n, symbols: JSON.parse(n.symbols_json) }));
  const results = [];
  for (const pos of portfolio.positions) {
    const inst = { symbol: pos.symbol, exchange: pos.exchange, currency: pos.currency, identity_status: pos.identityStatus };
    const entry = catalog.describeInstrument(inst);
    const a = assessPosition(ctx, pos, { portfolio, catalogEntry: entry, events, news, now });
    // Skip an identical repeat (same action and reasoning) within 30 minutes so
    // the history shows real changes, not every run.
    const last = db.prepare('SELECT created_at, payload_json FROM assessments WHERE instrument_id = ? ORDER BY id DESC LIMIT 1').get(pos.instrument_id);
    const lastA = last ? JSON.parse(last.payload_json) : null;
    const repeat = lastA && lastA.action === a.action && lastA.reason === a.reason && Math.abs(Date.parse(a.createdAt) - Date.parse(last.created_at)) < 30 * 60000;
    if (!repeat) {
      db.prepare('INSERT INTO assessments (instrument_id, created_at, action, horizon, payload_json, method) VALUES (?,?,?,?,?,?)')
        .run(pos.instrument_id, a.createdAt, a.action, a.horizon, JSON.stringify(a), a.method);
    }
    results.push(a);
  }
  return results;
}

export function latestAssessments(db) {
  return db.prepare(`SELECT payload_json FROM assessments WHERE id IN (SELECT MAX(id) FROM assessments GROUP BY instrument_id)`).all()
    .map((r) => JSON.parse(r.payload_json));
}

export { nextTradingDay };
