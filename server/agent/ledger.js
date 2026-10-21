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
  status: 'Data status',
};

export class Ledger {
  constructor() {
    this.items = [];
    this.byKey = new Map();
  }

  // Register a source; identical keys reuse the same ref.
  add({ key, kind, label, source = null, url = null, asOf = null, fetchedAt = null, freshness = null, symbol = null, tool = null, note = null }) {
    const k = key || `${kind}:${label}:${asOf}`;
    if (this.byKey.has(k)) return this.byKey.get(k).ref;
    const ref = `R${this.items.length + 1}`;
    const item = { ref, kind, label: String(label).slice(0, 300), source, url: safeUrl(url), asOf, fetchedAt, freshness, symbol, tool, note };
    this.items.push(item);
    this.byKey.set(k, item);
    return ref;
  }

  has(ref) {
    return this.items.some((i) => i.ref === ref);
  }

  get(ref) {
    return this.items.find((i) => i.ref === ref) || null;
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
