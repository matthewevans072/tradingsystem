// event-swing's events and classifier (server/eventswing/events.js) exactly as CAMPAIGN-1.md sections 3 and 4 define
// them: grouping, availability at the first close after acceptance (no look-ahead), the conservative delay for an
// unknown time, the pre-event session, timing classes, exclusions, the delay sensitivity, family A's estimates, and
// the word rule applied exactly as written. Synthetic filings and texts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { groupEvents, placeEvents, classifyRelease, estimatesFrom, delayEvents, reactionOf, reactionClass } from '../server/eventswing/events.js';
import { closeLookup } from '../server/eventswing/data.js';
import { loadClassifier, CAMPAIGN_PATH } from '../server/eventswing/config.js';
import { synthMarket, calendar } from './eventswing-fixtures.js';

const CL = loadClassifier();
let n = 0;
const filing = (symbol, acceptedEt, reportDate, { form = '8-K', items = ['2.02', '9.01'], filingDate = null } = {}) => ({ accession: `0000000000-16-${String(++n).padStart(6, '0')}`, symbol, form, acceptedEt, reportDate, filingDate: filingDate ?? acceptedEt?.slice(0, 10), items, status: 'ok' });

test('grouping: filings within 3 days form one event at the earliest report date and acceptance; amendments attach or are excluded; a report date after the acceptance is replaced and flagged; interim events', () => {
  const a = filing('AAA', '2016-07-28 16:30:00', '2016-07-28'), b = filing('AAA', '2016-07-28 16:05:00', '2016-07-28'), c = filing('AAA', '2016-07-30 09:00:00', '2016-07-30');
  const amend = filing('AAA', '2016-08-01 10:00:00', '2016-07-29', { form: '8-K/A' }), lone = filing('AAA', '2016-12-01 10:00:00', '2016-12-01', { form: '8-K/A' });
  const later = filing('AAA', '2016-08-20 08:00:00', '2016-08-20'), q = filing('AAA', '2016-10-27 16:01:00', '2016-10-28'), noRep = filing('AAA', '2017-01-26 16:02:00', null);
  const other = filing('AAA', '2016-09-01 08:00:00', '2016-09-01', { items: ['5.02'] });
  const { events, excluded } = groupEvents([a, b, c, amend, lone, later, q, noRep, other]);
  assert.deepEqual(events.map((e) => [e.D, e.acceptedEt, e.filings.length, e.amendments.length, e.interim, e.flags]), [
    ['2016-07-28', '2016-07-28 16:05:00', 3, 1, false, []],
    ['2016-08-20', '2016-08-20 08:00:00', 1, 0, true, []],
    ['2016-10-27', '2016-10-27 16:01:00', 1, 0, false, ['report_date_after_acceptance']],
    ['2017-01-26', '2017-01-26 16:02:00', 1, 0, false, ['no_report_date']],
  ]);
  assert.deepEqual(excluded.map((x) => [x.reason, x.accession]), [['amendment_only', lone.accession]]);
});

test('availability: an after-close acceptance is used at the next close, a pre-open or in-session one at that day\'s close, an acceptance at the close the next day; early closes and weekends; an unknown time waits one session', () => {
  const m = synthMarket({ from: '2016-01-04', to: '2016-12-30', syms: ['AAA'] });
  const place = (acceptedEt, D, extra = {}) => placeEvents([{ id: 'e', symbol: 'AAA', D, acceptedEt, filingDate: extra.filingDate ?? D, filings: ['x'] }], { calendar: m.sessions, stockSessions: m.stockSessions, listings: { AAA: '2016-01-04' } });
  const at = (acceptedEt, D, extra) => { const p = place(acceptedEt, D, extra).placed[0]; return [p.availDate, p.preDate, p.timing]; };
  assert.deepEqual(at('2016-07-28 16:05:00', '2016-07-28'), ['2016-07-29', '2016-07-27', 'after_close']);
  assert.deepEqual(at('2016-07-28 07:00:00', '2016-07-28'), ['2016-07-28', '2016-07-27', 'before_open']);
  assert.deepEqual(at('2016-07-28 11:00:00', '2016-07-28'), ['2016-07-28', '2016-07-27', 'during_session']);
  assert.deepEqual(at('2016-07-28 16:00:00', '2016-07-28'), ['2016-07-29', '2016-07-27', 'after_close'], 'at the close is not before it');
  assert.deepEqual(at('2016-11-25 13:30:00', '2016-11-25'), ['2016-11-28', '2016-11-23', 'after_close'], 'the day after Thanksgiving closes at 13:00');
  assert.deepEqual(at('2016-11-25 12:00:00', '2016-11-25'), ['2016-11-25', '2016-11-23', 'during_session']);
  assert.deepEqual(at('2016-07-29 17:00:00', '2016-07-29'), ['2016-08-01', '2016-07-28', 'after_close'], 'Friday evening: Monday');
  assert.deepEqual(at('2016-07-29 08:00:00', '2016-07-28'), ['2016-07-29', '2016-07-27', 'filed_after_report_date'], 'the pre-event session is before the report date, whatever the filing date');
  const unknown = place(null, '2016-07-28', { filingDate: '2016-07-28' }).placed[0];
  assert.deepEqual([unknown.availDate, unknown.timing, unknown.unknownTime], ['2016-07-29', 'unknown', true], 'an unknown time counts as the end of the filing date');
  // A stock without a bar on its availability session: its next session with a bar.
  delete m.days.get('2016-07-29').bars.AAA;
  m.stockSessions.AAA = m.sessions.filter((d) => m.days.get(d).bars.AAA);
  assert.equal(at('2016-07-28 16:05:00', '2016-07-28')[0], '2016-08-01');
});

