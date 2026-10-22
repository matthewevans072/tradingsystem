// HXR configs, universe, periods and criteria: validation of every field,
// hashing (descriptive keys ignored), deep freezing and stress variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import {
  HXR_DIR, HXR_CONFIG_DIR, loadHxrConfig, validateHxrConfig, configFileName, hxrConfigHash, listHxrConfigs, variantConfig, halfSpreadFor,
  loadHxrUniverse, validateHxrUniverse, basketSymbols, loadHxrPeriods, validateHxrPeriods, excludedDates,
  loadHxrCriteria, validateHxrCriteria, criterion,
} from '../server/hxr/config.js';
import { configHash } from '../server/strategy/config.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const C1 = path.join(HXR_CONFIG_DIR, 'hxr-c1-0.1.0.json');

test('the four pre-registered configs load, validate, freeze and hash like the Strategy Lab', () => {
  const list = listHxrConfigs();
  assert.deepEqual(list.map((c) => [c.file, c.version, c.ruleType, c.error]), [
    ['hxr-c1-0.1.0.json', 'c1-0.1.0', 'ma_band', undefined],
    ['hxr-c2-0.1.0.json', 'c2-0.1.0', 'vol_trail', undefined],
    ['hxr-c3-0.1.0.json', 'c3-0.1.0', 'pct_trail', undefined],
    ['hxr-hold-0.1.0.json', 'hold-0.1.0', 'hold', undefined],
  ]);
  assert.equal(new Set(list.map((c) => c.hash)).size, 4);
  const c1 = loadHxrConfig(C1);
  assert.deepEqual(c1.rule, { type: 'ma_band', smaSessions: 100, bandPct: 2 });
  assert.equal(hxrConfigHash(c1), configHash(c1));
  assert.equal(hxrConfigHash(c1), list[0].hash);
  assert.ok(Object.isFrozen(c1) && Object.isFrozen(c1.rule) && Object.isFrozen(c1.costs));
  assert.throws(() => { c1.rule.smaSessions = 50; }, TypeError);
  // A bare file name resolves to strategy/hxr/configs.
  assert.equal(hxrConfigHash(loadHxrConfig('hxr-c1-0.1.0.json')), list[0].hash);
  assert.equal(HXR_CONFIG_DIR, path.join(HXR_DIR, 'configs'));
});

test('the hash ignores descriptive keys and changes with every rule-relevant value', () => {
  const base = clone(loadHxrConfig(C1));
  const h = hxrConfigHash(base);
  const desc = clone(base);
  desc.label = 'renamed'; desc.status = 'x'; desc.createdAt = '2030-01-01'; desc.costs.notes = 'other'; desc.dividends.notes = 'other';
  assert.equal(hxrConfigHash(desc), h);
  for (const [p, v] of [['rule.bandPct', 3], ['rule.smaSessions', 50], ['costs.slippageBps', 3], ['execution.delaySessions', 2], ['dividends.withholdingPct', 0], ['account.startingCash', 15001]]) {
    const c = clone(base);
    const ks = p.split('.');
    c[ks[0]][ks[1]] = v;
    assert.deepEqual(validateHxrConfig(c), [], p);
    assert.notEqual(hxrConfigHash(c), h, p);
  }
});

