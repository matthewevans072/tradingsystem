// Trade-claim guard and proposal intent check against labelled corpora:
// phrasings found in reviews and evaluations, plus adversarially generated
// claims, honest look-alikes, instructions and innocent messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findClaims, guardText } from '../server/agent/guard.js';
import { checkUserIntent } from '../server/agent/proposals.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

test('guard: every labelled sentence is classified correctly', () => {
  const wrong = load('guard-corpus.json').filter((c) => (findClaims(c.text).length > 0) !== c.isClaim)
    .map((c) => `${c.isClaim ? 'missed claim' : 'false positive'}: ${c.text}`);
  assert.deepEqual(wrong, []);
});

test('guard: only the claiming sentence is removed, and the notice says why', () => {
  const g = guardText("NBIS is down 2.4%. I've sold 10 shares at 98.20. Your weight is now 61%.");
  assert.equal(g.removed.length, 1);
  assert.match(g.text, /^NBIS is down 2\.4%\. \[Removed: .*\] Your weight is now 61%\.$/);
  assert.equal(guardText('No order has been placed.').flagged, false);
});

test('intent check: every labelled request is accepted or refused correctly', () => {
  const wrong = load('intent-corpus.json').filter((c) => {
    const err = checkUserIntent(c.message, c.quote, { changeType: c.changeType, details: JSON.parse(c.details || '{}') });
    return (err === null) !== c.shouldAccept;
  }).map((c) => `${c.shouldAccept ? 'refused' : 'accepted'}: ${c.message} [${c.quote}]`);
  assert.deepEqual(wrong, []);
});
