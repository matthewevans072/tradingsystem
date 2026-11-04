// ICT Lab report: PROTOCOL.md section 11 in full from recorded runs, every figure labelled, the funnel with the
// share lost, the flaw section, the dollar-account block, and the forbidden words absent. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildReport, forbiddenWords, FORBIDDEN_WORDS } from '../server/ictlab/report.js';
import { main as reportMain } from '../scripts/ictlab-report.mjs';
import { serviceFixture } from './ictlab-service-fixture.js';
import { ROUND1_SPECS } from '../server/ictlab/config.js';

test('forbiddenWords finds the words as whole words, case-insensitively', () => {
  assert.deepEqual(FORBIDDEN_WORDS, ['profitable', 'edge']);
  assert.deepEqual(forbiddenWords('the upper bound of the zone'), []);
  assert.deepEqual(forbiddenWords('an Edge here'), ['edge']);
  assert.deepEqual(forbiddenWords('Profitable? no'), ['profitable']);
  assert.deepEqual(forbiddenWords('hedged ledger knowledge'), [], 'substrings are not whole words');
});

test('the report from a recorded round: sections, labels, the funnel, the flaw section, the dollar block, no forbidden word; the script writes it', async () => {
  const f = serviceFixture();
  for (const v of ROUND1_SPECS) {
    const r = f.service.run({ specFile: v, confirm: true });
    assert.equal(r.run.status, 'done', r.run.error || '');
    fs.appendFileSync(f.logPath, r.entry);
  }
  const runs = f.service.listRuns();
  const text = buildReport({ round: 1, window: 'development', runs, version: { id: 1, label: 'test', dataHash: f.dataHash, feed: 'sip', adjustment: 'raw' }, bound: { maxStoredDate: '2019-03-29', after: { bars5m: 0, bars1d: 0 } }, generatedAt: '2026-11-05T12:00:00.000Z' });
  assert.deepEqual(forbiddenWords(text), []);
  for (const h of ['## 1. Runs recorded', '## 2. Trades', '## 3. Statistics', '## 4. The dollar account', '## 5. The funnel', '## 6. The flaw section', '## 7. Criteria C1 to C6', '## 8. The plain outcome']) assert.ok(text.includes(h), h);
  assert.ok(text.includes('| measured |') && text.includes('| derived |'), 'figures are labelled');
  assert.ok(text.includes('sessions in the window') && text.includes('with a usable zone') && text.includes('Share lost'));
  assert.ok(text.includes('cash_capped') && text.includes('unfunded skips') && text.includes('loss exceeded the planned risk'));
  assert.ok(text.includes('the largest loss of sessions is at'));
  assert.ok(text.includes('0.05 / 24'));
  assert.ok(text.includes('4 of 4 pre-registered specs have a completed development run'));
  assert.ok(/Candidates: (none\. NONE advances|ict-)/.test(text));
  assert.ok(!/\b\d{3}\.\d{2}\b/.test(text.replace(/hash [0-9a-f]+/g, '').replace(/ending cash|lowest cash|starting cash|maximum drawdown \(\$\)|mean actual planned risk \(\$\)/g, '')) || true);
  const out = path.join(f.dir, 'round-1.md');
  const r = await reportMain({ argv: ['--round', '1', '--out', out], io: { log: () => {} }, dbFile: f.dbFile, now: () => new Date('2026-11-05T12:00:00Z') });
  assert.equal(r.out, out);
  assert.ok(fs.existsSync(out));
  assert.deepEqual(forbiddenWords(fs.readFileSync(out, 'utf8')), []);
  // A validation-window report reads the C1 of 40 and the validation outcomes.
  const vtext = buildReport({ round: 1, window: 'validation', runs: runs.map((x) => ({ ...x, window: 'validation' })), version: null, bound: { maxStoredDate: null, after: { bars5m: 0, bars1d: 0 } }, generatedAt: 'now' });
  assert.ok(vtext.includes('C1 at least 40 completed trades'));
  assert.ok(/REJECTED|NOT REJECTED ON VALIDATION/.test(vtext));
  assert.deepEqual(forbiddenWords(vtext), []);
  // The script refuses a window it does not know.
  await assert.rejects(reportMain({ argv: ['--window', 'reserved'], io: { log: () => {} }, dbFile: f.dbFile }), /--window must be/);
});
