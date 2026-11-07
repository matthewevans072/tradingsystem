// news-forward's bounded downloads (PROTOCOL-1.md section 3): basket A's daily and 1-minute regular-session bars,
// news and corporate actions through server/hxr/source.js (Alpaca, SIP, raw; one host, redirects refused; the free
// plan's 16-minute delay applies), and the ten registrants' 8-K, 10-Q and 10-K filings through SEC EDGAR with the
// owner's SEC_CONTACT_EMAIL (never printed or stored). Nothing dated before 2026-10-22 is requested or stored. No
// headline or text is printed.
import { regularSessionBounds } from '../calendar.js';
import { zonedToUtc } from '../time.js';
import { parseAtom, parseFilingIndex } from '../eventswing/sec.js';
import { REGISTRANTS } from '../eventswing/config.js';
import { BASKET, NEWS_TICKER_ALIASES } from '../newsreplay/config.js';
import { etDate } from '../newsreplay/download.js';
import { WARMUP_FROM, NfError, assertForward } from './config.js';
import * as store from './store.js';

const nextDay = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const HANDLED = new Set(['forward_split', 'reverse_split', 'cash_dividend']);

export async function downloadDaily({ db, src, today, clock, symbols = BASKET }) {
  let stored = 0;
  for (const sym of symbols) {
    const from = store.lastDaily(db, sym) ? nextDay(store.lastDaily(db, sym)) : WARMUP_FROM;
    if (from > today) continue;
    assertForward(from, 'daily start');
    const rows = (await src.dailyBars(sym, { from, to: today })).filter((r) => r.date >= WARMUP_FROM);
    stored += store.insertDaily(db, sym, rows, clock().toISOString());
  }
  return { stored };
}

// 1-minute bars of the regular session from the last stored session (re-requested, since a session's bars arrive
// through the day) to today; rows already stored are kept as they are.
export async function downloadIntraday({ db, src, today, clock, from: fromFloor, symbols = BASKET }) {
  let stored = 0;
  for (const sym of symbols) {
    const from = store.lastBarDate(db, sym) ?? fromFloor;
    assertForward(from, 'intraday start');
    const bars = await src.intradayBars(sym, '1Min', { from, to: today });
    const rows = [];
    for (const x of bars) {
      if (x.date < WARMUP_FROM) continue;
      const b = regularSessionBounds(x.date);
      if (!b || x.ms < new Date(b.open).getTime() || x.ms >= new Date(b.close).getTime()) continue;
      rows.push({ date: x.date, minute: x.minutes, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, vw: x.vw });
    }
    stored += store.insertBars(db, sym, rows, clock().toISOString());
  }
  return { stored };
}

export async function downloadNews({ db, src, clock, from, symbols = BASKET }) {
  // Six hours of overlap with the newest stored item (an update that failed part-way loses nothing; duplicates are
  // ignored at insert), never before the start session.
  const last = store.lastNewsAt(db);
  const floorIso = new Date(zonedToUtc(from, 0, 0)).toISOString();
  const back = last ? new Date(Date.parse(last) - 6 * 3600000).toISOString() : floorIso;
  const startIso = back < floorIso ? floorIso : back;
  const rows = [];
  for (const sym of symbols) {
    const tags = [sym, ...(NEWS_TICKER_ALIASES[sym] || [])];
    for (const x of await src.news(tags, { start: startIso, createdFrom: startIso })) {
      if (x.created_at < WARMUP_FROM || etDate(Date.parse(x.created_at)) < from) continue;
      const basketSymbols = [...new Set(x.symbols.map((s) => Object.entries(NEWS_TICKER_ALIASES).find(([, al]) => al.includes(s))?.[0] ?? s).filter((s) => BASKET.includes(s)))];
      rows.push({ ...x, basketSymbols });
    }
  }
  return { stored: store.insertNews(db, rows, clock().toISOString()) };
}

export async function downloadCorporateActions({ db, src, clock, from, symbols = BASKET }) {
  const rows = (await src.corporateActions(symbols, { start: from })).filter((a) => symbols.includes(a.symbol) && a.ex_date && a.ex_date >= from);
  const handled = rows.filter((a) => HANDLED.has(a.type)).map((a) => ({ id: a.id, symbol: a.symbol, type: a.type, exDate: a.ex_date, payDate: a.pay_date, ratio: a.type === 'cash_dividend' ? null : (a.ratio_new && a.ratio_old ? a.ratio_new / a.ratio_old : null), amount: a.type === 'cash_dividend' ? a.rate : null }));
  const bad = handled.filter((a) => a.type !== 'cash_dividend' && !(a.ratio > 0));
  if (bad.length) throw new NfError(409, `a split without a usable ratio (${bad.map((a) => `${a.symbol} ${a.exDate}`).join(', ')}): the update stops`);
  const unhandled = rows.filter((a) => !HANDLED.has(a.type)).map((a) => `${a.symbol} ${a.type} ${a.ex_date}`);
  return { stored: store.insertCorp(db, handled, clock().toISOString()), unhandled };
}

// Filings: each registrant's 8-K, 10-Q and 10-K feed (newest first), stopping at the first page before `from`.
const FORMS = ['8-K', '10-Q', '10-K'];
export async function downloadFilings({ db, sec, clock, from, symbols = BASKET }) {
  const problems = [];
  let stored = 0;
  for (const sym of symbols) {
    const reg = REGISTRANTS[sym];
    const listed = [];
    for (const type of FORMS) {
      const r = await sec.get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(reg.cik).padStart(10, '0')}&type=${type}&owner=include&count=40&output=atom`);
      if (r.status !== 200) { problems.push(`${sym} ${type}: feed HTTP ${r.status}`); continue; }
      const feed = parseAtom(r.body);
      if (!reg.name.test(feed.companyName || '')) { problems.push(`${sym}: EDGAR names another registrant`); continue; }
      for (const e of feed.entries) if (e.filingDate >= from && (e.form === type || e.form === `${type}/A`)) listed.push(e);
    }
    const rows = [];
    for (const e of listed) {
      if (store.hasFiling(db, e.accession)) continue;
      const r = await sec.get(e.indexUrl);
      if (r.status !== 200) { problems.push(`${sym} ${e.accession}: index HTTP ${r.status}`); continue; }
      const p = parseFilingIndex(r.body, { indexUrl: e.indexUrl });
      const here = p.problems.filter((x) => !(x === 'no items' && /^10-[QK]/.test(e.form)));
      if (here.length) { problems.push(`${sym} ${e.accession}: ${here.join('; ')}`); continue; }
      rows.push({ accession: e.accession, symbol: sym, form: e.form, filingDate: p.filingDate, acceptedEt: p.acceptedEt, reportDate: p.reportDate, items: p.items });
    }
    stored += store.insertFilings(db, rows, clock().toISOString());
  }
  return { stored, problems };
}
