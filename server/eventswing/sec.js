// SEC EDGAR client for event-swing (DATA-INVENTORY.md section 3; CAMPAIGN-1.md section 3.1). One host
// (https://www.sec.gov), no redirects followed (a redirect is an error), a declared client that carries the owner's
// contact address from .env (SEC_CONTACT_EMAIL, required by SEC's fair-access policy; never printed or logged), at
// most one request every 250 ms. Bounded at the source: the company 8-K list is requested with EDGAR's own date
// bound (dateb = 2021-12-31), and a filing dated after the bound is refused before its index or documents are
// requested. Public filings only; nothing here touches market data, holdings, cash or orders.
import { SEC_ORIGIN, SEC_MIN_INTERVAL_MS, SEC_DATEB, MAX_DATE, WINDOW, EsError } from './config.js';

export function assertSecUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new EsError(400, `not a URL: ${String(url).slice(0, 80)}`); }
  if (u.origin !== SEC_ORIGIN || u.username || u.password) throw new EsError(400, `event-swing calls ${SEC_ORIGIN} only (refused ${u.origin})`);
  return u.toString();
}

const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();
const tag = (xml, name) => { const m = String(xml).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : null; };

// The company browse feed (Atom): the company's name and its filings, newest first. EDGAR spells one element
// "accession-nunber"; both spellings are read, and the accession is checked against the filing's index URL.
export function parseAtom(xml) {
  const text = String(xml);
  if (!/<feed[\s>]/i.test(text)) throw new EsError(502, 'EDGAR did not return an Atom feed');
  const info = text.match(/<company-info>([\s\S]*?)<\/company-info>/i)?.[1] ?? '';
  const companyName = tag(info, 'conformed-name');
  const cik = Number(tag(info, 'cik'));
  const entries = [];
  for (const m of text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const e = m[1];
    const form = tag(e, 'filing-type');
    const filingDate = tag(e, 'filing-date');
    const indexUrl = tag(e, 'filing-href');
    const accession = tag(e, 'accession-number') || tag(e, 'accession-nunber') || (indexUrl?.match(/(\d{10}-\d{2}-\d{6})-index\.htm/)?.[1] ?? null);
    if (!form || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate || '') || !indexUrl || !/^\d{10}-\d{2}-\d{6}$/.test(accession || '')) throw new EsError(502, `EDGAR feed entry cannot be read (form ${form}, date ${filingDate}, accession ${accession})`);
    entries.push({ form, filingDate, indexUrl, accession, itemsDesc: tag(e, 'items-desc') });
  }
  return { companyName, cik: Number.isFinite(cik) ? cik : null, entries };
}

// Items named in the feed's description ("items 2.02 and 9.01"): null when the feed gives none.
export const itemsFromDesc = (desc) => (desc == null || desc === '' ? null : [...String(desc).matchAll(/\b(\d{1,2}\.\d{2})\b/g)].map((m) => m[1]));

// The filing's index page: filing date, acceptance (Eastern, to the second), period of report, items and documents.
export function parseFilingIndex(html, { indexUrl = null } = {}) {
  const text = String(html);
  const info = {};
  for (const m of text.matchAll(/<div class="infoHead">\s*([^<]+?)\s*<\/div>\s*<div class="info">([\s\S]*?)<\/div>/gi)) info[m[1].trim().toLowerCase()] = m[2];
  const filingDate = decode(info['filing date'] ?? '') || null;
  const accepted = decode(info.accepted ?? '') || null;
  const period = decode(info['period of report'] ?? '') || null;
  const items = [...String(info.items ?? '').matchAll(/Item\s+(\d{1,2}\.\d{2})/gi)].map((m) => m[1]);
  const table = text.match(/<table[^>]*class="tableFile"[^>]*summary="Document Format Files"[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? text.match(/<table[^>]*summary="Document Format Files"[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? '';
  const documents = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const href = cells[2].match(/href="([^"]+)"/i)?.[1] ?? null;
    const plainHref = href ? href.replace(/^\/ix\?doc=/, '') : null;
    documents.push({ seq: decode(cells[0].replace(/<[^>]+>/g, '')), description: decode(cells[1].replace(/<[^>]+>/g, '')), href: plainHref ? new URL(plainHref, SEC_ORIGIN).toString() : null, type: decode(cells[3].replace(/<[^>]+>/g, '')) });
  }
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filingDate || '')) problems.push('no filing date');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(accepted || '')) problems.push('no acceptance date-time');
  if (period != null && !/^\d{4}-\d{2}-\d{2}$/.test(period)) problems.push(`period of report unreadable (${period})`);
  if (!items.length) problems.push('no items');
  return { indexUrl, filingDate, acceptedEt: accepted, reportDate: period, items, documents, problems };
}

