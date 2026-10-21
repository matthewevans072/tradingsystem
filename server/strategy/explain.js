// Plain-English explanations of engine decisions, shared by the Strategy Lab
// page and the chat agent. Every sentence is built from the numbers in the
// engine's own records (ENGINE-SPEC §7); nothing is estimated here. Each
// function returns { text, points }: points are separate sentences, text joins them.
import { formatNy } from '../time.js';

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const px = (x, d = 2) => (fin(x) ? x.toFixed(d) : '—');
const px4 = (x) => (fin(x) ? x.toFixed(4) : '—'); // derived levels (stop, ATR, limits) are not on the tick grid
const money = (x) => (fin(x) ? `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');
const qty = (x) => (fin(x) ? Math.round(x).toLocaleString('en-US') : '—');
const times = (x, d = 2) => (fin(x) ? `${x.toFixed(d)}×` : '—');
const when = (t) => (t ? formatNy(t) : 'an unknown time');
const list = (ts) => (ts?.length ? ts.map((t) => formatNy(t).replace(/^\d{4}-/, '')).join(', ') : 'none recorded');
const out = (points) => {
  const p = points.filter(Boolean);
  return { text: p.join(' '), points: p };
};

const boxOf = (x) => x?.details?.box || x?.box || x;

export function whySetupQualifies(setup) {
  const b = boxOf(setup);
  if (!b || !fin(b.resistance)) return out(['No box details were recorded for this setup.']);
  const p = b.params || {};
  const A = b.atr, H = b.height ?? b.resistance - b.support;
  const tol = b.tolerance ?? (fin(p.touchToleranceAtr) ? p.touchToleranceAtr * A : null);
  const sym = setup?.symbol ? `${setup.symbol}: ` : '';
  return out([
    `${sym}the window is the ${p.lookbackBars ?? 'last'} completed bars from ${when(b.windowStart)} to ${when(b.windowEnd)}; the candle that may break out is never part of it.`,
    `Ceiling ${px(b.resistance)} (highest high) and floor ${px(b.support)} (lowest low) make a box ${px(H)} high, ${times(H / A)} the ATR(${p.atrLength ?? 14}) of ${px4(A)}, within the ${p.maxHeightAtr ?? '—'} × ATR maximum of ${px(p.maxHeightAtr * A)}${p.minHeightAtr > 0 ? ` and above the ${p.minHeightAtr} × ATR minimum of ${px(p.minHeightAtr * A)}` : ''}.`,
    `A touch is a high within ${px4(tol)} (${p.touchToleranceAtr ?? '—'} × ATR) of the ceiling or a low within ${px4(tol)} of the floor, counted only when at least ${p.minBarsBetweenTouches ?? '—'} bars separate it from the previous counted touch; ${p.minTouchesEach ?? '—'} are needed on each side.`,
    `The ceiling was touched ${b.touchesUpper} times (${list(b.upperTouchTimes)}) and the floor ${b.touchesLower} times (${list(b.lowerTouchTimes)}).`,
    `The setup became eligible and was frozen at the close of the ${when(b.eligibleAt)} bar: a close above ${px(b.resistance)} within ${p.setupExpiryBars ?? '—'} bars is the breakout, and a close below ${px(b.support)} cancels it.`,
  ]);
}

function parts(x) {
  const d = x?.details || {};
  return { symbol: x?.symbol, box: x?.box || d.box, signal: x?.signal || d.signal, plan: x?.plan || d.plan, entry: x?.entry || null };
}

export function whySignal(tradeOrEvent) {
  const { symbol, box, signal: s, plan: p, entry } = parts(tradeOrEvent);
  if (!s || !box) return out(['No signal details were recorded.']);
  const pts = [
    `At the close of the ${when(s.at)} bar, ${symbol ?? 'the stock'} closed at ${px(s.close)}, ${px(s.close - box.resistance)} above the frozen ceiling of ${px(box.resistance)}.`,
  ];
  if (fin(s.volumeRatio)) {
    pts.push(`Its volume of ${qty(s.volume)} shares was ${times(s.volumeRatio)} the average of the previous ${s.volumeLookbackBars ?? 20} bars (${qty(s.avgVolume)}); the rule needs more than ${s.volumeMultiple}×.`);
  }
  if (p) {
    pts.push(`Stop ${px4(p.stop)}: the breakout candle's low of ${px(s.low)} minus ${p.atrBuffer} × ATR (${px4(s.atr)}).`);
    pts.push(`Target ${px(p.target)}: the ceiling ${px(box.resistance)} plus ${p.targetMultiple} × the box height of ${px(box.height)}.`);
    pts.push(`Maximum entry ${px(p.maxEntry)}: the lower of the gap limit ${px4(p.gapLimit)} (close + ${p.maxGapAtr} × ATR) and the reward/risk limit ${px4(p.rrLimit)} (the highest open whose entry after spread and slippage still gives ${p.minRewardRisk}:1), rounded down to the tick; the ${p.binding === 'gap' ? 'gap' : 'reward/risk'} limit binds.`);
    if (fin(p.rewardRiskAtMaxEntry)) pts.push(`Reward/risk at the maximum entry: ${px(p.rewardRiskAtMaxEntry)}:1${entry && fin(entry.rewardRisk) ? `; at the actual fill of ${px4(entry.price)} it was ${px(entry.rewardRisk)}:1` : ''}.`);
    if (fin(p.costToRiskPct)) pts.push(`Estimated round-trip costs of ${px4(p.costPerShare)} per share are ${px(p.costToRiskPct, 1)}% of the ${px4(p.referenceRisk)} risk per share (limit ${p.maxCostToRiskPct}%).`);
    const z = p.sizing;
    if (z && fin(z.shares) && z.shares >= 1) {
      const by = z.sizedBy === 'cash' ? `the simulated cash available (${money(z.availableCash)})` : z.sizedBy === 'open_risk' ? `the room left under the open-risk limit (${money(z.openRoom)})` : `the per-trade risk budget (${money(z.riskBudget)})`;
      pts.push(`Size ${qty(z.shares)} shares, limited by ${by}: a worst-case loss of ${px4(z.worstLossPerShare)} per share at the maximum entry plus commissions, ${money(z.plannedRiskWorstCase)} in all, on simulated equity of ${money(z.equity)}.`);
    }
  }
  return out(pts);
}

