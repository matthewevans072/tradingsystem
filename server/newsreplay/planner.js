// The deterministic planners (CAMPAIGN-1.md section 5; experimental assumptions). A pure function of the input packet:
// no database handle, no clock, no store, no future data. D: R = the last trade before T (the last 5-minute close at
// or before T, else the previous daily close); m = the mean absolute daily close-to-close change over the 20 changes
// ending the previous session; bullish activation a 5-minute close at or above R + 0.5 m within 30 minutes of T,
// bearish a close at or below R - 0.5 m (exit if held, otherwise avoid entry; cancels a pending entry); otherwise no
// trade; invalidation (and sizing reference) R - 1.0 m on a daily close; time stop at the close of the 10th session
// after the fill; expiry at the end of the second session after T. DC: the same, but an item whose headline the fixed
// word rule classes negative disarms the bullish scenario. P (the price-only control): the same rules at the first
// bar close of a session without items. Wording never maps to a buy.
import { nextTradingDay } from '../calendar.js';

export const WINDOW_MS = 30 * 60000;
export const ACTIVATION_M = 0.5;
export const INVALIDATION_M = 1.0;
export const TIME_STOP_SESSIONS = 10;
export const M_CHANGES = 20;

export function typicalMoveOf(daily) {
  if (!daily || daily.length < M_CHANGES + 1) return null;
  const w = daily.slice(-(M_CHANGES + 1));
  let s = 0;
  for (let i = 1; i < w.length; i++) s += Math.abs(w[i].c - w[i - 1].c);
  return s / M_CHANGES;
}
export function referenceOf(packet) {
  const last = packet.prices.bars.at(-1);
  if (last) return { R: last.c, source: 'the last 5-minute close at or before T' };
  const d = packet.prices.daily.at(-1);
  return d ? { R: d.c, source: 'the previous session\'s close (no bar of T\'s session before T)' } : null;
}

const WORD = /[a-z]+/g;
export function classifyHeadline(text, words) {
  const w = new Set(String(text || '').toLowerCase().match(WORD) || []);
  const has = (list) => list.some((x) => w.has(x));
  const guidance = has(words.guidanceNouns);
  if ((guidance && has(words.lowerWords)) || has(words.negativeWords)) return 'negative';
  if ((guidance && has(words.raiseWords)) || has(words.positiveWords)) return 'positive';
  return 'neutral';
}

// The event category of a plan, for reporting only (CAMPAIGN-1.md section 3): an 8-K with item 2.02 first, then any
// other filing, then news; a control session has none.
export function categoryOf(items) {
  if (items.some((i) => i.kind === 'filing' && /^8-K/.test(i.form || '') && (i.filingItems || []).includes('2.02'))) return 'earnings_8k';
  if (items.some((i) => i.kind === 'filing')) return 'other_filing';
  if (items.some((i) => i.kind === 'news')) return 'news';
  return 'control';
}

export function deterministicPlan(packet, { variant = 'D', words = null, followUp = false } = {}) {
  if (variant === 'DC' && !words) throw new Error('the DC planner needs the frozen headline word list');
  const T = packet.asOf;
  const ref = referenceOf(packet);
  const m = typicalMoveOf(packet.prices.daily);
  const expiry = nextTradingDay(nextTradingDay(packet.session, 'NYSE'), 'NYSE');
  const base = {
    planner: variant, stock: packet.stock, session: packet.session, T, followUp, category: categoryOf(packet.items),
    facts: packet.control ? [{ text: `no eligible item about ${packet.stock} in this session or within three sessions either side (price-only control)`, sourceIds: [] }] : packet.items.map((i) => ({ text: `${i.kind} item published ${new Date(i.publishedMs).toISOString()}, eligible ${new Date(i.eligibleMs).toISOString()}${i.revised ? ' (possibly revised: headline and created time only)' : ''}`, sourceIds: [i.id] })),
    uncertainties: ['what the items mean is not interpreted by this planner beyond its fixed rules', 'whether a move in the first 30 minutes continues', 'news published before eligibility may already be in the price'],
    affected: { stock: packet.stock, why: packet.control ? 'price-only control session' : `${packet.items.length} newly eligible item(s) tagged ${packet.stock}` },
    entry: 'by the configuration\'s entry treatment (A immediate, B price-only pullback, C value-area pullback)',
    exit: { rule: `time stop at the close of the ${TIME_STOP_SESSIONS}th session after the fill`, sessions: TIME_STOP_SESSIONS },
    maxHoldingSessions: TIME_STOP_SESSIONS, expirySession: expiry, expiry: 'end of the second session after T',
    contradiction: 'a later eligible item on this stock with an opposite activation cancels a pending entry; a bearish activation exits a holding',
  };
  if (!ref || m == null || !(m > 0)) return { ...base, status: 'no_trade', reason: m == null ? 'the typical move needs 21 earlier daily closes' : 'no reference price before T', reference: ref, m, bullish: null, bearish: null, noTrade: 'no measurable levels' };
  const up = ref.R + ACTIVATION_M * m, down = ref.R - ACTIVATION_M * m;
  let armed = true, disarmedBy = [];
  if (variant === 'DC') {
    const classes = packet.items.map((i) => ({ id: i.id, cls: classifyHeadline(i.headline, words) }));
    disarmedBy = classes.filter((c) => c.cls === 'negative').map((c) => c.id);
    armed = disarmedBy.length === 0;
    base.headlineClasses = classes;
  }
  return {
    ...base, status: 'armed', reference: ref, m,
    bullish: { armed, disarmedBy, activation: { type: 'close_at_or_above', level: up, windowStartMs: T, windowEndMs: T + WINDOW_MS, barMinutes: 5 }, action: followUp ? 'none (a follow-up check only cancels or exits)' : 'enter long by the entry treatment' },
    bearish: { activation: { type: 'close_at_or_below', level: down, windowStartMs: T, windowEndMs: T + WINDOW_MS, barMinutes: 5 }, action: 'exit if held; otherwise avoid entry; cancels a pending entry of this stock' },
    noTrade: 'neither level reached by a 5-minute close within 30 minutes of T',
    invalidation: { level: ref.R - INVALIDATION_M * m, rule: 'a daily close below the level; exit at the next session\'s first bar open', sizingReference: true },
  };
}