test('every field is validated, unknown settings are refused', () => {
  const base = clone(loadHxrConfig(C1));
  assert.deepEqual(validateHxrConfig(base), []);
  const bad = [
    [(c) => { c.strategy = 'cb'; }, /strategy must be "hxr"/],
    [(c) => { delete c.version; }, /version is required/],
    [(c) => { c.extra = 1; }, /extra is not a known setting/],
    [(c) => { c.account.startingCash = 0; }, /account.startingCash must be greater than 0/],
    [(c) => { c.account.currency = 'CAD'; }, /account.currency must be "USD"/],
    [(c) => { c.account.allocation = 'rotation'; }, /account.allocation must be "equal_sleeves"/],
    [(c) => { c.account.wholeShares = false; }, /account.wholeShares must be true/],
    [(c) => { c.account.allowMargin = true; }, /account.allowMargin must be false/],
    [(c) => { c.account.allowShort = true; }, /account.allowShort must be false/],
    [(c) => { c.account.leverage = 2; }, /account.leverage is not a known setting/],
    [(c) => { c.execution.delaySessions = 0; }, /execution.delaySessions must be at least 1/],
    [(c) => { c.execution.delaySessions = 1.5; }, /execution.delaySessions must be a whole number/],
    [(c) => { c.execution.fillModel = 'close'; }, /execution.fillModel must be "open" or "vw15"/],
    [(c) => { c.execution.fill = 'same_close'; }, /execution.fill must be "next_open"/],
    [(c) => { c.costs.commissionPerOrder = -1; }, /costs.commissionPerOrder must be at least 0/],
    [(c) => { c.costs.secFeeRate = 'x'; }, /costs.secFeeRate must be a finite number/],
    [(c) => { c.costs.halfSpread = 'median'; }, /costs.halfSpread must be "calibrated" or a number/],
    [(c) => { c.costs.halfSpread = -1; }, /costs.halfSpread must be "calibrated" or a number/],
    [(c) => { delete c.costs.halfSpreadFloorBps; }, /costs.halfSpreadFloorBps is required/],
    [(c) => { c.costs.slippageBps = -0.5; }, /costs.slippageBps must be at least 0/],
    [(c) => { c.dividends.credit = 'yes'; }, /dividends.credit must be a boolean/],
    [(c) => { c.dividends.creditOn = 'ex_date'; }, /dividends.creditOn must be "pay_date"/],
    [(c) => { c.dividends.withholdingPct = 101; }, /dividends.withholdingPct must be at most 100/],
    [(c) => { c.cash.annualInterestPct = -1; }, /cash.annualInterestPct must be at least 0/],
    [(c) => { c.rule = { type: 'breakout' }; }, /rule.type must be/],
    [(c) => { c.rule.smaSessions = 1; }, /rule.smaSessions must be at least 2/],
    [(c) => { c.rule.smaSessions = 20.5; }, /rule.smaSessions must be a whole number/],
    [(c) => { c.rule.bandPct = -1; }, /rule.bandPct must be at least 0/],
    [(c) => { c.rule.multiple = 3; }, /rule.multiple is not a known setting/],
    [(c) => { c.rule = { type: 'vol_trail', volSessions: 0, multiple: 3 }; }, /rule.volSessions must be at least 1/],
    [(c) => { c.rule = { type: 'vol_trail', volSessions: 20, multiple: 0 }; }, /rule.multiple must be greater than 0/],
    [(c) => { c.rule = { type: 'pct_trail', exitDrawdownPct: 100, reentryRisePct: 15 }; }, /rule.exitDrawdownPct must be less than 100/],
    [(c) => { c.rule = { type: 'pct_trail', exitDrawdownPct: 0, reentryRisePct: 15 }; }, /rule.exitDrawdownPct must be greater than 0/],
    [(c) => { c.rule = { type: 'pct_trail', exitDrawdownPct: 20, reentryRisePct: 0 }; }, /rule.reentryRisePct must be greater than 0/],
    [(c) => { c.rule = { type: 'hold', smaSessions: 100 }; }, /rule.smaSessions is not a known setting/],
    [(c) => { c.baseHash = 'abc'; }, /baseHash must be a SHA-256/],
  ];
  for (const [mutate, re] of bad) {
    const c = clone(base);
    mutate(c);
    const errors = validateHxrConfig(c);
    assert.ok(errors.some((e) => re.test(e)), `${re}: ${errors.join('; ')}`);
  }
  // A fixed half-spread in bps is allowed.
  const fixed = clone(base);
  fixed.costs.halfSpread = 3;
  assert.deepEqual(validateHxrConfig(fixed), []);
  assert.deepEqual(validateHxrConfig({ ...clone(base), rule: { type: 'hold' } }), []);
});

