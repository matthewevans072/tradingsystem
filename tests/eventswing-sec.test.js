// event-swing's SEC EDGAR client and download (server/eventswing/sec.js, pipeline.js) against a fake EDGAR: the
// parsers, the refusals (no contact address, another host, a redirect, a filing after the bound, an undeclared-tool
// 403), the registrant check and an incomplete download. No request leaves this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { parseAtom, parseFilingIndex, pickExhibit, itemsFromDesc, createSecClient, assertSecUrl } from '../server/eventswing/sec.js';
import { downloadEvents, manifestOf, dataState } from '../server/eventswing/pipeline.js';
import { loadClassifier } from '../server/eventswing/config.js';
import * as store from '../server/eventswing/store.js';

const CL = loadClassifier();
const acc = (cik, n) => `${String(cik).padStart(10, '0')}-21-${String(n).padStart(6, '0')}`;
const idxUrl = (cik, a) => `https://www.sec.gov/Archives/edgar/data/${cik}/${a.replace(/-/g, '')}/${a}-index.htm`;
function atom(cik, name, entries, { typo = true } = {}) {
  const tagName = typo ? 'accession-nunber' : 'accession-number';
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><company-info><cik>${String(cik).padStart(10, '0')}</cik><conformed-name>${name}</conformed-name></company-info>${entries.map((e) => `<entry><content type="text/xml"><${tagName}>${e.accession}</${tagName}><filing-date>${e.date}</filing-date><filing-href>${idxUrl(cik, e.accession)}</filing-href><filing-type>${e.form}</filing-type>${e.items ? `<items-desc>${e.items}</items-desc>` : ''}</content></entry>`).join('')}</feed>`;
}
function indexHtml({ filingDate, accepted, period, items, exhibit = 'press.htm', exhibitType = 'EX-99.1', cik = 723125, accession }) {
  const dir = `/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}`;
  return `<html><div class="formGrouping"><div class="infoHead">Filing Date</div><div class="info">${filingDate}</div><div class="infoHead">Accepted</div><div class="info">${accepted}</div></div>
<div class="formGrouping"><div class="infoHead">Period of Report</div><div class="info">${period}</div></div>
<div class="formGrouping"><div class="infoHead">Items</div><div class="info">${items.map((i) => `Item ${i}: Something`).join('<br>')}</div></div>
<table class="tableFile" summary="Document Format Files"><tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
<tr><td scope="row">1</td><td scope="row">8-K</td><td scope="row"><a href="/ix?doc=${dir}/main.htm">main.htm</a></td><td scope="row">8-K</td><td scope="row">100</td></tr>
${exhibit ? `<tr class="blueRow"><td scope="row">2</td><td scope="row">PRESS RELEASE</td><td scope="row"><a href="${dir}/${exhibit}">${exhibit}</a></td><td scope="row">${exhibitType}</td><td scope="row">200</td></tr>` : ''}</table></html>`;
}
// A fake EDGAR: routes by URL; records every request.
function fakeEdgar(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, ua: opts.headers['User-Agent'], redirect: opts.redirect });
    const r = typeof routes === 'function' ? routes(url) : routes[url];
    if (!r) return { status: 404, type: 'basic', text: async () => 'not found' };
    return { status: r.status ?? 200, type: r.type ?? 'basic', text: async () => r.body ?? '' };
  };
  return { fetchImpl, calls };
}
const fast = { minIntervalMs: 0, sleep: async () => {} };

test('the parsers read the Atom feed (both accession spellings), the filing index (acceptance, period, items, documents) and pick the preferred exhibit', () => {
  const a1 = acc(723125, 40);
  const f = parseAtom(atom(723125, 'MICRON TECHNOLOGY INC', [{ accession: a1, date: '2021-12-20', form: '8-K', items: 'items 2.02 and 9.01' }]));
  assert.equal(f.companyName, 'MICRON TECHNOLOGY INC'); assert.equal(f.cik, 723125);
  assert.deepEqual(f.entries.map((e) => [e.accession, e.form, e.filingDate]), [[a1, '8-K', '2021-12-20']]);
  assert.equal(parseAtom(atom(1, 'X', [{ accession: acc(1, 1), date: '2020-01-02', form: '8-K' }], { typo: false })).entries[0].accession, acc(1, 1));
  assert.deepEqual(itemsFromDesc('items 2.02 and 9.01'), ['2.02', '9.01']); assert.equal(itemsFromDesc(null), null);
  const p = parseFilingIndex(indexHtml({ filingDate: '2021-12-20', accepted: '2021-12-20 16:08:12', period: '2021-12-20', items: ['2.02', '9.01'], accession: a1 }));
  assert.deepEqual([p.filingDate, p.acceptedEt, p.reportDate, p.items, p.problems], ['2021-12-20', '2021-12-20 16:08:12', '2021-12-20', ['2.02', '9.01'], []]);
  assert.equal(p.documents[0].href, `https://www.sec.gov/Archives/edgar/data/723125/${a1.replace(/-/g, '')}/main.htm`, 'an inline-XBRL viewer link is read as the plain document');
  const docs = [{ type: 'EX-99.2', href: 'b' }, { type: 'EX-99', href: 'c' }, { type: 'EX-99.1', href: 'a' }];
  assert.equal(pickExhibit(docs, CL.exhibitTypes).href, 'a');
  assert.equal(pickExhibit([{ type: 'EX-99.2', href: 'b' }], CL.exhibitTypes), null);
  assert.match(parseFilingIndex('<html></html>').problems.join(' '), /no acceptance date-time/);
});

