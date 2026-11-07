// news-replay's bounded downloads (the order's section 2). Prices only through server/hxr/source.js (Alpaca SIP,
// raw); news through the same client's news endpoint; company filings through SEC EDGAR with event-swing's parsers
// and the owner's SEC_CONTACT_EMAIL (never printed or stored); FOMC statements from federalreserve.gov. Every request
// is bounded at 2021-12-31 before it is sent, every row is checked again at insert (CHECK constraints) and at load.
// Nothing here is a strategy outcome; no headline or text is printed.
import { regularSessionBounds, isTradingDay } from '../calendar.js';
import { zonedToUtc } from '../time.js';
import { parseAtom, parseFilingIndex, assertSecUrl } from '../eventswing/sec.js';
import { REGISTRANTS } from '../eventswing/config.js';
import { MAX_DATE, DATA_FROM, BASKET, NEWS_TICKER_ALIASES, NrError, assertInBound } from './config.js';
import * as store from './store.js';

const etDate = (ms) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)); const g = (t) => p.find((x) => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`; };
export { etDate };
const monthsBetween = (from, to) => {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (;;) {
    const a = `${y}-${String(m).padStart(2, '0')}-01`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const s = a < from ? from : a, e = last > to ? to : last;
    if (s > to) break;
    out.push([s, e]);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
};

// 1-minute bars of the regular session (from the open to the close, early closes included), month by month.
export async function downloadIntraday({ db, src, symbols = BASKET, from = DATA_FROM, to = MAX_DATE, clock = () => new Date(), log = () => {} }) {
  assertInBound(to, 'intraday end');
  const out = {};
  for (const sym of symbols) {
    const startedAt = clock().toISOString();
    let stored = 0, kept = 0, dropped = 0;
    const done = new Set(store.barCoverage(db).filter((r) => r.symbol === sym).length ? store.barsFor(db, sym, { from, to }).map((b) => b.date) : []);
    for (const [a, b] of monthsBetween(from, to)) {
      const dates = []; for (let d = a; d <= b; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) if (isTradingDay(d, 'NYSE')) dates.push(d);
      if (dates.length && dates.every((d) => done.has(d))) continue;
      const bars = await src.intradayBars(sym, '1Min', { from: a, to: b });
      const rows = [];
      for (const x of bars) {
        if (x.date > MAX_DATE) throw new NrError(500, `Alpaca returned a bar dated ${x.date}, after the bound`);
        const bnd = regularSessionBounds(x.date);
        if (!bnd) { dropped++; continue; }
        if (x.ms < new Date(bnd.open).getTime() || x.ms >= new Date(bnd.close).getTime()) { dropped++; continue; }
        rows.push({ date: x.date, minute: x.minutes, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, n: x.n, vw: x.vw });
      }
      kept += rows.length;
      stored += store.insertBars(db, sym, rows);
    }
    store.insertDownload(db, { kind: 'intraday_1min', symbol: sym, from, to, startedAt, finishedAt: clock().toISOString(), status: 'complete', requests: null, summary: { kept, stored, droppedOutsideRegular: dropped } });
    log(`${sym}: 1-minute bars kept ${kept}, newly stored ${stored}`);
    out[sym] = { kept, stored };
  }
  return out;
}

// News for each basket stock (and its ticker of the time, FB for META), created from `from` to the bound.
export async function downloadNews({ db, src, symbols = BASKET, from = DATA_FROM, to = MAX_DATE, clock = () => new Date(), log = () => {} }) {
  assertInBound(to, 'news end');
  const startIso = new Date(zonedToUtc(from, 0, 0)).toISOString();
  const endIso = new Date(new Date(zonedToUtc(to, 23, 59)).getTime() + 59999).toISOString();
  const out = {};
  for (const sym of symbols) {
    const startedAt = clock().toISOString();
    const tags = [sym, ...(NEWS_TICKER_ALIASES[sym] || [])];
    const items = await src.news(tags, { start: startIso, end: endIso, createdFrom: startIso });
    const rows = [];
    let afterBound = 0;
    for (const x of items) {
      const ms = Date.parse(x.created_at);
      const d = etDate(ms);
      if (d > MAX_DATE) { afterBound++; continue; }
      if (d < from) continue;
      // The basket symbols an item is about, with the ticker of the time mapped to the basket's (FB -> META).
      const basketSymbols = [...new Set(x.symbols.map((s) => Object.entries(NEWS_TICKER_ALIASES).find(([, al]) => al.includes(s))?.[0] ?? s).filter((s) => BASKET.includes(s)))];
      rows.push({ ...x, createdEtDate: d, basketSymbols });
    }
    const stored = store.insertNews(db, rows, clock().toISOString());
    store.insertDownload(db, { kind: 'news', symbol: sym, from, to, startedAt, finishedAt: clock().toISOString(), status: 'complete', requests: null, summary: { items: rows.length, newlyStored: stored, refusedAfterBound: afterBound, tags } });
    log(`${sym}: news items ${rows.length} (newly stored ${stored})`);
    out[sym] = { items: rows.length, stored };
  }
  return out;
}

// Company filings (8-K, 10-Q, 10-K and their amendments) with acceptance times, through EDGAR's bounded company feed.
const FORMS = ['8-K', '10-Q', '10-K'];
export function createSecGet({ contactEmail, agent = 'news-replay', fetchImpl = globalThis.fetch, minIntervalMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!contactEmail || !/@/.test(contactEmail)) throw new NrError(409, 'SEC EDGAR needs SEC_CONTACT_EMAIL in .env; nothing was requested');
  let last = 0, requests = 0;
  const get = async (url) => {
    const u = assertSecUrl(url);
    const wait = last + minIntervalMs - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now(); requests++;
    const res = await fetchImpl(u, { headers: { 'User-Agent': `SignalDesk ${agent} research ${contactEmail}`, Accept: '*/*' }, redirect: 'manual' });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new NrError(502, 'SEC EDGAR answered with a redirect; refused');
    const body = await res.text();
    if (res.status === 403) throw new NrError(403, 'SEC EDGAR refused the request (HTTP 403)');
    if (res.status === 429) throw new NrError(429, 'SEC EDGAR rate limit (HTTP 429)');
    return { status: res.status, body };
  };
  return { get, get requests() { return requests; } };
}
export async function downloadFilings({ db, sec, symbols = BASKET, from = DATA_FROM, clock = () => new Date(), log = () => {} }) {
  const out = {}, problems = [];
  for (const sym of symbols) {
    const reg = REGISTRANTS[sym];
    const startedAt = clock().toISOString();
    const listed = [];
    for (const type of FORMS) {
      for (let page = 0; page < 10; page++) {
        const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(reg.cik).padStart(10, '0')}&type=${type}&dateb=${MAX_DATE.replace(/-/g, '')}&owner=include&count=100&start=${page * 100}&output=atom`;
        const r = await sec.get(url);
        if (r.status !== 200) { problems.push(`${sym} ${type}: feed HTTP ${r.status}`); break; }
        const feed = parseAtom(r.body);
        if (!reg.name.test(feed.companyName || '')) { problems.push(`${sym}: EDGAR names "${feed.companyName}", not the pinned registrant`); break; }
        for (const e of feed.entries) {
          if (e.filingDate > MAX_DATE) throw new NrError(500, `EDGAR returned a filing dated ${e.filingDate}, after the bound`);
          if (e.filingDate >= from && (e.form === type || e.form === `${type}/A`)) listed.push(e);
        }
        if (feed.entries.length < 100 || (feed.entries.at(-1)?.filingDate ?? '') < from) break;
      }
    }
    const rows = [];
    for (const e of listed) {
      if (store.hasFiling(db, e.accession)) continue;
      const r = await sec.get(e.indexUrl);
      if (r.status !== 200) { problems.push(`${sym} ${e.accession}: index HTTP ${r.status}`); continue; }
      const p = parseFilingIndex(r.body, { indexUrl: e.indexUrl });
      // 10-Q and 10-K filings carry no item list (only 8-Ks do): "no items" is not a problem for them.
      const problemsHere = p.problems.filter((x) => !(x === 'no items' && /^10-[QK]/.test(e.form)));
      if (problemsHere.length) { problems.push(`${sym} ${e.accession}: ${problemsHere.join('; ')}`); continue; }
      if (p.acceptedEt.slice(0, 10) > MAX_DATE) { problems.push(`${sym} ${e.accession}: accepted after the bound; refused`); continue; }
      rows.push({ accession: e.accession, symbol: sym, cik: reg.cik, form: e.form, filingDate: p.filingDate, acceptedEt: p.acceptedEt, reportDate: p.reportDate, items: p.items, indexUrl: e.indexUrl });
    }
    const stored = store.insertFilings(db, rows, clock().toISOString());
    store.insertDownload(db, { kind: 'filings', symbol: sym, from, to: MAX_DATE, startedAt, finishedAt: clock().toISOString(), status: problems.some((x) => x.startsWith(sym)) ? 'incomplete' : 'complete', requests: sec.requests, summary: { listed: listed.length, stored } });
    log(`${sym}: filings listed ${listed.length}, newly stored ${stored}`);
    out[sym] = { listed: listed.length, stored };
  }
  return { perSymbol: out, problems };
}