test('loading a file: invalid configs throw, and the file name must match the version', () => {
  const dir = tempDir('hxr-cfg-');
  const base = clone(loadHxrConfig(C1));
  fs.writeFileSync(path.join(dir, 'hxr-c9-0.1.0.json'), JSON.stringify(base));
  assert.throws(() => loadHxrConfig(path.join(dir, 'hxr-c9-0.1.0.json')), /file name hxr-c9-0.1.0.json does not match the config's version c1-0.1.0 \(expected hxr-c1-0.1.0.json\)/);
  // The frozen version is recorded under its natural name with its JSON unchanged, so its hash matches.
  const frozen = { ...base, version: 'hxr-1.0.0', label: 'HXR hxr-1.0.0 (frozen from c1-0.1.0)', createdAt: '2026-10-23' };
  assert.equal(configFileName('hxr-1.0.0'), 'hxr-1.0.0.json');
  assert.equal(configFileName('c1-0.1.0'), 'hxr-c1-0.1.0.json');
  fs.writeFileSync(path.join(dir, 'hxr-1.0.0.json'), JSON.stringify(frozen, null, 2));
  assert.equal(hxrConfigHash(loadHxrConfig(path.join(dir, 'hxr-1.0.0.json'))), hxrConfigHash(frozen));
  fs.writeFileSync(path.join(dir, 'hxr-hxr-1.0.0.json'), JSON.stringify(frozen));
  assert.throws(() => loadHxrConfig(path.join(dir, 'hxr-hxr-1.0.0.json')), /expected hxr-1.0.0.json/, 'one naming convention only');
  fs.rmSync(path.join(dir, 'hxr-1.0.0.json'));
  fs.rmSync(path.join(dir, 'hxr-hxr-1.0.0.json'));
  fs.writeFileSync(path.join(dir, 'other.json'), JSON.stringify({ ...base, account: { ...base.account, allowShort: true } }));
  assert.throws(() => loadHxrConfig(path.join(dir, 'other.json')), /Invalid HXR config other.json: account.allowShort must be false/);
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(base));
  assert.equal(loadHxrConfig(path.join(dir, 'ok.json')).version, 'c1-0.1.0');
  const listed = listHxrConfigs(dir);
  assert.deepEqual(listed.map((c) => [c.file, !!c.error]), [['hxr-c9-0.1.0.json', true], ['ok.json', false], ['other.json', true]]);
});

test('variants: spread and slippage doubled, a longer delay, the other fill model, 0% withholding', () => {
  const base = loadHxrConfig(C1);
  const h = hxrConfigHash(base);
  const costs = variantConfig(base, { spreadSlippageMultiplier: 2 });
  assert.equal(costs.costs.slippageBps, 4);
  assert.equal(costs.costs.halfSpreadMultiplier, 2);
  assert.equal(costs.costs.halfSpread, 'calibrated');
  assert.equal(costs.baseHash, h);
  assert.deepEqual(costs.variant, { spreadSlippageMultiplier: 2 });
  assert.notEqual(hxrConfigHash(costs), h);
  assert.ok(Object.isFrozen(costs.costs));
  assert.deepEqual(validateHxrConfig(costs), []);
  assert.equal(base.costs.slippageBps, 2, 'the base is untouched');

  const delay = variantConfig(base, { delaySessions: 2, label: 'delay 2' });
  assert.equal(delay.execution.delaySessions, 2);
  assert.equal(delay.label, 'delay 2');
  const vw = variantConfig(base, { fillModel: 'vw15' });
  assert.equal(vw.execution.fillModel, 'vw15');
  const w0 = variantConfig(base, { withholdingPct: 0 });
  assert.equal(w0.dividends.withholdingPct, 0);
  // Even a variant that repeats a base value hashes differently (it records the base).
  const same = variantConfig(base, { fillModel: 'open' });
  assert.notEqual(hxrConfigHash(same), h);
  assert.equal(new Set([costs, delay, vw, w0, same].map(hxrConfigHash)).size, 5);
  // The label is descriptive: it does not change the hash.
  assert.equal(hxrConfigHash(variantConfig(base, { delaySessions: 2, label: 'other' })), hxrConfigHash(delay));

  assert.throws(() => variantConfig(costs, { delaySessions: 2 }), /needs a base config/);
  assert.throws(() => variantConfig(base, {}), /at least one change/);
  assert.throws(() => variantConfig(base, { label: 'only a label' }), /at least one change/);
  assert.throws(() => variantConfig(base, { slippage: 2 }), /Unknown variant option slippage/);
  assert.throws(() => variantConfig(base, { delaySessions: 0 }), /execution.delaySessions must be at least 1/);
  assert.throws(() => variantConfig(base, { fillModel: 'close' }), /fillModel must be/);
  assert.throws(() => variantConfig(base, { spreadSlippageMultiplier: 0 }), /above 0/);
});