test('exclusions: before the listing, no pre-event bar (kept for family A), after the window; events known before the first close are pre-window', () => {
  const m = synthMarket({ from: '2016-01-04', to: '2016-06-30', syms: ['AAA', 'NEW'], listed: { NEW: '2016-03-01' } });
  const args = { calendar: m.sessions, stockSessions: m.stockSessions, listings: { AAA: '2016-01-04', NEW: '2016-03-01' } };
  const r = placeEvents([
    { id: 'pre', symbol: 'AAA', D: '2015-10-22', acceptedEt: '2015-10-22 16:05:00', filings: ['1'] },
    { id: 'early', symbol: 'NEW', D: '2016-02-10', acceptedEt: '2016-02-10 16:05:00', filings: ['2'] },
    { id: 'first', symbol: 'NEW', D: '2016-03-01', acceptedEt: '2016-03-01 16:05:00', filings: ['3'] },
    { id: 'late', symbol: 'AAA', D: '2016-06-30', acceptedEt: '2016-06-30 16:05:00', filings: ['4'] },
    { id: 'ok', symbol: 'AAA', D: '2016-04-21', acceptedEt: '2016-04-21 16:05:00', filings: ['5'] },
  ], args);
  assert.deepEqual(r.prewindow.map((e) => e.id), ['pre']);
  assert.deepEqual(r.excluded.map((e) => [e.id, e.reason]), [['early', 'before_listing'], ['first', 'no_pre_event_bar'], ['late', 'after_window']]);
  assert.deepEqual(r.sleeveOnly.map((e) => [e.id, e.availDate]), [['first', '2016-03-02']]);
  assert.deepEqual(r.placed.map((e) => e.id), ['ok']);
  assert.deepEqual(delayEvents(r.placed, m.stockSessions).map((e) => e.availDate), ['2016-04-25']);
  const end = delayEvents([{ ...r.placed[0], availDate: '2016-06-30' }], m.stockSessions);
  assert.equal(end.length, 0, 'an event delayed past the last session leaves the window');
});

test('the reaction uses the pre-event close and the availability close only, in post-split units', () => {
  const m = synthMarket({ from: '2016-01-04', to: '2016-03-31', syms: ['AAA'], splits: [{ symbol: 'AAA', date: '2016-02-02', ratio: 2 }] });
  const e = { symbol: 'AAA', preDate: '2016-02-01', availDate: '2016-02-03' };
  const raw0 = m.days.get('2016-02-01').bars.AAA.c, raw1 = m.days.get('2016-02-03').bars.AAA.c;
  const R = reactionOf(e, closeLookup(m)('2016-02-03'));
  assert.ok(Math.abs(R - (raw1 / (raw0 / 2) - 1)) < 1e-12);
  assert.equal(reactionClass(-0.05), 'negative'); assert.equal(reactionClass(0.05), 'positive'); assert.equal(reactionClass(0.0499), 'neutral');
});