const REASONS = {
  volume_unavailable: (e, d) => `volume was missing for ${d.missing ?? 'some'} of the ${d.signal?.volumeLookbackBars != null ? d.signal.volumeLookbackBars + 1 : 21} bars the volume rule needs (the breakout candle and the ${d.signal?.volumeLookbackBars ?? 20} before it), so the signal was skipped rather than guessed.`,
  volume_below_threshold: (e, d) => `its volume of ${qty(d.signal?.volume)} shares was only ${times(d.signal?.volumeRatio)} the ${d.signal?.volumeLookbackBars ?? 20}-bar average of ${qty(d.signal?.avgVolume)}; the rule needs more than ${d.signal?.volumeMultiple}×.`,
  beyond_target: (e, d) => `it closed at ${px(d.signal?.close)}, already at or beyond the target of ${px(d.plan?.target)}.`,
  max_entry_below_stop: (e, d) => `the highest acceptable entry (${px(d.plan?.maxEntry)}) was at or below the stop (${px4(d.plan?.stop)}).`,
  stop_not_positive: (e, d) => `the stop (${px4(d.plan?.stop)}) was not a positive price.`,
  stop_too_close: (e, d) => `the risk per share (${px4(d.plan?.referenceRisk)}) was below the minimum stop distance.`,
  costs_too_high: (e, d) => `estimated round-trip costs of ${px4(d.plan?.costPerShare)} per share were ${px(d.plan?.costToRiskPct, 1)}% of the ${px4(d.plan?.referenceRisk)} planned risk per share, above the ${d.plan?.maxCostToRiskPct}% limit.`,
  too_close_to_close: (e) => `${e.reason}.`,
  next_bar_new_session: () => 'the next bar would open in a new session, and the intraday version never holds overnight.',
  max_positions: (e, d) => `${d.plan?.sizing?.openPositionsAndOrders ?? 'the maximum number of'} simulated positions and pending orders were already open (maximum ${d.plan?.sizing?.maxPositions ?? '—'}); signals at the same close are taken in alphabetical order.`,
  open_risk_limit: (e, d) => `the open planned risk (${money(d.plan?.sizing?.openRisk)}) already used the combined risk limit on simulated equity of ${money(d.plan?.sizing?.equity)}.`,
  size_below_one_share: (e, d) => `${e.reason}, so the size was below one share.`,
  above_max_entry: (e, d) => `the next bar opened at ${px(d.open)}, above the maximum entry of ${px(d.maxEntry)} (gap limit ${px4(d.gapLimit)}, reward/risk limit ${px4(d.rrLimit)}; the ${d.binding === 'gap' ? 'gap' : 'reward/risk'} limit was binding).`,
  at_or_below_stop: (e, d) => `the next bar opened at ${px(d.open)}, at or below the stop of ${px4(d.stop)}.`,
  no_next_bar: (e, d) => `there was no next bar for the stock${d.expectedAt ? ` (expected ${when(d.expectedAt)})` : ''}, and the order is valid for that bar's open only.`,
  end_of_data: () => 'the data ended before the next bar, so the order lapsed.',
  insufficient_cash: (e) => `${e.reason}.`,
};

