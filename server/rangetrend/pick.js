// The adopted pick rule as a report (PROPOSED-RULES.md definitions 5-9, the owner's message of 2026-11-02).
// pickRuleReport takes the eight practice runs as stored (their status, error and metrics) and returns the
// table: qualified, each test, the score, the T0/T1/T2 sets and the outcome, one variant or NONE and why.
// It is a report only: it never writes the ledger, never advances anything and never starts the evaluation.
import { N_COMPLETED, TIE_POINTS } from './metrics.js';

export const PLANNED_RUN_COUNT = 8;
// Scores and drawdowns are decimal fractions; the 0.5-point comparisons are made after rounding each value to
// the nearest 1e-6 (a ten-thousandth of a percentage point), so floating-point noise cannot decide a tie.
const u = (x) => Math.round(x * 1e6);
const TIE_U = u(TIE_POINTS);

// Definition 8: the 0.5-point rule, no chaining. `passing` rows carry score, maxDrawdown and completedTrades.
export function tieRule(passing, tiePoints = TIE_POINTS) {
  if (!passing.length) return { T0: [], T1: null, T2: null, chosen: null, reason: 'no passing variant' };
  const tie = u(tiePoints);
  const top = Math.max(...passing.map((r) => u(r.score)));
  const T0 = passing.filter((r) => u(r.score) >= top - tie);
  if (T0.length === 1) return { T0, T1: null, T2: null, chosen: T0[0], reason: 'the highest score, with no other passing variant within 0.5 points of it' };
  const minDD = Math.min(...T0.map((r) => u(r.maxDrawdown)));
  const T1 = T0.filter((r) => u(r.maxDrawdown) <= minDD + tie);
  if (T1.length === 1) return { T0, T1, T2: null, chosen: T1[0], reason: `${T0.length} variants within 0.5 points of the top score; the smallest maximum drawdown, with no other within 0.5 points of it` };
  const most = Math.max(...T1.map((r) => r.completedTrades));
  const T2 = T1.filter((r) => r.completedTrades === most);
  if (T2.length === 1) return { T0, T1, T2, chosen: T2[0], reason: `${T0.length} variants within 0.5 points of the top score and ${T1.length} within 0.5 points of the smallest drawdown; the most completed trades` };
  return { T0, T1, T2, chosen: null, reason: `a tie after the 0.5-point rule (${T2.length} variants with the same completed-trade count): NONE advances` };
}

const versionOf = (r) => r.version ?? r.config?.version ?? r.configFile ?? r.config_file ?? null;

export function pickRuleReport(runs, { expected = PLANNED_RUN_COUNT } = {}) {
  const rows = (runs || []).map((r) => {
    const p = r.metrics?.pick ?? null;
    const recorded = r.status === 'done' && !r.error && !!p;
    const enoughTrades = !!p && p.completedTrades >= N_COMPLETED;
    const grossGainPasses = !!p && !!p.grossGain?.passes;
    const qualified = recorded && enoughTrades && grossGainPasses;
    const tests = p?.tests ?? { returnTest: false, drawdownTest: false, robustnessTest: false };
    const passes = qualified && !!p.passesComparison;
    const why = [];
    if (!recorded) why.push(r.error ? `recorded with an error: ${r.error}` : p ? `status ${r.status}` : 'no pick inputs in the metrics');
    if (p && !enoughTrades) why.push(`${p.completedTrades} completed trades, fewer than ${N_COMPLETED}`);
    if (p && !grossGainPasses) why.push(p.grossGain?.undefined ? 'gross gain G = 0: the single-stock share is undefined' : `single-stock gross-gain share ${(p.grossGain?.maxShare * 100).toFixed(1)}% (${p.grossGain?.maxSymbol}) above 40%`);
    if (qualified && !passes) {
      if (!tests.returnTest) why.push('annualised return not above the exposure-matched hold');
      if (!tests.drawdownTest) why.push('maximum drawdown deeper than the exposure-matched hold');
      if (!tests.robustnessTest) why.push('the best-5% stress test does not hold');
    }
    return {
      version: versionOf(r), configFile: r.configFile ?? r.config_file ?? null, recorded, status: r.status ?? null, error: r.error ?? null,
      completedTrades: p?.completedTrades ?? null, enoughTrades, grossGainPasses, grossGainShare: p?.grossGain?.maxShare ?? null, grossGainSymbol: p?.grossGain?.maxSymbol ?? null,
      qualified, tests, passes, annualised: p?.annualised ?? null, holdAnnualised: p?.holdAnnualised ?? null, maxDrawdown: p?.maxDrawdown ?? null, holdMaxDrawdown: p?.holdMaxDrawdown ?? null,
      bestFive: p?.bestFive ? { K: p.bestFive.K, adjustedNetPL: p.bestFive.adjustedNetPL, adjustedAnnualised: p.bestFive.adjustedAnnualised, holds: p.bestFive.holds } : null,
      score: passes ? p.score : null, why,
    };
  });
  const passing = rows.filter((r) => r.passes);
  let outcome, sets = { T0: [], T1: null, T2: null };
  if (rows.length !== expected) outcome = { chosen: null, reason: `not all ${expected} practice runs are recorded (${rows.length} of ${expected}): the rule applies after the eight runs` };
  else if (!rows.some((r) => r.qualified)) outcome = { chosen: null, reason: 'no run qualifies (completed trades, recorded without error, gross-gain gate)' };
  else if (!passing.length) outcome = { chosen: null, reason: 'no qualified run passes the comparison against its exposure-matched hold' };
  else {
    const t = tieRule(passing);
    sets = { T0: t.T0, T1: t.T1, T2: t.T2 };
    outcome = { chosen: t.chosen ? t.chosen.version : null, reason: t.reason };
  }
  const names = (set) => (set == null ? null : set.map((r) => r.version));
  return {
    rows, passing: names(passing), T0: names(sets.T0), T1: names(sets.T1), T2: names(sets.T2), outcome,
    settings: { completedTrades: N_COMPLETED, grossGainMaxShare: 0.40, tiePoints: TIE_POINTS },
    note: 'A report only (PROPOSED-RULES.md, adopted 2026-11-02): it writes no ledger row, advances nothing and starts no evaluation; the owner reads it. Return per unit of drawdown alone never advances a variant.',
  };
}