test('halfSpreadFor applies the floor, then the variant multiplier', () => {
  const base = loadHxrConfig(C1);
  const table = (sym, date) => (sym === 'MU' && date >= '2020-01-01' ? 5 : 1);
  assert.throws(() => halfSpreadFor(base), /calibration table is needed/);
  const f = halfSpreadFor(base, table);
  assert.equal(f('MU', '2021-01-04'), 5);
  assert.equal(f('MU', '2019-01-02'), 2, 'floored at 2 bps');
  const f2 = halfSpreadFor(variantConfig(base, { spreadSlippageMultiplier: 2 }), table);
  assert.equal(f2('MU', '2021-01-04'), 10);
  assert.equal(f2('AMZN', '2021-01-04'), 4);
  const fixed = clone(base);
  fixed.costs.halfSpread = 1;
  assert.equal(halfSpreadFor(fixed)('ANY', '2020-01-02'), 2);
  fixed.costs.halfSpread = 7;
  assert.equal(halfSpreadFor(fixed)('ANY', '2020-01-02'), 7);
});

test('universe: baskets in listed order, SPCX only with pending symbols, validation', () => {
  const u = loadHxrUniverse();
  assert.deepEqual(basketSymbols(u, 'A').map((s) => s.symbol), ['MU', 'AMZN', 'META', 'TSLA', 'VST']);
  assert.deepEqual(basketSymbols(u, 'B').map((s) => s.symbol), ['MU', 'MUU', 'NBIS', 'HOOD', 'AMZN', 'META', 'TSLA', 'VST']);
  assert.deepEqual(basketSymbols(u, 'A')[4], { symbol: 'VST', exchange: 'NYSE', listedFrom: '2017-05-10' });
  assert.ok(!basketSymbols(u, 'prospective').some((s) => s.symbol === 'SPCX'));
  assert.equal(basketSymbols(u, 'prospective', { withPending: true }).at(-1).symbol, 'SPCX');
  assert.throws(() => basketSymbols(u, 'C'), /Unknown HXR basket C/);
  assert.ok(Object.isFrozen(u.symbols[0]));

  const raw = JSON.parse(fs.readFileSync(path.join(HXR_DIR, 'universe-hxr-v1.json'), 'utf8'));
  assert.deepEqual(validateHxrUniverse(raw), []);
  const cases = [
    [(x) => { x.symbols[0].listedFrom = '2016-02-30'; }, /MU needs a listedFrom date/],
    [(x) => { x.symbols[1].symbol = 'MU'; }, /MU is listed twice/],
    [(x) => { x.baskets.A.symbols.push('NVDA'); }, /basket A names an unknown symbol NVDA/],
    [(x) => { x.symbols[5].baskets.push('A'); }, /HOOD says it is in basket A, which does not list it/],
    [(x) => { x.symbols[0].baskets.push('Z'); }, /MU names an unknown basket Z/],
    [(x) => { delete x.symbols[2].exchange; }, /META needs an exchange/],
  ];
  for (const [mutate, re] of cases) {
    const x = clone(raw);
    mutate(x);
    assert.ok(validateHxrUniverse(x).some((e) => re.test(e)), String(re));
  }
});

