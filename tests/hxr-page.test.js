// The HXR (simulated) page, public/views/hxr.js: static checks that keep
// server and third-party text out of markup and the page on the HXR API only,
// its route and navigation entry, and the overview contract it relies on to
// state the pre-registered rules before any result exists. No DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.js';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { loadConfig } from '../server/config.js';
import { createHxr } from '../server/hxr/service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the page builds text nodes only and calls nothing but the HXR API', () => {
  const src = read('public/views/hxr.js');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|srcdoc/.test(src), 'no markup built from strings');
  assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src));
  assert.ok(!/\bhttps?:\/\//.test(src), 'no external host');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), 'nothing stored in the browser');
  const calls = [...src.matchAll(/['`](\/api\/[^'`?$]*)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 10, `found ${calls.length} API paths`);
  for (const c of calls) assert.ok(c.startsWith('/api/hxr/'), `the page calls ${c}`);
  // The persistent banner, word for word.
  assert.ok(src.includes("h('strong', {}, 'Simulated account.'), ' Not your real holdings or cash. No order is sent to any broker or paper-trading platform. No notifications.'"));
});

test('the page is registered as "HXR (simulated)" right after the Strategy Lab', () => {
  const app = read('public/app.js');
  assert.match(app, /import \{ renderHxr \} from '\.\/views\/hxr\.js';/);
  const views = app.slice(app.indexOf('const VIEWS'), app.indexOf('};', app.indexOf('const VIEWS')));
  const lab = views.indexOf('  lab: '), hxr = views.indexOf("  hxr: { title: 'HXR (simulated)', render: renderHxr },"), settings = views.indexOf('  settings: ');
  assert.ok(lab >= 0 && hxr > lab && settings > hxr, views);
  const html = read('public/index.html');
  const nav = (r) => html.indexOf(`href="#/${r}"`);
  assert.ok(nav('lab') >= 0 && nav('hxr') > nav('lab') && nav('settings') > nav('hxr'));
});

test('overview: every config carries its rule, status and assumptions before any result', () => {
  const dir = tempDir('hxr-page-');
  const ctx = { cfg: loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none' }), mode: 'real' };
  Object.defineProperty(ctx, 'db', { get() { throw new Error('HXR touched the portfolio database'); } });
  const hxr = createHxr(ctx);
  try {
    const o = hxr.overview();
    assert.equal(o.runs.length, 0);
    assert.deepEqual([...new Set(o.configs.map((c) => c.rule.type))].sort(), ['giveback', 'hold', 'ma_band', 'move_allowance', 'pct_trail', 'recovery_break', 'vol_trail']);
    assert.equal(o.configs.length, 16);
    // hxr-prereg-3a roles: six candidates, three comparisons, the hold; everything earlier is superseded and never run.
    assert.deepEqual(Object.fromEntries(o.configs.map((c) => [c.version, c.role])), {
      'c1-0.1.0': 'superseded', 'c2-0.1.0': 'superseded', 'c3-0.1.0': 'superseded', 'hold-0.1.0': 'hold',
      'x1-0.2.0': 'superseded', 'x2-0.2.0': 'superseded', 'x3-0.2.0': 'superseded',
      'x1a-0.3.0': 'candidate', 'x1b-0.3.0': 'candidate', 'x1c-0.3.0': 'candidate', 'x2a-0.3.0': 'candidate', 'x2b-0.3.0': 'candidate', 'x2c-0.3.0': 'candidate',
      'x3a-0.3.0': 'comparison', 'x3b-0.3.0': 'comparison', 'x3c-0.3.0': 'comparison',
    });
    assert.equal(o.prereg.id, 'hxr-prereg-3a');
    assert.equal(o.pickRule, 'ending_value');
    assert.equal(o.validation, null);
    assert.deepEqual(o.benchmarks, ['hold', 'holdDayOne']);
    assert.deepEqual(Object.keys(o.neighbours), ['x1', 'x2']);
    assert.ok(o.configs.find((c) => c.version === 'x1a-0.3.0').assumptions.risk.plannedLossPerTradeUsd === 150);
    for (const c of o.configs) {
      const f = JSON.parse(read(`strategy/hxr/configs/${c.file}`));
      assert.deepEqual(c.rule, f.rule, c.file);
      assert.equal(c.status, f.status);
      assert.deepEqual(c.assumptions, { account: f.account, execution: f.execution, costs: f.costs, dividends: f.dividends, cash: f.cash, risk: f.risk ?? null, initialLoss: f.initialLoss ?? null }, c.file);
    }
    assert.match(o.universe.selectedBefore, /any HXR backtest or result/);
    assert.equal(o.criteria.passMeaning, "eligible for the owner's review; never permission to trade");
  } finally {
    hxr.close();
  }
});

test('the owner\'s decisions through the rendered page: MU kept before any run, a flagged move recorded as reviewed', async () => {
  const { installDom, settle, serviceApi, findAll, click, overlay } = await import('./hxr-dom.js');
  const store = await import('../server/hxr/store.js');
  const dir = tempDir('hxr-page-');
  const ctx = { cfg: loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none' }), mode: 'real' };
  Object.defineProperty(ctx, 'db', { get() { throw new Error('HXR touched the portfolio database'); } });
  const hxr = createHxr(ctx, { clock: () => new Date('2026-10-22T22:00:00Z') });
  try {
    // MU opens at half the previous close: a split-like move that no record explains.
    store.upsertBars(hxr.db, 'MU', [{ date: '2024-03-04', o: 99, h: 101, l: 98, c: 100, v: 10 }, { date: '2024-03-05', o: 50, h: 52, l: 49, c: 51, v: 10 }]);
    const view = installDom();
    const { renderHxr } = await import('../public/views/hxr.js');
    const { api, calls } = serviceApi(hxr, {
      '/api/hxr/mu-decision': (b) => hxr.setMuDecision(b),
      '/api/hxr/readiness/reviewed-moves': (b) => hxr.reviewMove(b),
    });
    await renderHxr(view, { api, app: { workspace: 'real' } });
    await settle();
    assert.match(view.textContent, /Your decision: MU in the evaluationpending/);
    assert.ok(!view.textContent.includes('undefined') && !view.textContent.includes('NaN'));

    // Keep MU: the confirmation needs the box ticked, then the choice is recorded and shown.
    await click(findAll(view, 'button', 'Keep MU…')[0]);
    assert.match(overlay().textContent, /Keep MU in the evaluation\?/);
    await click(findAll(overlay(), 'button', 'Keep MU').at(-1));
    assert.match(overlay().textContent, /Tick the box to confirm/);
    assert.equal(hxr.overview().decisions.mu, null, 'nothing recorded without the tick');
    findAll(overlay(), 'input')[0].checked = true;
    await click(findAll(overlay(), 'button', 'Keep MU').at(-1));
    assert.equal(hxr.overview().decisions.mu.choice, 'keep');
    assert.ok(calls.includes('POST /api/hxr/mu-decision'));
    await settle();
    assert.match(view.textContent, /Your decision: MU in the evaluationkeep MU/, 'the page reloaded with the recorded choice');

    // The flagged move: "Mark reviewed…" opens a dialog that needs a reason and the tick.
    await click(findAll(view, 'button', 'Mark reviewed…')[0]);
    assert.match(overlay().textContent, /looks like a 2-for-1 split/);
    findAll(overlay(), 'input')[0].checked = true;
    const reason = findAll(overlay(), 'textarea')[0];
    reason.value = '';
    await click(findAll(overlay(), 'button', 'Record as reviewed')[0]);
    assert.match(overlay().textContent, /A reason is required/);
    reason.value = 'Checked the exchange daily summary: a real gap, no split.';
    await click(findAll(overlay(), 'button', 'Record as reviewed')[0]);
    assert.deepEqual(hxr.overview().decisions.reviewedMoves.map((m) => [m.symbol, m.date, m.reason]), [['MU', '2024-03-05', reason.value]]);
    await settle();
    assert.ok(view.textContent.includes('2024-03-05: a 2-for-1 split (reviewed: not a split)'));
  } finally {
    hxr.close();
  }
});
