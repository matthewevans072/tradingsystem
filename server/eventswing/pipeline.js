// event-swing's data pipeline: the bounded EDGAR download into event-swing's own store, and the event set the
// campaign uses (grouped, placed, classified, with reactions and estimates), its inventory (counts only) and its
// manifest hash. A download that meets a filing it cannot read stops as incomplete and stores nothing for that
// filing, so a later run retries it; the campaign gate requires a complete download.
import crypto from 'node:crypto';
import { canonicalJson } from '../strategy/config.js';
import { REGISTRANTS, BASKET, MAX_DATE, EsError, assertInWindow } from './config.js';
import * as store from './store.js';
import { pickExhibit, itemsFromDesc } from './sec.js';
import { groupEvents, placeEvents, classifyRelease, reactionOf, estimatesFrom, inventoryOf } from './events.js';
import { closeLookup } from './data.js';

export async function downloadEvents({ db, sec, classifier, symbols = BASKET, clock = () => new Date(), log = () => {} }) {
  const startedAt = clock().toISOString();
  const summary = { perSymbol: {}, problems: [] };
  const at = () => clock().toISOString();
  outer: for (const sym of symbols) {
    const reg = REGISTRANTS[sym];
    if (!reg) throw new EsError(400, `${sym} is not a basket stock`);
    const s = (summary.perSymbol[sym] = { listed: 0, eightK: 0, indexesFetched: 0, with202: 0, documents: 0, missingExhibits: 0, skippedNot202: 0 });
    let list;
    try { list = await sec.listEightK(reg.cik); } catch (e) { summary.problems.push(`${sym}: ${e.message}`); log(`${sym}: ${e.message}`); if (e.status === 403 || e.status === 409 || e.status === 429) break outer; continue; }
    if (!reg.name.test(list.companyName || '') || (list.cik != null && list.cik !== reg.cik)) { summary.problems.push(`${sym}: EDGAR names CIK ${list.cik} "${list.companyName}", not the pinned registrant; nothing stored`); continue; }
    const rows = list.filings.map((f) => ({ accession: f.accession, symbol: sym, cik: reg.cik, form: f.form, filingDate: f.filingDate, itemsDesc: f.itemsDesc, indexUrl: f.indexUrl, companyName: list.companyName }));
    store.insertListing(db, rows, at());
    s.listed = rows.length; s.eightK = rows.length;
    for (const f of rows) {
      const items = itemsFromDesc(f.itemsDesc);
      if (items && !items.includes('2.02')) { s.skippedNot202++; continue; }
      if (!store.hasFiling(db, f.accession)) {
        let r;
        try { r = await sec.filingIndex(f.indexUrl); } catch (e) { summary.problems.push(`${sym} ${f.accession}: ${e.message}`); if (e.status === 403 || e.status === 429) break outer; continue; }
        s.indexesFetched++;
        if (r.status !== 200 || !r.parsed) { summary.problems.push(`${sym} ${f.accession}: index HTTP ${r.status}`); continue; }
        const p = r.parsed;
        if (p.problems.length) { summary.problems.push(`${sym} ${f.accession}: ${p.problems.join('; ')}`); continue; }
        try { assertInWindow(p.acceptedEt, 'acceptance'); assertInWindow(p.filingDate, 'filing date'); } catch (e) { summary.problems.push(`${sym} ${f.accession}: ${e.message}`); continue; }
        const ex = pickExhibit(p.documents, classifier.exhibitTypes);
        store.insertFiling(db, { accession: f.accession, symbol: sym, cik: reg.cik, form: f.form, filingDate: p.filingDate, acceptedEt: p.acceptedEt, reportDate: p.reportDate, items: p.items, exhibitType: ex?.type ?? null, exhibitUrl: ex?.href ?? null, documents: p.documents.map((d) => ({ seq: d.seq, type: d.type, href: d.href })), status: 'ok' }, at());
      }
      const filing = store.listFilings(db, sym).find((x) => x.accession === f.accession);
      if (!filing || !filing.items.includes('2.02')) continue;
      s.with202++;
      if (store.hasDocument(db, f.accession)) { s.documents++; continue; }
      if (!filing.exhibitUrl) { store.insertDocument(db, { accession: f.accession, url: null, status: 'missing', httpStatus: null, body: null }, at()); s.missingExhibits++; continue; }
      let d;
      try { d = await sec.document(filing.exhibitUrl); } catch (e) { summary.problems.push(`${sym} ${f.accession} exhibit: ${e.message}`); if (e.status === 403 || e.status === 429) break outer; continue; }
      if (d.status === 200) { store.insertDocument(db, { accession: f.accession, url: filing.exhibitUrl, status: 'ok', httpStatus: 200, body: d.body }, at()); s.documents++; }
      else if (d.status === 404 || d.status === 410) { store.insertDocument(db, { accession: f.accession, url: filing.exhibitUrl, status: 'missing', httpStatus: d.status, body: null }, at()); s.missingExhibits++; }
      else summary.problems.push(`${sym} ${f.accession} exhibit: HTTP ${d.status}`);
    }
    log(`${sym}: ${s.listed} 8-K listed, ${s.with202} with item 2.02, ${s.documents} exhibits stored, ${s.missingExhibits} without an exhibit`);
  }
  const complete = !summary.problems.length && symbols.every((sym) => summary.perSymbol[sym]?.listed > 0);
  const row = { startedAt, finishedAt: clock().toISOString(), status: complete ? 'complete' : 'incomplete', requests: sec.requests, summary: { ...summary, symbols } };
  store.insertDownload(db, row);
  return row;
}

