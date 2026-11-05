// The research runner's pre-registered search space and data bound (synthetic checks on the pinned configs;
// nothing here reads market data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedExperiments, combinationStage, applyChange, STAGE1_CHANGES, STAGE2_CHANGES } from '../server/research/space.js';
import { configProblem, assertDevelopmentPeriod, developmentPeriod, LIMITS, CRITERIA, BASE_FILES, BASELINE_FILE, STAGES, experimentHash, campaignDocStatus, CAMPAIGN_DOC } from '../server/research/config.js';
import { loadConfig, PLANNED_CONFIGS } from '../server/rangetrend/config.js';

test('the development period is the only period: every planned config uses it exactly, and any other window is refused', () => {
  const dev = developmentPeriod();
  assert.deepEqual(dev, { basket: 'A', warmupFrom: '2016-01-04', start: '2017-10-02', end: '2021-12-31' });
  const items = plannedExperiments();
  for (const it of items) { assert.equal(configProblem(it.config), null, it.name); assert.deepEqual(it.config.period, dev); }
  const base = loadConfig(BASELINE_FILE);
  // The first validation session, the evaluation window, the final period and a shifted start are all refused.
  for (const bad of [{ end: '2022-01-03' }, { start: '2022-01-03', end: '2023-12-29' }, { start: '2024-01-02', end: '2026-10-21' }, { start: '2017-10-03' }, { warmupFrom: '2015-01-02' }, { basket: 'B' }]) {
    const c = { ...base, period: { ...base.period, ...bad } };
    assert.match(configProblem(c) || '', /period\./, JSON.stringify(bad));
    assert.throws(() => assertDevelopmentPeriod(c), /refuses the config/);
  }
  assert.match(configProblem({ ...base, portfolio: { ...base.portfolio, positionCapPct: 0 } }) || '', /invalid range-trend config/);
});

test('stages 0 to 2: 84 unique configurations, the eight planned configs first among them, every later one a single-field change of its base', () => {
  const items = plannedExperiments();
  assert.equal(items.length, 84);
  const by = (s) => items.filter((i) => i.stage === s);
  assert.equal(by(STAGES.reference).length, 8);
  assert.equal(by(STAGES.singleB).length, 42);
  assert.equal(by(STAGES.singleOthers).length, 34);
  assert.equal(new Set(items.map((i) => i.configHash)).size, 84);
  assert.equal(new Set(items.map((i) => i.name)).size, 84);
  // Stage 0 hashes equal the pinned configs' engine hashes (the practice runs' config hashes).
  for (const f of PLANNED_CONFIGS) assert.equal(by(0).find((i) => i.baseFile === f).configHash, experimentHash(loadConfig(f)));
  // Every single change differs from its base in exactly the named field and in nothing else that the engine reads.
  const bases = Object.fromEntries(Object.entries(BASE_FILES).map(([k, f]) => [k, loadConfig(f)]));
  for (const it of items.filter((i) => i.stage > 0)) {
    assert.equal(it.change.length, 1);
    const base = bases[it.parentKey];
    const [{ field, to }] = it.change;
    const expected = applyChange(base, field, to);
    const strip = (c) => { const { version, label, status, ...rest } = c; return JSON.stringify(rest); };
    assert.equal(strip(it.config), strip(expected), it.name);
    assert.notEqual(strip(it.config), strip(base), `${it.name} must differ from its base`);
    assert.match(it.config.version, /^rr1-/);
  }
  const stage1Count = STAGE1_CHANGES.reduce((a, [, v]) => a + v.length, 0);
  assert.equal(stage1Count, 42);
  assert.equal(Object.values(STAGE2_CHANGES).flat().reduce((a, [, v]) => a + v.length, 0), 34);
  assert.ok(items.length + 16 <= LIMITS.maxConfigs, 'stages 0 to 3 fit the budget');
});

test('the combination stage follows the fixed rule: top 3 improving single changes per base within the drawdown limit, pairwise and all three, at most 4 per base, cut at the budget', () => {
  const items = plannedExperiments();
  const B = BASE_FILES.B;
  const mk = (it, id, net, dd = 5, status = 'done') => ({ id, name: it.name, stage: it.stage, status, base_file: it.baseFile, change: it.change, summary: { net, maxDrawdownPct: dd } });
  const ref = items.find((i) => i.stage === 0 && i.baseFile === B);
  const singles = items.filter((i) => i.stage === 1);
  const byField = (f, v) => singles.find((i) => i.change[0].field === f && i.change[0].to === v);
  const exps = [mk(ref, 1, 1000),
    mk(byField('levels.windowSessions', 90), 2, 1500), mk(byField('exits.trendGivebackM', 4), 3, 1400), mk(byField('portfolio.stopM', 1), 4, 1300), mk(byField('levels.minHeightM', 6), 5, 1200),
    mk(byField('levels.breakoutM', 1), 6, 2000, CRITERIA.maxDrawdownPct + 1), // over the drawdown limit: excluded
    mk(byField('levels.mSessions', 10), 7, 900), // below the base: excluded
    mk(byField('levels.zoneFraction', 0.2), 8, 1600, 5, 'failed')]; // failed: excluded
  const combos = combinationStage(exps);
  assert.equal(combos.length, 4);
  const names = combos.map((c) => c.name);
  assert.ok(names.every((n) => n.startsWith('B+')));
  assert.ok(names.some((n) => n.includes('windowSessions=90') && n.includes('trendGivebackM=4') && n.includes('stopM=1')), 'all three combined');
  for (const c of combos) { assert.equal(c.stage, STAGES.combinations); assert.equal(configProblem(c.config), null); assert.ok(c.change.length >= 2); }
  // Two values of the same field never combine; one improving change gives nothing; the budget cuts.
  const same = [mk(ref, 1, 1000), mk(byField('exits.trendGivebackM', 4), 2, 1500), mk(byField('exits.trendGivebackM', 6), 3, 1400)];
  assert.equal(combinationStage(same).length, 0);
  assert.equal(combinationStage(exps, { budgetLeft: 2 }).length, 2);
  assert.equal(combinationStage([mk(ref, 1, 1000), mk(byField('levels.windowSessions', 90), 2, 1500)]).length, 0);
});

test('the campaign document is present, names the baseline, the budget and the limits, and holds no open marker', () => {
  const st = campaignDocStatus(CAMPAIGN_DOC);
  assert.equal(st.ok, true, st.problem);
  assert.match(st.hash, /^[0-9a-f]{64}$/);
});