// FOMC statements from federalreserve.gov (context for the AI planner only in round 1).
const FED = 'https://www.federalreserve.gov';
export async function downloadFomc({ db, fetchImpl = globalThis.fetch, years = [2019, 2020, 2021], clock = () => new Date(), log = () => {} }) {
  const get = async (p) => { const res = await fetchImpl(`${FED}${p}`, { headers: { 'User-Agent': 'SignalDesk news-replay research (personal, non-commercial)' }, redirect: 'manual' }); if (res.status >= 300 && res.status < 400) throw new NrError(502, 'federalreserve.gov redirect refused'); return { status: res.status, body: await res.text() }; };
  const links = new Set();
  for (const page of [...years.map((y) => `/monetarypolicy/fomchistorical${y}.htm`), '/monetarypolicy/fomccalendars.htm']) {
    const r = await get(page);
    if (r.status !== 200) { log(`${page}: HTTP ${r.status}`); continue; }
    for (const m of r.body.matchAll(/\/newsevents\/pressreleases\/monetary(\d{8})a\.htm/g)) if (m[1].slice(0, 4) >= String(years[0]) && `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}` <= MAX_DATE) links.add(m[0]);
  }
  const rows = [];
  for (const link of [...links].sort()) {
    const d = link.match(/monetary(\d{8})a/)[1], date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    if (date < DATA_FROM || date > MAX_DATE) continue;
    const r = await get(link);
    if (r.status !== 200) { log(`${link}: HTTP ${r.status}`); continue; }
    const t = r.body.match(/For release at (\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)/i);
    const title = (r.body.match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    let releaseEt, timeKnown = false;
    if (t) { let h = Number(t[1]) % 12; if (/p/i.test(t[3])) h += 12; releaseEt = `${date} ${String(h).padStart(2, '0')}:${t[2]}:00`; timeKnown = true; }
    else releaseEt = `${date} 23:59:59`; // no stated release time: the end of the day (conservative)
    rows.push({ id: `fomc-${date}`, kind: 'fomc_statement', releaseEt, timeKnown, title, url: `${FED}${link}` });
  }
  const stored = store.insertFomc(db, rows, clock().toISOString());
  store.insertDownload(db, { kind: 'fomc', from: DATA_FROM, to: MAX_DATE, startedAt: clock().toISOString(), finishedAt: clock().toISOString(), status: 'complete', requests: links.size + years.length + 1, summary: { statements: rows.length, stored, withTime: rows.filter((x) => x.timeKnown).length } });
  log(`FOMC statements ${rows.length} (${rows.filter((x) => x.timeKnown).length} with a stated release time)`);
  return rows;
}
void regularSessionBounds;