test('family A\'s estimates: D + 364 days (the same weekday), none from interim events, one dropped within 45 days of the previous', () => {
  const es = estimatesFrom([
    { id: 'a', symbol: 'AAA', D: '2016-07-28', interim: false, availDate: '2016-07-29' },
    { id: 'b', symbol: 'AAA', D: '2016-08-20', interim: true, availDate: '2016-08-22' },
    { id: 'c', symbol: 'AAA', D: '2016-08-30', interim: false, availDate: '2016-08-31' },
    { id: 'd', symbol: 'BBB', D: '2016-02-01', interim: false, availDate: '2016-02-02' },
  ]);
  assert.deepEqual(es.map((x) => [x.symbol, x.fromEvent, x.estimate]), [['BBB', 'd', '2017-01-30'], ['AAA', 'a', '2017-07-27']]);
  assert.equal(new Date('2017-07-27T00:00:00Z').getUTCDay(), new Date('2016-07-28T00:00:00Z').getUTCDay());
});

test('the classifier\'s word lists are exactly those of CAMPAIGN-1.md section 4', () => {
  const md = fs.readFileSync(CAMPAIGN_PATH, 'utf8');
  const listOf = (label) => { const line = md.split('\n').find((l) => l.includes(`${label}:`)); return [...line.slice(line.indexOf(':')).matchAll(/`([^`]+)`/g)].map((m) => m[1]); };
  assert.deepEqual(listOf('Guidance nouns'), CL.guidanceNouns);
  assert.deepEqual(listOf('Raise words'), CL.raiseWords);
  assert.deepEqual(listOf('Lower words'), CL.lowerWords);
  assert.deepEqual(listOf('Reaffirm words'), CL.reaffirmWords);
  const excl = md.split('\n').find((l) => l.includes('**excluded phrase**'));
  assert.deepEqual([...excl.slice(excl.indexOf('**excluded phrase**')).matchAll(/`([^`]+)`/g)].map((m) => m[1]), CL.excludedPhrases);
  assert.deepEqual([...excl.slice(0, excl.indexOf('**excluded phrase**')).matchAll(/`([^`]+)`/g)].map((m) => m[1]), CL.sentenceEnders);
});

test('the classifier applies the rule exactly: classes, sentence splitting, excluded phrases, tags, entities and dashes', () => {
  const cls = (t) => classifyRelease(t, CL).cls;
  assert.equal(cls('<p>We are raising our full-year outlook.</p>'), 'raised');
  assert.equal(cls('Company lowers guidance for the third quarter.'), 'lowered');
  assert.equal(cls('<div>The company reaffirmed its 2019 guidance.</div>'), 'reaffirmed');
  assert.equal(cls('We raised revenue guidance; we lowered our margin outlook.'), 'mixed', 'a semicolon ends a sentence: one raise and one lower sentence');
  assert.equal(cls('We raised and lowered guidance in one sentence'), 'mixed');
  assert.equal(cls('Actual results and our forecasts could differ materially because of reduced demand.'), 'none_detected', 'the forward-looking boilerplate is excluded');
  assert.equal(cls('Revenue increased 20% to a record.'), 'none_detected', 'no guidance noun');
  assert.equal(cls('We&#8217;re raising&nbsp;our outlook.'), 'raised');
  assert.equal(cls('<script>raise guidance</script><style>p{}</style><p>Quarterly results.</p>'), 'none_detected');
  assert.equal(cls('We expect revenue of $1.5 billion. Guidance is maintained.'), 'reaffirmed', 'a decimal point is not a sentence end');
  assert.equal(cls('We are withdrawing our guidance.'), 'lowered');
  assert.equal(cls('Outlook<br>raised'), 'none_detected', 'a line break ends the sentence');
  assert.equal(cls('An increase in the outlook'), 'none_detected', '"increase" is not a raise word; "increases" is');
  assert.equal(cls('Guidance increases'), 'raised');
  assert.equal(classifyRelease(null, CL).cls, 'no_text');
  assert.equal(classifyRelease('<p>   </p>', CL).cls, 'no_text');
  const c = classifyRelease('Outlook raised. Outlook raised. Guidance cut.', CL);
  assert.deepEqual([c.cls, c.r, c.l, c.a], ['mixed', 2, 1, 0]);
});

test('the calendar used for availability is the NYSE calendar (special closures included)', () => {
  const s = calendar('2018-12-03', '2018-12-07');
  assert.deepEqual(s, ['2018-12-03', '2018-12-04', '2018-12-06', '2018-12-07'], 'markets closed on 2018-12-05');
});
