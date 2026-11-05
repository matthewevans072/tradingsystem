// Research runner: constants, limits and the pre-registered campaign plans (strategy/research-runner/CAMPAIGN-1.md,
// CAMPAIGN-3.md). A simulation only. The runner reuses the range-trend engine (server/rangetrend/) and, for
// campaign 3, the mechanism engine (./mechanisms.js) on HXR's development-period market data, read-only, and keeps
// its own database (data/research-runner.sqlite). It never reads real holdings or cash, never places an order,
// never sends anything outside the app, and never opens the evaluation, validation, final or reserved windows:
// the only period any experiment may use is HXR's development period, asserted here and again in the runner
// before every run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadHxrPeriods } from '../hxr/config.js';
import { validateConfig as validateRtConfig, configHash as rtConfigHash, PLANNED_CONFIGS as RT_PLANNED, loadConfig as loadRtConfig } from '../rangetrend/config.js';
import { validateMechanismConfig, mechanismConfigHash } from './mechanisms.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RR_DIR = path.join(ROOT, 'strategy', 'research-runner');
export const CAMPAIGN_DOC = path.join(RR_DIR, 'CAMPAIGN-1.md');
export const CAMPAIGN3_DOC = path.join(RR_DIR, 'CAMPAIGN-3.md');
export const CONCEPTS_DOC = path.join(RR_DIR, 'CONCEPTS.md');
export const LOG_PATH = path.join(RR_DIR, 'EXPERIMENT-LOG.md');
export const REPORT_DIR = path.join(RR_DIR, 'reports');
export const RR_DB_NAME = 'research-runner.sqlite';
export const LOG_DIR_NAME = 'research-logs';

// Bump with any change that alters an experiment's result (the engines' own versions are recorded with every
// experiment too). -2: the accounting check counts post-exit dividends once (log entry 2). -3 (2026-11-05): the
// mechanism engine, per-campaign plans, the null's eligible-set construction, Holm reporting, defect replacements.
export const CODE_REVISION = 'rr-code-2026-11-05-1';
export const RUNNER_VERSION = 'rr-runner-2';

// The only period an experiment may use: HXR's development period, read from the pinned periods file.
export function developmentPeriod() {
  const p = loadHxrPeriods().periods.development;
  return { basket: p.basket, warmupFrom: p.warmupFrom, start: p.start, end: p.end };
}

// Campaign limits and the pre-registered criteria (CAMPAIGN-1.md sections 4 to 7). Every number the runner
// enforces is here, once.
export const LIMITS = Object.freeze({
  maxConfigs: 100,            // unique configurations per campaign
  maxHours: 12,               // wall-clock hours per campaign
  minFreeBytes: 1024 ** 3,    // 1 GB free on the data volume before each experiment
  maxHeapBytes: 1536 * 1024 ** 2, // 1.5 GB heap after an experiment: stop
  maxExperimentMs: 120_000,   // one experiment longer than this: recorded, campaign stopped
  staleHeartbeatMs: 120_000,  // a worker silent this long is treated as gone
  concurrency: 1,             // workers per campaign by default
});

export const CRITERIA = Object.freeze({
  improvement: 0.10,          // net profit at least 10% above the campaign baseline's
  maxDrawdownPct: 15,         // of starting equity, peak to trough on closes
  minCompletedTrades: 30,     // the adopted minimum sample (PROPOSED-RULES.md definition 2)
  maxTopStockShare: 0.40,     // single-stock gross-gain share (definition 4); a shortlist condition, reported for all
  notifyStep: 0.05,           // a later notification needs net profit at least this share of the baseline's above the last notified candidate's
  reconcileToleranceUsd: 0.05, // accounting: net P/L must equal trade P/L (post-exit dividends included) + open P/L within this
  bestFiveFraction: 0.05,     // the stress: the top ceil(5% n) outcomes removed; the remaining net profit must still be at least the baseline's net profit
  nullResamples: 2000,        // the random-timing null: each trade's entry moved to a random session of its stock, same shares and sessions held
  nullSeed: 20261104,         // fixed seed (mulberry32); p = (1 + resamples with net >= the run's) / (1 + resamples)
  nullMaxP: 0.05,             // a shortlisted candidate needs p at or below this (the unadjusted screen)
  holmAlpha: 0.05,            // the within-campaign Holm family-wise level, reported, never enforced
});

export const BASELINE_FILE = 'rt-trend-immediate-nolimit-0.2.0.json';
export const BASE_FILES = Object.freeze({
  B: 'rt-trend-immediate-nolimit-0.2.0.json', // breakout (immediate) entry: the baseline
  D: 'rt-range-dip-nolimit-0.2.0.json',        // range dip: mean reversion
  R: 'rt-range-recovery-nolimit-0.2.0.json',   // range recovery: dip recovery
  P: 'rt-trend-pullback-nolimit-0.2.0.json',   // trend pullback
});

export const STAGES = Object.freeze({ reference: 0, singleB: 1, singleOthers: 2, combinations: 3 });
export const STAGE_NAMES = Object.freeze({ 0: 'reference (the eight planned configs re-run)', 1: 'single-component changes from the baseline', 2: 'single-component changes from the other three bases', 3: 'selected combinations' });
export const LABELS = Object.freeze({ DEVELOPMENT: 'development result', SHORTLISTED: 'shortlisted candidate', EVALUATED: 'independently evaluated', HOLM: 'Holm-significant (within-campaign)' });
export const CAMPAIGN_STATUSES = ['planned', 'running', 'paused', 'cancelled', 'done', 'stopped'];
export const EXPERIMENT_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];

