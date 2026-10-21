import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nyseHolidays, nyseEarlyCloses, VERIFIED_NYSE, briefingSlots, isTradingDay, sessionAt,
  tsxHolidays, nextTradingDay, dayInfo,
} from '../server/calendar.js';
import { zonedParts, zonedToUtc } from '../server/time.js';

test('NYSE rule engine matches the published 2026-2027 schedule', () => {
  for (const [year, exp] of Object.entries(VERIFIED_NYSE)) {
    assert.deepEqual(Object.keys(nyseHolidays(Number(year))).sort(), [...exp.holidays].sort(), `holidays ${year}`);
    assert.deepEqual(Object.keys(nyseEarlyCloses(Number(year))).sort(), [...exp.early].sort(), `early closes ${year}`);
  }
});

test('historic NYSE early closes and Saturday New Year are handled', () => {
  assert.ok(nyseEarlyCloses(2025)['2025-07-03']);
  assert.ok(nyseEarlyCloses(2024)['2024-07-03']);
  assert.ok(!nyseEarlyCloses(2020)['2020-07-02']); // Jul 4 on Saturday: no early close
  // 2022-01-01 was a Saturday: NYSE stayed open Friday 2021-12-31.
  assert.ok(isTradingDay('2021-12-31'));
  assert.ok(!isTradingDay('2025-01-09')); // special closure
});

test('briefings are skipped on holidays and weekends', () => {
  assert.equal(briefingSlots('2026-11-26').length, 0); // Thanksgiving
  assert.equal(briefingSlots('2026-10-24').length, 0); // Saturday
  assert.equal(briefingSlots('2026-07-03').length, 0); // observed Independence Day
});

function nyClock(d) {
  const p = zonedParts(d, 'America/New_York');
  return `${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

test('briefing times are 9:15, 10:30 and close-minus-one-hour in New York time', () => {
  const s = briefingSlots('2026-10-21');
  assert.deepEqual(s.map((x) => nyClock(x.at)), ['2026-10-21 09:15', '2026-10-21 10:30', '2026-10-21 15:00']);
});

test('early close moves the final briefing to noon', () => {
  const s = briefingSlots('2026-11-27');
  assert.equal(nyClock(s[2].at), '2026-11-27 12:00');
  assert.equal(s[2].earlyClose, true);
  assert.equal(nyClock(briefingSlots('2026-12-24')[2].at), '2026-12-24 12:00');
});

test('daylight-saving transitions keep New York wall-clock times', () => {
  // DST starts 2026-03-08, ends 2026-11-01.
  const before = briefingSlots('2026-03-06')[0].at;
  const after = briefingSlots('2026-03-09')[0].at;
  assert.equal(before.toISOString(), '2026-03-06T14:15:00.000Z'); // EST UTC-5
  assert.equal(after.toISOString(), '2026-03-09T13:15:00.000Z');  // EDT UTC-4
  assert.equal(briefingSlots('2026-10-30')[2].at.toISOString(), '2026-10-30T19:00:00.000Z');
  assert.equal(briefingSlots('2026-11-02')[2].at.toISOString(), '2026-11-02T20:00:00.000Z');
});

test('session classification', () => {
  assert.equal(sessionAt(zonedToUtc('2026-10-21', 8, 0)).session, 'pre');
  assert.equal(sessionAt(zonedToUtc('2026-10-21', 9, 30)).session, 'regular');
  assert.equal(sessionAt(zonedToUtc('2026-10-21', 15, 59)).session, 'regular');
  assert.equal(sessionAt(zonedToUtc('2026-10-21', 16, 0)).session, 'post');
  assert.equal(sessionAt(zonedToUtc('2026-10-21', 21, 0)).session, 'closed');
  assert.equal(sessionAt(zonedToUtc('2026-11-27', 13, 30)).session, 'post'); // early close
  assert.equal(sessionAt(zonedToUtc('2026-11-26', 11, 0)).session, 'closed');
});

test('TSX holidays differ from NYSE', () => {
  const h = tsxHolidays(2026);
  assert.ok(h['2026-05-18'], 'Victoria Day');
  assert.ok(h['2026-07-01'], 'Canada Day');
  assert.ok(h['2026-08-03'], 'Civic Holiday');
  assert.ok(h['2026-10-12'], 'Thanksgiving (Canada)');
  assert.ok(h['2026-12-28'], 'Boxing Day moved to Monday when Dec 26 is Saturday');
  assert.ok(!h['2026-11-26']);
  assert.equal(dayInfo('2026-11-26', 'TSX').open, true);
  assert.equal(dayInfo('2026-10-12', 'NYSE').open, true);
});

test('nextTradingDay skips long weekends', () => {
  assert.equal(nextTradingDay('2026-04-02'), '2026-04-06'); // Good Friday
  assert.equal(nextTradingDay('2026-12-24'), '2026-12-28');
});
