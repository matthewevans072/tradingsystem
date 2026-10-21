// SEC EDGAR (official regulatory filings; free, no key). The SEC requires a
// descriptive User-Agent with a contact email and at most 10 requests/second.
import { getJson, ProviderError, RateLimiter } from './http.js';

const ITEM_LABELS = {
  '1.01': 'Entry into a material agreement',
  '1.02': 'Termination of a material agreement',
  '2.01': 'Completion of acquisition or disposition',
  '2.02': 'Results of operations (earnings)',
  '2.03': 'New material financial obligation',
  '2.05': 'Restructuring / exit costs',
  '2.06': 'Material impairment',
  '3.01': 'Delisting or listing-rule notice',
  '4.02': 'Prior financial statements should not be relied on',
  '5.02': 'Director or officer change',
  '7.01': 'Regulation FD disclosure',
  '8.01': 'Other material event',
};
const HIGH_ITEMS = new Set(['1.01', '2.01', '2.02', '2.06', '3.01', '4.02']);

export function createSec({ contactEmail, fetchImpl } = {}) {
  const limiter = new RateLimiter({ perMinute: 300 });
  let tickerMap = null;
  const headers = () => {
    if (!contactEmail) throw new ProviderError('auth', 'SEC EDGAR needs a contact email (SEC_CONTACT_EMAIL) for its required User-Agent');
    return { 'User-Agent': `SignalDesk personal research ${contactEmail}`, Accept: 'application/json' };
  };

  async function cikFor(symbol) {
    if (!tickerMap) {
      await limiter.take();
      const d = await getJson('https://www.sec.gov/files/company_tickers.json', { headers: headers(), fetchImpl, label: 'SEC EDGAR' });
      tickerMap = new Map(Object.values(d).map((r) => [String(r.ticker).toUpperCase(), String(r.cik_str).padStart(10, '0')]));
    }
    return tickerMap.get(symbol.toUpperCase().replace('.', '-')) || null;
  }

  return {
    id: 'sec',
    name: 'SEC EDGAR',
    async getFilings(symbol, sinceDate) {
      const cik = await cikFor(symbol);
      if (!cik) return []; // not an SEC registrant (e.g. many Canadian-only listings)
      await limiter.take();
      const d = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: headers(), fetchImpl, label: 'SEC EDGAR' });
      const r = d.filings?.recent;
      if (!r) return [];
      const out = [];
      const wanted = new Set(['8-K', '6-K', '10-Q', '10-K', '20-F', '40-F', 'S-1', 'SC 13D', 'SC 13G', '424B4']);
      for (let i = 0; i < r.form.length; i++) {
        if (r.filingDate[i] < sinceDate) break; // newest first
        if (!wanted.has(r.form[i])) continue;
        const acc = r.accessionNumber[i];
        const items = String(r.items?.[i] || '').split(',').map((x) => x.trim()).filter(Boolean);
        const labels = items.map((it) => ITEM_LABELS[it] || `Item ${it}`);
        const title = `${d.name}: ${r.form[i]}${labels.length ? ' — ' + labels.join('; ') : r.primaryDocDescription?.[i] ? ' — ' + r.primaryDocDescription[i] : ''}`;
        out.push({
          title,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}`,
          source_name: 'SEC EDGAR', source_type: 'filing',
          published_at: r.acceptanceDateTime?.[i] ? new Date(r.acceptanceDateTime[i]).toISOString() : `${r.filingDate[i]}T00:00:00Z`,
          event_at: r.reportDate?.[i] || null,
          summary: `${r.form[i]} filed ${r.filingDate[i]}${labels.length ? '. Items: ' + labels.join('; ') : ''}.`,
          related: [symbol.toUpperCase()],
          provider: 'SEC EDGAR', provider_id: acc,
          importance: items.some((it) => HIGH_ITEMS.has(it)) || ['10-Q', '10-K', '20-F', '40-F'].includes(r.form[i]) ? 3 : 2,
          status: 'confirmed',
          form: r.form[i], items,
        });
      }
      return out;
    },
  };
}