test('the client refuses without a contact address (no request), calls only www.sec.gov, refuses redirects and reports an undeclared-tool 403', async () => {
  const fake = fakeEdgar({});
  assert.throws(() => createSecClient({ contactEmail: '', fetchImpl: fake.fetchImpl }), /SEC_CONTACT_EMAIL/);
  assert.equal(fake.calls.length, 0);
  assert.throws(() => assertSecUrl('https://data.alpaca.markets/v2/stocks/bars'), /www.sec.gov only/);
  assert.throws(() => assertSecUrl('https://www.sec.gov.evil.example/x'), /www.sec.gov only/);
  const redirect = fakeEdgar(() => ({ status: 301, body: '' }));
  const c1 = createSecClient({ contactEmail: 'owner@example.com', fetchImpl: redirect.fetchImpl, ...fast });
  await assert.rejects(c1.listEightK(723125), /redirect/);
  assert.equal(redirect.calls[0].redirect, 'manual');
  assert.match(redirect.calls[0].ua, /event-swing research owner@example\.com/);
  const blocked = fakeEdgar(() => ({ status: 403, body: '<title>Your Request Originates from an Undeclared Automated Tool</title>' }));
  await assert.rejects(createSecClient({ contactEmail: 'owner@example.com', fetchImpl: blocked.fetchImpl, ...fast }).listEightK(723125), /undeclared automated tool/);
});

test('the 8-K list is requested with EDGAR\'s date bound, keeps 8-K and 8-K/A from 2015, and refuses a filing dated after 2021-12-31', async () => {
  const entries = [{ accession: acc(723125, 3), date: '2021-12-20', form: '8-K', items: 'items 2.02' }, { accession: acc(723125, 2), date: '2018-03-22', form: '8-K/A' }, { accession: acc(723125, 9), date: '2017-01-01', form: '10-Q' }, { accession: acc(723125, 1), date: '2014-12-18', form: '8-K' }];
  const fake = fakeEdgar((url) => (url.includes('browse-edgar') ? { body: atom(723125, 'MICRON TECHNOLOGY INC', entries) } : null));
  const c = createSecClient({ contactEmail: 'owner@example.com', fetchImpl: fake.fetchImpl, ...fast });
  const r = await c.listEightK(723125);
  assert.match(fake.calls[0].url, /dateb=20211231/);
  assert.deepEqual(r.filings.map((f) => f.accession), [acc(723125, 3), acc(723125, 2)]);
  const late = fakeEdgar(() => ({ body: atom(723125, 'MICRON TECHNOLOGY INC', [{ accession: acc(723125, 7), date: '2022-01-05', form: '8-K' }]) }));
  await assert.rejects(createSecClient({ contactEmail: 'o@e.com', fetchImpl: late.fetchImpl, ...fast }).listEightK(723125), /after the bound 2021-12-31/);
});

