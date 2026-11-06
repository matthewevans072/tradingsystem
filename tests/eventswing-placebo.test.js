// The date-clustered event placebo (server/eventswing/placebo.js, CAMPAIGN-1.md section 9) on synthetic sessions:
// same-date events move together, no placebo date near a real event, a stock's placebo events stay apart, distances
// and spell lengths are kept, the stream is deterministic, an impossible draw fails, and the p-value formula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventPlaceboDrawer, spellPlaceboDrawer, mulberry32, pValue } from '../server/eventswing/placebo.js';
import { lowerBound } from '../server/eventswing/events.js';
import { calendar, ev } from './eventswing-fixtures.js';

const cal = calendar('2016-01-04', '2019-12-31');
const ss = { AAA: cal, BBB: cal, CCC: cal.filter((d) => d >= '2016-06-01') };
const I = (s, d) => lowerBound(ss[s], d);
const realEvents = [];
for (let i = 60; i < cal.length - 5; i += 63) {
  realEvents.push(ev('AAA', { avail: cal[i], pre: cal[i - 1], D: cal[i - 1], guidance: 'raised' }));
  realEvents.push(ev('BBB', { avail: cal[i], pre: cal[i - 2], D: cal[i - 1] })); // the same availability date as AAA's
  if (cal[i] > '2016-09-01') realEvents.push(ev('CCC', { avail: cal[i + 7], pre: cal[i + 6], D: cal[i + 6] }));
}

test('events sharing an availability date move together; each lands on an eligible session away from every real event, keeps its distance and its guidance, and a stock\'s placebo events stay 30 sessions apart', () => {
  const d = eventPlaceboDrawer({ events: realEvents, stockSessions: ss });
  assert.ok(d.multiStockClusters > 0);
  const rng = mulberry32(20261106);
  for (let r = 0; r < 25; r++) {
    const { events, failed } = d.draw(rng);
    assert.equal(failed, false);
    assert.equal(events.length, realEvents.length);
    const byOrig = new Map(events.map((e) => [e.id.replace('#placebo', ''), e]));
    for (const e of realEvents) {
      const p = byOrig.get(e.id);
      assert.equal(I(e.symbol, p.availDate) - I(e.symbol, p.preDate), I(e.symbol, e.availDate) - I(e.symbol, e.preDate), 'the pre-event distance is kept');
      assert.equal(p.guidance, e.guidance);
      const i = I(e.symbol, p.availDate);
      assert.ok(i >= 21 && i <= ss[e.symbol].length - 2);
      for (const x of realEvents.filter((y) => y.symbol === e.symbol)) for (const dd of [x.availDate, x.D]) assert.ok(Math.abs(i - I(e.symbol, dd)) > 30, `${p.availDate} is near the real ${dd}`);
    }
    for (let k = 0; k < realEvents.length; k++) if (realEvents[k].symbol === 'AAA') assert.equal(byOrig.get(realEvents[k].id).availDate, byOrig.get(realEvents[k + 1].id).availDate, 'AAA and BBB moved together');
    for (const s of ['AAA', 'BBB', 'CCC']) {
      const idx = events.filter((e) => e.symbol === s).map((e) => I(s, e.availDate)).sort((a, b) => a - b);
      for (let k = 1; k < idx.length; k++) assert.ok(idx[k] - idx[k - 1] >= 30);
    }
  }
});

test('the placebo stream is deterministic for its seed, and an impossible draw fails instead of bending the rules', () => {
  const a = eventPlaceboDrawer({ events: realEvents, stockSessions: ss }), b = eventPlaceboDrawer({ events: realEvents, stockSessions: ss });
  const ra = mulberry32(7), rb = mulberry32(7);
  for (let r = 0; r < 5; r++) assert.deepEqual(a.draw(ra), b.draw(rb));
  const short = { AAA: cal.slice(0, 60) }; // every session from 21 to 58 lies within 30 of the real event at 30
  const dense = [ev('AAA', { avail: short.AAA[30], pre: short.AAA[29] })];
  const r = eventPlaceboDrawer({ events: dense, stockSessions: short }).draw(mulberry32(1));
  assert.equal(r.failed, true); assert.match(r.reason, /no eligible date/);
});

test('family A\'s spells keep their length, avoid every real event by 10 sessions, move together when they start on one date, and become forced spells with the exit decided the session before', () => {
  const spells = [{ symbol: 'AAA', x: cal[100], y: cal[106] }, { symbol: 'BBB', x: cal[100], y: cal[103] }, { symbol: 'AAA', x: cal[400], y: cal[415] }];
  const d = spellPlaceboDrawer({ spells, realEvents, stockSessions: ss, calendar: cal });
  const rng = mulberry32(3);
  for (let r = 0; r < 20; r++) {
    const { forced, failed } = d.draw(rng);
    assert.equal(failed, false);
    assert.equal(forced.AAA.length, 2); assert.equal(forced.BBB.length, 1);
    const aFirst = forced.AAA.find((f) => I('AAA', f.reentryDecision) - I('AAA', cal[lowerBound(cal, f.exitDecision) + 1]) === 6);
    assert.ok(aFirst, 'the 6-session spell kept its length');
    assert.equal(cal[lowerBound(cal, aFirst.exitDecision) + 1], cal[lowerBound(cal, forced.BBB[0].exitDecision) + 1], 'spells starting on one date move together');
    for (const f of [...forced.AAA, ...forced.BBB]) {
      const sym = forced.AAA.includes(f) ? 'AAA' : 'BBB';
      const x = lowerBound(cal, f.exitDecision) + 1, y = I(sym, f.reentryDecision);
      for (const e of realEvents.filter((z) => z.symbol === sym)) for (const dd of [e.availDate, e.D]) { const j = I(sym, dd); assert.ok(j < x - 10 || j > y + 10); }
    }
  }
  assert.equal(pValue(0, 2000), 1 / 2001); assert.equal(pValue(2000, 2000), 1);
});