// The exhibit 99 to read (CAMPAIGN-1.md section 3.1): the first document of the first preferred type, in order.
export function pickExhibit(documents, exhibitTypes) {
  for (const t of exhibitTypes) {
    const d = (documents || []).find((x) => String(x.type).toUpperCase() === t.toUpperCase() && x.href);
    if (d) return d;
  }
  return null;
}

export function createSecClient({ contactEmail, fetchImpl = globalThis.fetch, minIntervalMs = SEC_MIN_INTERVAL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  if (!contactEmail || !/@/.test(contactEmail)) throw new EsError(409, 'SEC EDGAR refuses undeclared automated clients: set SEC_CONTACT_EMAIL in .env (the owner\'s contact address; it is never printed) and run again. Nothing was requested.');
  const userAgent = `SignalDesk event-swing research ${contactEmail}`;
  let last = 0, requests = 0;
  async function get(url, { accept = '*/*' } = {}) {
    const u = assertSecUrl(url);
    const wait = last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    requests++;
    let res;
    try { res = await fetchImpl(u, { headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': 'gzip, deflate' }, redirect: 'manual' }); } catch (e) { throw new EsError(502, `SEC EDGAR unreachable: ${e.message}`); }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new EsError(502, `SEC EDGAR answered with a redirect (${res.status}); redirects are refused`);
    const body = await res.text();
    if (res.status === 403) throw new EsError(403, /undeclared automated tool/i.test(body) ? 'SEC EDGAR refused the request as an undeclared automated tool (HTTP 403)' : 'SEC EDGAR refused the request (HTTP 403)');
    if (res.status === 429) throw new EsError(429, 'SEC EDGAR rate limit reached (HTTP 429); wait ten minutes and run again');
    return { status: res.status, body };
  }
  // Every 8-K and 8-K/A of the registrant filed on or before the bound, back to `since`. The feed is paged with
  // EDGAR's own date bound, so no later filing is returned; a later one would be refused here anyway.
  async function listEightK(cik, { since = WINDOW.eventsFrom, pageSize = 100, maxPages = 20 } = {}) {
    let companyName = null, feedCik = null;
    const out = [];
    for (let page = 0; page < maxPages; page++) {
      const url = `${SEC_ORIGIN}/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, '0')}&type=8-K&dateb=${SEC_DATEB}&owner=include&count=${pageSize}&start=${page * pageSize}&output=atom`;
      const r = await get(url, { accept: 'application/atom+xml' });
      if (r.status !== 200) throw new EsError(502, `SEC EDGAR feed for CIK ${cik}: HTTP ${r.status}`);
      const feed = parseAtom(r.body);
      companyName ??= feed.companyName; feedCik ??= feed.cik;
      for (const e of feed.entries) {
        if (e.filingDate > MAX_DATE) throw new EsError(500, `EDGAR returned a filing dated ${e.filingDate}, after the bound ${MAX_DATE}: refused, nothing stored`);
        if (e.filingDate < since) continue;
        if (e.form !== '8-K' && e.form !== '8-K/A') continue;
        out.push(e);
      }
      const oldest = feed.entries.at(-1)?.filingDate;
      if (feed.entries.length < pageSize || (oldest && oldest < since)) return { companyName, cik: feedCik, filings: out, pages: page + 1 };
    }
    throw new EsError(502, `SEC EDGAR feed for CIK ${cik} did not end within ${maxPages} pages`);
  }
  async function filingIndex(indexUrl) {
    const r = await get(indexUrl, { accept: 'text/html' });
    if (r.status !== 200) return { status: r.status, parsed: null };
    return { status: 200, parsed: parseFilingIndex(r.body, { indexUrl }) };
  }
  async function document(url) {
    const r = await get(url, { accept: 'text/html, text/plain' });
    return { status: r.status, body: r.status === 200 ? r.body : null };
  }
  return { listEightK, filingIndex, document, get requests() { return requests; } };
}
