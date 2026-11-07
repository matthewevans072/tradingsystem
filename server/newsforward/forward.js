// news-forward's account (PROTOCOL-1.md): activation, the update (bounded download, plans recorded before the market
// can trigger them, the replay of every stored plan through news-replay's tested executor, the running report), the
// plan verification and the status. Every plan is built only from rows fetched before it was recorded (fetched_at),
// so it can be re-derived later; a plan recorded after its 30-minute activation window is late and cannot activate;
// a plan recorded after T looks only at bars that close after it was recorded. Simulation only.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { regularSessionBounds, nextTradingDay } from '../calendar.js';
import { tradingDays } from '../strategy/sessions.js';
import { newsItems, filingItems, planGroups } from '../newsreplay/items.js';
import { sessionProfile } from '../newsreplay/profile.js';
import { createLoader } from '../newsreplay/loader.js';
import { deterministicPlan, WINDOW_MS } from '../newsreplay/planner.js';
import { prepareMarket, runReplay } from '../newsreplay/sim.js';
import { evaluateActions, report as runReport, planFates } from '../newsreplay/evaluate.js';
import { holdIndex } from '../rangetrend/benchmark.js';
import { halfSpreadFn } from '../hxr/data.js';
import { hashOf, BASKET } from '../newsreplay/config.js';
import { etDate } from '../newsreplay/download.js';
import { CODE_REVISION, WARMUP_FROM, LABEL, NfError, loadPipeline, pipelineSha, ROOT } from './config.js';
import * as store from './store.js';
import * as dl from './download.js';

const ACCOUNT = 'fixed-rule';
const MS = new Map();
const msOf = (d, which) => { const k = `${d}|${which}`; if (!MS.has(k)) { const b = regularSessionBounds(d); MS.set(k, new Date(which === 'open' ? b.open : b.close).getTime()); } return MS.get(k); };
const head = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