test('periods: dates, baskets and excluded sessions with reasons', () => {
  const u = loadHxrUniverse();
  const p = loadHxrPeriods();
  assert.deepEqual(excludedDates(p), ['2021-10-25', '2022-01-24', '2022-01-26', '2022-03-08']);
  assert.equal(p.periods.selection.start, '2017-10-02');
  assert.equal(p.warmupSessions, 100);
  const raw = JSON.parse(fs.readFileSync(path.join(HXR_DIR, 'periods-hxr-v1.json'), 'utf8'));
  assert.deepEqual(validateHxrPeriods(raw, u), []);
  const cases = [
    [(x) => { x.periods.selection.start = '2017-13-02'; }, /period selection needs a start date/],
    [(x) => { x.periods.evaluation.end = '2022-01-01'; }, /period evaluation: start is after end/],
    [(x) => { x.periods.fullList.basket = 'Z'; }, /period fullList names an unknown basket Z/],
    [(x) => { x.excludedSessions[1].reason = ''; }, /excluded session 2022-01-24 needs a reason/],
    [(x) => { x.excludedSessions.push({ date: '2021-10-25', reason: 'again' }); }, /listed twice/],
    [(x) => { x.excludedSessions.push({ date: '2021/10/26', reason: 'x' }); }, /YYYY-MM-DD/],
    [(x) => { delete x.periods.evaluation; }, /period evaluation is missing/],
    [(x) => { x.warmupSessions = 0; }, /warmupSessions/],
    [(x) => { x.periods.selection.warmupFrom = '2015-01-02'; }, /warmupFrom is before dataFrom/],
  ];
  for (const [mutate, re] of cases) {
    const x = clone(raw);
    mutate(x);
    assert.ok(validateHxrPeriods(x, u).some((e) => re.test(e)), String(re));
  }
});

test('criteria: G1-G6 and P1-P4 with their numbers', () => {
  const c = loadHxrCriteria();
  assert.equal(criterion(c, 'G1').minSessions, 500);
  assert.equal(criterion(c, 'G2').maxRatioToHold, 0.75);
  assert.equal(criterion(c, 'G6').minPassing, 4);
  assert.equal(criterion(c, 'P3').maxMedianBps, 25);
  assert.equal(c.selection.stopUnlessAtLeastTimesHold, 1.1);
  const raw = JSON.parse(fs.readFileSync(path.join(HXR_DIR, 'criteria-hxr-v1.json'), 'utf8'));
  assert.deepEqual(validateHxrCriteria(raw), []);
  const cases = [
    [(x) => { x.criteria = x.criteria.filter((y) => y.id !== 'G3'); }, /criteria must hold G3 exactly once/],
    [(x) => { x.criteria[0].minSessions = -5; }, /G1.minSessions must be at least 1/],
    [(x) => { x.criteria.push({ id: 'G7' }); }, /unknown criterion G7/],
    [(x) => { x.selection.minRoundTrips = 'ten'; }, /selection.minRoundTrips/],
    [(x) => { delete x.outcomes.PASS; }, /outcomes.PASS/],
    [(x) => { x.criteria[4].variants = []; }, /G5.variants/],
  ];
  for (const [mutate, re] of cases) {
    const x = clone(raw);
    mutate(x);
    assert.ok(validateHxrCriteria(x).some((e) => re.test(e)), String(re));
  }
});
