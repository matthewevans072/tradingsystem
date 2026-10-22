// "Data used" ledger for one chat turn. Every record a tool returns gets a
// reference id (R1, R2…) with its kind, source and timestamps. The model cites
// these ids; the UI turns them into clickable sources and the "Data used" list.

export const REF_KINDS = {
  portfolio_record: 'Your records',
  market_data: 'Market data',
  news: 'News',
  filing: 'Regulatory filing',
  press_release: 'Company release',
  profile: 'Company/fund profile',
  event: 'Scheduled event',
  archived_report: 'Saved briefing (archived)',
  assessment: 'Saved assessment',
  calculation: 'Calculation by Signal Desk',
  // Strategy Lab results: a hypothetical account, never the owner's records or money.
  simulation: 'Strategy Lab (simulated)',
  status: 'Data status',
};

// What a trade or order record is. Set by the tool that read the record, never
// by the model; answers may only state a trade's status through a record that
// carries it (agent.js validateAnswer).
// - PROPOSED: a change proposed in chat (propose_record_change); its sub-state
//   is the proposal's status (pending, confirmed, rejected, expired, superseded).
// - SIMULATED: simulate_trade(s) scenarios and the Strategy Lab's hypothetical
//   account (backtests, forward test, orders, positions).
// - USER-REPORTED: a transaction in the owner's records, entered in the app,
//   imported from a CSV or saved after the owner confirmed a proposal. It comes
//   from the owner, not from a broker.
// - BROKER-CONFIRMED: reserved. Signal Desk has no broker connection, so no
//   record can have it; Ledger.add refuses it.
export const TRADE_STATUS = Object.freeze({
  PROPOSED: 'PROPOSED',
  SIMULATED: 'SIMULATED',
  USER_REPORTED: 'USER-REPORTED',
  BROKER_CONFIRMED: 'BROKER-CONFIRMED',
});
export const TRADE_STATUS_ORDER = [TRADE_STATUS.PROPOSED, TRADE_STATUS.SIMULATED, TRADE_STATUS.USER_REPORTED, TRADE_STATUS.BROKER_CONFIRMED];
const ISSUABLE = new Set([TRADE_STATUS.PROPOSED, TRADE_STATUS.SIMULATED, TRADE_STATUS.USER_REPORTED]);

export class Ledger {
  constructor() {
    this.items = [];
    this.byKey = new Map();
    this.next = 1;
  }

  // Register a source; identical keys reuse the same ref. A trade or order
  // record also gets tradeStatus, its recordId, a subState (a proposal's status,
  // where a simulated trade comes from), origin (how a transaction entered the
  // records), side (BUY, SELL…) and the symbols it covers. A Strategy Lab item
  // (kind simulation) is SIMULATED unless tradeStatus is given (null for items
  // that are not simulated trading, such as a config file or market data).
  add({ key, kind, label, source = null, url = null, asOf = null, fetchedAt = null, freshness = null, updating = null, symbol = null, tool = null, note = null,
    tradeStatus, recordId = null, subState = null, origin = null, side = null, symbols = null }) {
    const k = key || `${kind}:${label}:${asOf}`;
    if (this.byKey.has(k)) return this.byKey.get(k).ref;
    const status = tradeStatus === undefined ? (kind === 'simulation' ? TRADE_STATUS.SIMULATED : null) : tradeStatus;
    if (status === TRADE_STATUS.BROKER_CONFIRMED) throw new Error('BROKER-CONFIRMED is reserved: Signal Desk has no broker connection, so no record can be broker-confirmed.');
    if (status != null && !ISSUABLE.has(status)) throw new Error(`Unknown trade status ${status}`);
    const ref = `R${this.next++}`;
    const trade = status ? {
      tradeStatus: status,
      ...(recordId != null ? { recordId: String(recordId) } : {}), ...(subState ? { subState } : {}), ...(origin ? { origin } : {}), ...(side ? { side } : {}),
      ...(symbols?.length ? { symbols: [...new Set(symbols.filter(Boolean))] } : {}),
    } : {};
    const item = { ref, kind, label: String(label).slice(0, 300), source, url: safeUrl(url), asOf, fetchedAt, freshness, ...(updating === false ? { updating: false } : {}), symbol, tool, note, ...trade };
    this.items.push(item);
    this.byKey.set(k, item);
    return ref;
  }

  has(ref) {
    return this.items.some((i) => i.ref === ref);
  }

  // Forget refs that were never shown to the model (e.g. items cut from an
  // oversized tool result), so "Data used" lists only what was retrieved.
  remove(refs) {
    const drop = new Set(refs);
    this.items = this.items.filter((i) => !drop.has(i.ref));
    for (const [k, v] of this.byKey) if (drop.has(v.ref)) this.byKey.delete(k);
  }

  get(ref) {
    return this.items.find((i) => i.ref === ref) || null;
  }

  // The trade statuses of these refs' records, in TRADE_STATUS_ORDER.
  tradeStatuses(refs) {
    const found = new Set((refs || []).map((r) => this.get(r)?.tradeStatus).filter(Boolean));
    return TRADE_STATUS_ORDER.filter((s) => found.has(s));
  }

  toJSON() {
    return this.items;
  }
}

function safeUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
}

// Wrap third-party text so the model sees it as data, not instructions.
export function untrusted(text, max = 600) {
  if (text == null || text === '') return null;
  const clean = String(text)
    .replace(/<\/?\s*untrusted[^>]*>/gi, '[tag removed]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .slice(0, max);
  return { untrusted_text: clean };
}