// The manifest: every stored source record (listing, parsed index, exhibit digest), hashed canonically.
export function manifestOf(db) {
  const listing = store.listListing(db).map((r) => [r.accession, r.symbol, r.form, r.filing_date, r.items_desc ?? null]);
  const filings = store.listFilings(db).map((f) => [f.accession, f.symbol, f.form, f.filingDate, f.acceptedEt, f.reportDate, f.items, f.exhibitType, f.exhibitUrl]);
  const docs = store.documentDigests(db).map((d) => [d.accession, d.status, d.sha256]);
  const hash = crypto.createHash('sha256').update(canonicalJson({ method: 'es-manifest-1', listing, filings, docs })).digest('hex');
  return { hash, listing: listing.length, filings: filings.length, documents: docs.length, bound: MAX_DATE };
}

export function dataState(db) {
  const downloads = store.listDownloads(db);
  const last = downloads.at(-1) ?? null;
  return { downloads: downloads.length, last: last ? { status: last.status, finishedAt: last.finished_at, requests: last.requests, problems: last.summary?.problems?.slice(0, 20) ?? [] } : null, complete: last?.status === 'complete' };
}

// The event set of the campaign. universe: [{ symbol, listedFrom }].
export function buildEventSet({ db, inputs, classifier, matrix }) {
  const filings = store.listFilings(db).filter((f) => f.status === 'ok');
  const documents = new Map(store.documentDigests(db).map((d) => [d.accession, d]));
  const ev = matrix.shared.events;
  const grouped = groupEvents(filings, { groupDays: ev.groupDays, interimDays: ev.interimDays, documents });
  const listings = Object.fromEntries(inputs.symbols.map((s) => [s.symbol, s.listedFrom]));
  const placement = placeEvents(grouped.events, { calendar: inputs.sessions, stockSessions: inputs.stockSessions, listings });
  const classes = new Map();
  for (const e of placement.placed) {
    const doc = e.textAccession ? store.getDocument(db, e.textAccession) : null;
    classes.set(e.id, classifyRelease(doc?.status === 'ok' ? doc.body : null, classifier));
  }
  const closeAt = closeLookup(inputs);
  const reactions = new Map(placement.placed.map((e) => [e.id, reactionOf(e, closeAt(e.availDate))]));
  const withClass = (e) => ({ ...e, guidance: classes.get(e.id)?.cls ?? 'no_text', classifier: classes.get(e.id) ? { r: classes.get(e.id).r, l: classes.get(e.id).l, a: classes.get(e.id).a } : null });
  const placed = placement.placed.map(withClass);
  const estimates = estimatesFrom([...placement.prewindow, ...placement.sleeveOnly, ...placement.placed], { offsetDays: 364, minGapDays: ev.interimDays });
  const inventory = inventoryOf({ grouped, placement, reactions, classes, estimates, calendar: inputs.sessions, stockSessions: inputs.stockSessions, threshold: ev.reactionThreshold, symbols: inputs.symbols.map((s) => s.symbol) });
  return { placed, prewindow: placement.prewindow, sleeveOnly: placement.sleeveOnly, excluded: [...grouped.excluded, ...placement.excluded], reactions, inventory };
}

// The category counts each configuration's descriptive-only rule reads (matrix.categories; CAMPAIGN-1.md section 9).
export function descriptiveOnly(matrix, inventory) {
  const below = matrix.selection.descriptiveBelowEvents;
  return Object.fromEntries(Object.entries(matrix.categories).map(([id, cat]) => { const n = inventory.categories[cat] ?? 0; return [id, { category: cat, events: n, descriptiveOnly: n < below }]; }));
}
