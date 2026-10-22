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
    assert.deepEqual(o.configs.map((c) => c.rule.type).sort(), ['hold', 'ma_band', 'pct_trail', 'vol_trail']);
    for (const c of o.configs) {
      const f = JSON.parse(read(`strategy/hxr/configs/${c.file}`));
      assert.deepEqual(c.rule, f.rule, c.file);
      assert.equal(c.status, f.status);
      assert.deepEqual(c.assumptions, { account: f.account, execution: f.execution, costs: f.costs, dividends: f.dividends, cash: f.cash }, c.file);
    }
    assert.match(o.universe.selectedBefore, /any HXR backtest or result/);
    assert.equal(o.criteria.passMeaning, "eligible for the owner's review; never permission to trade");
  } finally {
    hxr.close();
  }
});
