import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDb } from './helpers.js';
import { parseCsv, previewImport, applyImport } from '../server/importer.js';
import { ensureInstrument, computePortfolio } from '../server/portfolio.js';

const CSV = `date,type,symbol,exchange,currency,quantity,price,fees,account
2026-01-05,BUY,NVDA,NASDAQ,USD,2,"1,000.50",1,TFSA
2026-01-05,BUY,NVDA,NASDAQ,USD,2,"1,000.50",1,TFSA
2026-02-05,SELL,NVDA,NASDAQ,USD,-1,1100,1,TFSA
2026-02-06,BUY,XEQT,,CAD,5,30,0,TFSA
03/04/2026,BUY,AAPL,NASDAQ,USD,1,100,0,TFSA
2026-02-07,DEPOSIT,,,CAD,,,,TFSA
`;

test('CSV parser handles quotes, commas and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('preview writes nothing; apply inserts; re-import is fully deduplicated', () => {
  const { db } = tempDb();
  const p = previewImport(db, { filename: 'a.csv', text: CSV });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, 0, 'preview must not touch the ledger');
  assert.equal(p.summary.total, 6);
  assert.equal(p.summary.new, 3, 'two identical fills + sell');
  assert.equal(p.summary.error, 3);
  const errs = p.rows.filter((r) => r.status === 'error').map((r) => r.problems.join(' '));
  assert.ok(errs.some((e) => e.includes('Exchange required')), 'missing exchange is not guessed');
  assert.ok(errs.some((e) => e.includes('ambiguous')), 'MM/DD vs DD/MM is not guessed');
  assert.ok(errs.some((e) => e.includes('Amount')), 'deposit without amount rejected');

  const r = applyImport(db, p.batchId);
  assert.equal(r.inserted, 3);
  assert.throws(() => applyImport(db, p.batchId), /already applied/);

  const p2 = previewImport(db, { filename: 'a-again.csv', text: CSV });
  assert.equal(p2.summary.new, 0);
  assert.equal(p2.summary.duplicate, 3);
  applyImport(db, p2.batchId);
  const pos = computePortfolio(db).positions[0];
  assert.equal(pos.shares, 3);
});

test('exchange is filled only from a unique confirmed instrument', () => {
  const { db } = tempDb();
  ensureInstrument(db, { symbol: 'XEQT', exchange: 'TSX', currency: 'CAD', identityStatus: 'confirmed' });
  const p = previewImport(db, { filename: 'b.csv', text: 'date,type,symbol,quantity,price\n2026-02-06,BUY,XEQT,5,30\n' });
  assert.equal(p.rows[0].status, 'new');
  assert.equal(p.rows[0].exchange, 'TSX');
  assert.ok(p.rows[0].warnings[0].includes('confirmed instrument'));
});