test('a download stores the listing, the parsed 2.02 filings and their exhibits; skips filings whose items exclude 2.02; refuses a wrong registrant; an unreadable index leaves the download incomplete and stores nothing for it', async () => {
  const db = store.openEsDb(path.join(tempDir('es-'), 'event-swing.sqlite'));
  const ok1 = acc(723125, 11), ok2 = acc(723125, 12), not202 = acc(723125, 13), broken = acc(723125, 14);
  const routes = (url) => {
    if (url.includes('browse-edgar') && url.includes('CIK=0000723125')) return { body: atom(723125, 'MICRON TECHNOLOGY INC', [{ accession: ok1, date: '2021-06-30', form: '8-K', items: 'items 2.02 and 9.01' }, { accession: ok2, date: '2021-03-25', form: '8-K' }, { accession: not202, date: '2021-02-01', form: '8-K', items: 'items 5.02' }, { accession: broken, date: '2020-12-17', form: '8-K', items: 'items 2.02' }]) };
    if (url.includes('browse-edgar') && url.includes('CIK=0001018724')) return { body: atom(1018724, 'SOMEONE ELSE INC', [{ accession: acc(1018724, 1), date: '2021-02-02', form: '8-K', items: 'items 2.02' }]) };
    if (url === idxUrl(723125, ok1)) return { body: indexHtml({ filingDate: '2021-06-30', accepted: '2021-06-30 16:04:00', period: '2021-06-30', items: ['2.02', '9.01'], accession: ok1 }) };
    if (url === idxUrl(723125, ok2)) return { body: indexHtml({ filingDate: '2021-03-25', accepted: '2021-03-25 16:02:00', period: '2021-03-25', items: ['2.02'], accession: ok2, exhibit: null }) };
    if (url === idxUrl(723125, broken)) return { body: '<html>maintenance</html>' };
    if (url.endsWith('/press.htm')) return { body: '<p>We are raising our full-year guidance.</p>' };
    return null;
  };
  const fake = fakeEdgar(routes);
  const sec = createSecClient({ contactEmail: 'owner@example.com', fetchImpl: fake.fetchImpl, ...fast });
  const row = await downloadEvents({ db, sec, classifier: CL, symbols: ['MU', 'AMZN'] });
  assert.equal(row.status, 'incomplete');
  assert.match(row.summary.problems.join(' | '), new RegExp(`${broken}: no filing date`));
  assert.match(row.summary.problems.join(' | '), /AMZN: EDGAR names CIK 1018724 "SOMEONE ELSE INC", not the pinned registrant/);
  assert.equal(store.listListing(db, 'AMZN').length, 0, 'nothing stored for a wrong registrant');
  assert.deepEqual(store.listFilings(db).map((f) => f.accession).sort(), [ok1, ok2].sort());
  assert.ok(!fake.calls.some((c) => c.url === idxUrl(723125, not202)), 'a filing whose items exclude 2.02 is not fetched');
  assert.equal(store.getDocument(db, ok1).status, 'ok');
  assert.equal(store.getDocument(db, ok2).status, 'missing', 'no exhibit 99: recorded missing (no_text later)');
  assert.equal(dataState(db).complete, false);
  const m1 = manifestOf(db);
  assert.equal(m1.filings, 2);
  assert.ok(fake.calls.every((c) => c.url.startsWith('https://www.sec.gov/')));
  db.close();
});