export function createForward({ db, clock = () => new Date(), source = null, sec = null, spread = null, pipeline = null, words = null, log = () => {} }) {
  const now = () => clock();
  const P = () => pipeline ?? loadPipeline();
  const activation = () => store.getMeta(db, 'activation');

  function activate({ spreadTable }) {
    if (activation()) throw new NfError(409, 'news-forward is already activated');
    if (!spreadTable?.steps) throw new NfError(400, 'activation needs the frozen spread calibration (campaign 1\'s, samples on or before 2021-12-31)');
    const at = now().toISOString();
    const startSession = nextTradingDay(etDate(now().getTime()), 'NYSE');
    const rec = { at, startSession, codeRevision: CODE_REVISION, pipeline: P(), pipelineSha: pipeline ? hashOf(pipeline) : pipelineSha(), head: head(), warmupFrom: WARMUP_FROM, label: LABEL };
    store.tx(db, () => { store.setMeta(db, 'activation', rec, at); store.setMeta(db, 'spread', spreadTable, at); });
    store.logLine(db, at, 'info', `activated: start session ${startSession}`);
    return rec;
  }

  // The market and items from the store, optionally as of a fetch time (only rows fetched at or before it).
  function assemble({ asOf = null, today = etDate(now().getTime()) } = {}) {
    const keep = (r) => asOf == null || r.fetched_at <= asOf;
    const sessions = tradingDays(WARMUP_FROM, today, 'NYSE');
    const sessionIndex = new Map(sessions.map((d, i) => [d, i]));
    const daily = new Map(BASKET.map((s) => [s, new Map()])), dailyArr = new Map(BASKET.map((s) => [s, []]));
    for (const r of store.dailyFor(db).filter(keep)) { if (!sessionIndex.has(r.date)) continue; daily.get(r.symbol)?.set(r.date, { o: r.o, h: r.h, l: r.l, c: r.c }); dailyArr.get(r.symbol)?.push({ date: r.date, c: r.c }); }
    const bars1 = new Map(), bars5 = new Map();
    for (const s of BASKET) {
      const by1 = new Map(), by5 = new Map();
      for (const b of store.barsFor(db, s).filter(keep)) { if (!sessionIndex.has(b.date)) continue; if (!by1.has(b.date)) by1.set(b.date, []); by1.get(b.date).push(b); }
      for (const [d, list] of by1) {
        const open = msOf(d, 'open'), out = [];
        let cur = null;
        for (const b of list) {
          const k = Math.floor((b.minute - 570) / 5);
          if (!cur || cur.k !== k) { if (cur) out.push(cur); cur = { k, s: open + k * 300000, e: open + (k + 1) * 300000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; }
          else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
        }
        if (cur) out.push(cur);
        by5.set(d, out.map(({ k, ...x }) => x));
      }
      bars1.set(s, by1); bars5.set(s, by5);
    }
    const corp = store.corpFor(db).filter(keep);
    const splits = corp.filter((c) => c.type !== 'cash_dividend').map((c) => ({ symbol: c.symbol, date: c.ex_date, ratio: c.ratio }));
    const dividends = corp.filter((c) => c.type === 'cash_dividend').map((c) => ({ symbol: c.symbol, exDate: c.ex_date, payDate: c.pay_date, amount: c.amount }));
    const unitsFactor = (sym, date, asOfSession) => splits.reduce((f, x) => (x.symbol === sym && x.date > date && x.date <= asOfSession ? f * x.ratio : f), 1);
    const cache = new Map();
    const profiles = (sym, prior, asOfSession) => {
      const key = `${sym}|${prior}|${asOfSession}`;
      if (!cache.has(key)) { const pb = bars1.get(sym)?.get(prior) || []; const f = unitsFactor(sym, prior, asOfSession); cache.set(key, pb.length ? sessionProfile(pb.map((b) => ({ ...b, h: b.h / f, l: b.l / f, c: b.c / f, vw: b.vw ? b.vw / f : null })), { session: prior, asOfSession }) : null); }
      return cache.get(key);
    };
    const sp = spread ?? store.getMeta(db, 'spread');
    const market = prepareMarket({ sessions, sessionIndex, bars5, daily, profiles, splits, dividends, halfSpread: halfSpreadFn(sp), openMs: (d) => msOf(d, 'open'), closeMs: (d) => msOf(d, 'close') });
    const nsym = new Map();
    for (const r of store.newsSymbols(db)) { if (!nsym.has(r.news_id)) nsym.set(r.news_id, []); nsym.get(r.news_id).push(r.symbol); }
    const items = [...newsItems(store.newsFor(db).filter(keep).map((n) => ({ ...n, basketSymbols: nsym.get(n.id) ?? [] }))), ...filingItems(store.filingsFor(db).filter(keep))].filter((it) => sessionIndex.has(it.session));
    const loader = createLoader({ items, daily: dailyArr, bars5, bars1, splits, sessions });
    return { sessions, sessionIndex, daily, dailyArr, bars5, bars1, splits, dividends, market, items, loader, today };
  }

  // Records every plan whose eligible time has come and that is not stored yet (entry plans, then follow-up checks).
  function recordPlans(a, { nowMs, startSession }) {
    const pipe = P();
    const groups = planGroups(a.items, { from: startSession, to: a.today });
    const have = new Set(store.listPlans(db, ACCOUNT).map((p) => `${p.stock}|${p.session}|${p.eligibleMs}`));
    const stockSession = new Set(store.listPlans(db, ACCOUNT).map((p) => `${p.stock}|${p.session}`));
    let recorded = 0, late = 0;
    for (const g of groups) {
      const times = [...new Set(g.items.map((it) => it.eligibleMs))].sort((x, y) => x - y);
      for (const T of times) {
        if (T > nowMs || have.has(`${g.stock}|${g.session}|${T}`)) continue;
        const packet = a.loader.packetAt({ stock: g.stock, T, session: g.session });
        const followUp = stockSession.has(`${g.stock}|${g.session}`);
        const plan = { ...deterministicPlan(packet, { variant: pipe.planner, words, followUp }), notBeforeMs: nowMs };
        const isLate = nowMs >= T + WINDOW_MS;
        recorded += store.insertPlan(db, { account: ACCOUNT, stock: g.stock, session: g.session, eligibleMs: T, recordedAt: new Date(nowMs).toISOString(), recordedMs: nowMs, late: isLate, packetHash: hashOf(packet), plan, codeRevision: CODE_REVISION });
        if (isLate) late++;
        have.add(`${g.stock}|${g.session}|${T}`); stockSession.add(`${g.stock}|${g.session}`);
      }
    }
    return { recorded, late };
  }

  // The account: every stored plan through the executor, up to the last session with every daily bar.
  function account(a, { startSession }) {
    const pipe = P();
    const plans = store.listPlans(db, ACCOUNT).map((r) => ({ ...r.plan, id: r.id }));
    const complete = a.sessions.filter((d) => d >= startSession && BASKET.every((s) => a.daily.get(s).has(d)));
    if (!complete.length) return { asOf: null, report: null, actions: [], note: 'no complete session since the start yet' };
    const to = complete.at(-1);
    const r = runReplay({ plans, treatment: pipe.entry, market: a.market, costs: pipe.costs, portfolio: pipe.portfolio, from: startSession, to, exit: pipe.exit ?? 'existing' });
    const result = evaluateActions(r.actions, a.market, { from: startSession, to, startingCash: pipe.portfolio.startingCash, symbols: BASKET });
    const days = new Map(a.sessions.map((d) => [d, { bars: Object.fromEntries(BASKET.map((s) => [s, a.daily.get(s).get(d)]).filter(([, b]) => b)), splits: a.splits.filter((x) => x.date === d), dividends: a.dividends.filter((x) => x.exDate === d) }]));
    const index = holdIndex({ symbols: BASKET, sessions: a.sessions.filter((d) => d <= to), days, start: startSession, startingCash: pipe.portfolio.startingCash, withholdingPct: pipe.costs.withholdingPct });
    const rep = runReport(result, { index, startingCash: pipe.portfolio.startingCash, signals: r.signals, plansMeta: { entryPlans: plans.filter((p) => !p.followUp).length, followUps: plans.filter((p) => p.followUp).length } });
    rep.planFates = planFates(r.actions, result.trades, result.openPositions, new Map(plans.map((p) => [p.id, p.category ?? 'unknown'])));
    return { asOf: to, report: rep, actions: r.actions, equity: result.equity, label: LABEL };
  }

  async function update({ kind = 'manual', withFilings = true } = {}) {
    const act = activation();
    if (!act) throw new NfError(409, 'news-forward is not activated (npm run nf:activate)');
    const startedAt = now().toISOString();
    const today = etDate(now().getTime());
    const detail = { today };
    try {
      if (!source) throw new NfError(409, 'no market-data source configured');
      const clockFn = () => now();
      detail.daily = await dl.downloadDaily({ db, src: source, today, clock: clockFn });
      detail.intraday = await dl.downloadIntraday({ db, src: source, today, clock: clockFn, from: WARMUP_FROM });
      detail.news = await dl.downloadNews({ db, src: source, clock: clockFn, from: act.startSession });
      detail.corporate = await dl.downloadCorporateActions({ db, src: source, clock: clockFn, from: WARMUP_FROM });
      if (withFilings && sec) detail.filings = await dl.downloadFilings({ db, sec, clock: clockFn, from: act.startSession });
      // Plans: built from the rows stored now, recorded now.
      const nowMs = now().getTime();
      const a = assemble({ asOf: new Date(nowMs).toISOString(), today });
      detail.plans = recordPlans(a, { nowMs, startSession: act.startSession });
      const full = assemble({ today });
      const acc = account(full, { startSession: act.startSession });
      detail.account = acc.report ? { asOf: acc.asOf, net: acc.report.net, T: acc.report.T, trades: acc.report.completedTrades, open: acc.report.openAtEnd, maxDrawdownPct: acc.report.maxDrawdownPct } : { note: acc.note };
      if (acc.report) store.insertSnapshot(db, ACCOUNT, acc.asOf, now().toISOString(), acc.report);
      const finishedAt = now().toISOString();
      store.insertUpdate(db, { startedAt, finishedAt, kind, status: 'done', detail });
      store.logLine(db, finishedAt, 'info', `update ${kind}: plans recorded ${detail.plans.recorded} (late ${detail.plans.late}); account as of ${acc.asOf ?? '—'}`);
      return { status: 'done', detail };
    } catch (e) {
      const finishedAt = now().toISOString();
      store.insertUpdate(db, { startedAt, finishedAt, kind, status: 'failed', detail: { ...detail, error: e.message } });
      store.logLine(db, finishedAt, 'error', `update ${kind} failed: ${e.message}`);
      throw e;
    }
  }

  // Re-derives every plan from the rows fetched by its recording time and checks the chain and the packet hashes.
  function verify() {
    const rows = store.listPlans(db, ACCOUNT);
    const chain = store.verifyPlanChain(rows);
    const bad = [];
    const byTime = new Map();
    for (const r of rows) { const k = r.recordedAt; if (!byTime.has(k)) byTime.set(k, []); byTime.get(k).push(r); }
    for (const [at, list] of byTime) {
      const a = assemble({ asOf: at, today: etDate(Date.parse(at)) });
      for (const r of list) { const packet = a.loader.packetAt({ stock: r.stock, T: r.eligibleMs, session: r.session }); if (hashOf(packet) !== r.packetHash) bad.push(r.id); }
    }
    return { plans: rows.length, chain, packetMismatches: bad };
  }

  function status() {
    const act = activation();
    const plans = store.listPlans(db, ACCOUNT);
    const updates = store.listUpdates(db, 20);
    return { simulated: true, label: LABEL, activation: act, worker: store.worker(db), plans: { total: plans.length, late: plans.filter((p) => p.late).length, entry: plans.filter((p) => !p.plan.followUp).length }, updates, snapshots: store.listSnapshots(db, ACCOUNT).slice(-60), log: store.listLog(db, 30) };
  }

  return { activate, assemble, recordPlans, account, update, verify, status, ACCOUNT, token: () => crypto.randomBytes(8).toString('hex') };
}