export function whyRejectedOrSkipped(event) {
  if (!event) return out(['No event.']);
  const d = event.details || {};
  const sym = event.symbol ?? 'The stock';
  if (event.type === 'setup_expired') return out([`${sym}'s box (ceiling ${px(d.resistance)}, floor ${px(d.support)}) expired at ${when(event.at)}: no candle closed above the ceiling within ${d.barsSinceEligible} bars of ${when(d.boxEligibleAt)}.`]);
  if (event.type === 'setup_invalidated') return out([`${sym}'s box was cancelled at ${when(event.at)}: the bar closed at ${px(d.close)}, below the floor of ${px(d.support)}.`]);
  const what = event.type === 'entry_skipped' ? `The simulated entry for the signal of the ${when(d.signalAt)} bar was skipped at ${when(event.at)}` : `The breakout candle of ${when(event.at)} was not traded`;
  const f = REASONS[d.code];
  return out([`${sym}: ${what}: ${f ? f(event, d) : `${event.reason}.`}`]);
}

const RESOLVED = {
  stop_first: 'the conservative stop-first assumption',
  target_first: 'the optimistic target-first assumption (a sensitivity check only)',
  lower_timeframe: 'the lower-timeframe bars, scanned in time order',
  lower_timeframe_stop_first: 'the lower-timeframe bars; one of them touched both, so stop first',
};

export function whatEnded(trade) {
  const x = trade?.exit, en = trade?.entry, p = trade?.plan;
  if (!x || !en) return out(['This trade has not been closed.']);
  const b = x.bar;
  const pts = [];
  const r = trade.pnl?.r;
  if (x.reason === 'stop' && x.gapThrough) {
    pts.push(`At ${when(x.at)} the stock opened at ${px(x.raw)}, below the stop of ${px4(p?.stop)}: the stop filled at the open, ${px4(x.price)} after spread and slippage.${fin(r) && r < -1 ? ` The loss of ${px(-r)}R is ${px(-r - 1)}R more than the planned risk.` : ''}`);
  } else if (x.reason === 'target' && x.gapThrough) {
    pts.push(`At ${when(x.at)} the stock opened at ${px(x.raw)}, at or above ${px(x.targetTrigger)} (one tick through the target ${px(p?.target)}): the target filled at the open.`);
  } else if (x.reason === 'stop' || x.reason === 'target') {
    if (x.ambiguous) {
      const how = x.resolvedBy === 'tv_path'
        ? `TradingView's assumed path: the open ${px(b?.o)} was nearer the ${x.reason === 'target' ? `high, so the high came first` : 'low, so the low came first'}`
        : RESOLVED[x.resolvedBy] || x.resolvedBy;
      pts.push(`The ${when(x.at)} bar reached both the stop (low ${px(b?.l)} at or below ${px4(p?.stop)}) and the target (high ${px(b?.h)} at or above ${px(x.targetTrigger)}). A 15-minute bar does not show which came first; it was resolved by ${how}${x.note ? ` (${x.note})` : ''}, giving a ${x.reason} exit.`);
    }
    if (x.reason === 'stop') pts.push(`The stop at ${px4(p?.stop)} was hit${b ? ` (the bar's low was ${px(b.l)})` : ''}; it filled at ${px4(x.price)} after spread and slippage.`);
    else pts.push(`The high${b ? ` of ${px(b.h)}` : ''} traded at least one tick through the target of ${px(p?.target)} (needs ${px(x.targetTrigger)}); the resting limit filled at the target with no spread or slippage.`);
  } else if (x.reason === 'flatten' || x.reason === 'max_hold') {
    const why = x.reason === 'flatten' ? 'Intraday positions are closed before the session ends' : `The position reached its maximum holding period of ${trade.holdSessions} sessions (the entry session counts as session 1)`;
    pts.push(`${why}: a market order placed at the close of the ${when(x.orderPlacedAt)} bar filled at the next bar's open of ${px(x.raw)} (${when(x.at)}), ${px4(x.price)} after spread and slippage.`);
  } else if (x.reason === 'session_end_fallback') {
    pts.push(`The time exit could not fill inside the session (a bar was missing), so the position was closed at the last available close of ${px(x.raw)} (${px4(x.price)} after spread and slippage) and flagged. ${x.note || ''}`.trim());
  } else if (x.reason === 'end_of_data') {
    pts.push(`The position was still open when the data ended, so it was closed at the last close of ${px(x.raw)} (${when(x.at)}) and flagged end of data; such trades count in P/L but not in per-trade statistics.`);
  } else pts.push(`Exit: ${x.reason}.`);
  if (trade.pnl) {
    pts.push(`Entered ${qty(en.shares)} shares at ${px4(en.price)} on ${when(en.at)}; ${trade.pnl.net >= 0 ? 'gain' : 'loss'} of ${money(Math.abs(trade.pnl.net))} after ${money(trade.pnl.costs)} of costs (${px(r)}R on a planned risk of ${money(en.plannedRisk)}), held ${trade.holdBars} bar${trade.holdBars === 1 ? '' : 's'} over ${trade.holdSessions} session${trade.holdSessions === 1 ? '' : 's'}. Simulated.`);
  }
  return out(pts);
}