// The campaign plans. A plan names its pre-registered document, the strings the document must contain, its
// limits and criteria, the planned count, the Holm family size, the number of defect-replacement slots and
// whether a combination stage is built. Campaign 2 ran under plan campaign-1 (the same document).
export const PLANS = Object.freeze({
  'campaign-1': Object.freeze({
    key: 'campaign-1', name: 'Campaign 1', doc: CAMPAIGN_DOC, limits: LIMITS, criteria: CRITERIA, plannedCount: 84, holmFamily: null, replacements: 0, combinations: true, space: 'planned',
    required: [BASELINE_FILE, String(LIMITS.maxConfigs), `${LIMITS.maxHours}`, `${CRITERIA.maxDrawdownPct}%`, `${CRITERIA.minCompletedTrades}`], stageNames: STAGE_NAMES,
  }),
  'campaign-3': Object.freeze({
    key: 'campaign-3', name: 'Campaign 3', doc: CAMPAIGN3_DOC,
    limits: Object.freeze({ ...LIMITS, maxConfigs: 30, maxHours: 2 }),
    criteria: Object.freeze({ ...CRITERIA, nullResamples: 20000, nullSeed: 20261105 }),
    plannedCount: 24, holmFamily: 24, replacements: 6, combinations: false, space: 'campaign3',
    required: [BASELINE_FILE, '24 planned configurations', '30', '2 hours', '15%', '30 completed trades', '20,000', 'Holm', '1,757.90'],
    stageNames: Object.freeze({ 0: 'reference (campaign 2 baseline, reproduction)', 1: 'family baselines (B0, M0)', 2: 'mechanisms', 3: 'defect replacements' }),
  }),
});
export const planOf = (key) => { const p = PLANS[key]; if (!p) throw new Error(`unknown plan ${key}; known: ${Object.keys(PLANS).join(', ')}`); return p; };

export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
export const fileSha256 = (file) => textSha256(fs.readFileSync(file, 'utf8'));
export const experimentHash = (config) => (config?.strategy === 'mechanism' ? mechanismConfigHash(config) : rtConfigHash(config));
export { RT_PLANNED };

// The shared block every campaign-3 mechanism config must carry: the baseline's portfolio limits (without the
// range-trend-only fields), costs, dividends, execution, benchmark and period.
export function sharedBlock() {
  const b = loadRtConfig(BASELINE_FILE);
  return { portfolio: { startingCash: b.portfolio.startingCash, positionCapPct: b.portfolio.positionCapPct, riskPerTradePct: b.portfolio.riskPerTradePct, totalEntryRiskPct: b.portfolio.totalEntryRiskPct }, costs: { ...b.costs }, dividends: { ...b.dividends }, execution: { ...b.execution }, benchmark: { ...b.benchmark }, period: { ...b.period } };
}

// A config may run only on the development period, exactly, and must be a valid config of its engine; a
// mechanism config must carry the shared block unchanged.
export function configProblem(config) {
  const errors = config?.strategy === 'mechanism' ? validateMechanismConfig(config) : validateRtConfig(config);
  if (errors.length) return `invalid ${config?.strategy === 'mechanism' ? 'mechanism' : 'range-trend'} config: ${errors.join('; ')}`;
  const dev = developmentPeriod();
  const p = config.period || {};
  for (const k of ['basket', 'warmupFrom', 'start', 'end']) if (p[k] !== dev[k]) return `period.${k} must be ${dev[k]} (the development period; no other window has a code path here)`;
  if (config.strategy === 'mechanism') {
    const sh = sharedBlock();
    for (const k of Object.keys(sh)) if (JSON.stringify(config[k]) !== JSON.stringify(sh[k])) return `${k} must equal the campaign's shared block (${JSON.stringify(sh[k])})`;
  }
  return null;
}

export function assertDevelopmentPeriod(config) {
  const problem = configProblem(config);
  if (problem) throw new Error(`Research runner refuses the config: ${problem}`);
  return true;
}

// Campaign document status: it must exist, hold no open marker, and name the strings its plan requires.
export function campaignDocStatus(file = CAMPAIGN_DOC, required = PLANS['campaign-1'].required) {
  if (!fs.existsSync(file)) return { ok: false, hash: null, problem: `${path.basename(file)} does not exist` };
  const text = fs.readFileSync(file, 'utf8');
  if (/\[OWNER|\bTBD\b|\bTODO\b/.test(text)) return { ok: false, hash: textSha256(text), problem: 'the campaign document holds an open marker ([OWNER, TBD or TODO)' };
  if (/\bDRAFT\b/.test(text.split('\n').slice(0, 5).join('\n'))) return { ok: false, hash: textSha256(text), problem: 'the campaign document is still marked DRAFT in its status line' };
  const missing = required.filter((s) => !text.includes(s));
  if (missing.length) return { ok: false, hash: textSha256(text), problem: `the campaign document does not name ${missing.join(', ')}` };
  return { ok: true, hash: textSha256(text), problem: null };
}
