// news-replay campaign 1 (CAMPAIGN-1.md): assembles the bounded data, writes the plans (append-only, hash-chained,
// each with its input packet's hash), runs the deterministic and price-only arms through the executor, evaluates
// outcomes from the saved actions only, runs the date-clustered placebo, applies Holm over the six pre-registered
// comparisons, and writes the report. The AI arms run only from cached responses or with the owner's key and cap.
// Simulation only: nothing here reads real holdings or cash, writes another programme's database, or places an order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig as loadAppConfig } from '../config.js';
import { regularSessionBounds } from '../calendar.js';
import { tradingDays } from '../strategy/sessions.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates } from '../hxr/config.js';
import { openHxrReadOnly, loadWindowInputs, boundedSpreadTable, halfSpreadFn } from '../eventswing/data.js';
import { holmAdjust } from '../research/runner.js';
import { REPLAY, DATA_FROM, MAX_DATE, BASKET, CODE_REVISION, ENGINE_VERSION, PREREG, CLOSED_WINDOWS, LOG_PATH, REPORT_DIR, MATRIX_PATH, WORDS_PATH, NrError, hashOf, sha256, readLog, logStatus, appendLogEntry, isAncestor, committedSha, uncommitted, headCommit, textSha256 } from './config.js';
import * as store from './store.js';
import { newsItems, filingItems, fomcItems, planGroups } from './items.js';
import { sessionProfile, compositeTarget } from './profile.js';
import { createLoader } from './loader.js';
import { deterministicPlan, classifyHeadline } from './planner.js';
import { prepareMarket, runReplay, activationOf } from './sim.js';
import { evaluateActions, indexFor, tOf, report as runReport, planFates } from './evaluate.js';
import { groupPlaceboDrawer, mulberry32, pValue, movedItems } from './placebo.js';
import { typicalMoveOf, ACTIVATION_M, INVALIDATION_M } from './planner.js';
import { loadAiSpec, estimateCost } from './ai.js';

const DAILY_FROM = '2019-10-01';
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
// Session open and close times, cached (the timezone arithmetic is costly and the placebo asks for them often).
const MS_CACHE = new Map();
const ms = (d, which) => { const k = `${d}|${which}`; let v = MS_CACHE.get(k); if (v == null) { const b = regularSessionBounds(d); v = new Date(which === 'open' ? b.open : b.close).getTime(); MS_CACHE.set(k, v); } return v; };

export function createNewsReplay({ dataDir = null, dbFile = null, testOverrides = false, overrides = {}, clock = () => new Date() } = {}) {
  const appCfg = loadAppConfig();
  const dir = dataDir ?? appCfg.dataDir;
  const changed = Object.keys(overrides).filter((k) => overrides[k] !== undefined);
  if ((changed.length || dbFile) && !testOverrides) throw new Error(`createNewsReplay: ${changed.join(', ')} can be changed only with testOverrides: true (tests only)`);
  const db = store.openNrDb(dbFile ?? store.nrDbFile(dir));
  const matrix = overrides.matrix ?? JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));
  const words = overrides.words ?? JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const logFile = overrides.logFile ?? LOG_PATH;
  const reportDir = overrides.reportDir ?? REPORT_DIR;
  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);
  const from = overrides.from ?? REPLAY.from, to = overrides.to ?? REPLAY.to;
  let A = null;

  // ---------- the data, bounded at every load ----------
  function assemble() {
    if (A) return A;
    const hdb = overrides.hxrDb ?? openHxrReadOnly(dir);
    let inputs, spread;
    const universe = overrides.universe ?? basketSymbols(loadHxrUniverse(), 'A').map((s) => ({ symbol: s.symbol, exchange: s.exchange, listedFrom: s.listedFrom }));
    const excluded = overrides.excluded ?? excludedDates(loadHxrPeriods()).filter((d) => d <= MAX_DATE);
    try {
      inputs = loadWindowInputs(hdb, { universe, from: overrides.dailyFrom ?? DAILY_FROM, to: MAX_DATE, excluded });
      spread = boundedSpreadTable(hdb, universe, { floorBps: matrix.costs.halfSpreadFloorBps });
    } finally { if (!overrides.hxrDb) hdb.close(); }
    const syms = universe.map((u) => u.symbol);
    const sessions = inputs.sessions;
    const sessionIndex = new Map(sessions.map((d, i) => [d, i]));
    const daily = new Map(syms.map((s) => [s, new Map()]));
    const dailyArr = new Map(syms.map((s) => [s, []]));
    const splits = [], dividends = [];
    for (const d of sessions) {
      const day = inputs.days.get(d);
      for (const [s, b] of Object.entries(day.bars)) { daily.get(s).set(d, b); dailyArr.get(s).push({ date: d, c: b.c }); }
      for (const sp of day.splits) splits.push({ symbol: sp.symbol, date: d, ratio: sp.ratio });
      for (const dv of day.dividends) dividends.push({ symbol: dv.symbol, exDate: d, payDate: dv.payDate, amount: dv.amount });
    }
    const bars1 = new Map(), bars5 = new Map();
    for (const s of syms) {
      const by1 = new Map(), by5 = new Map();
      for (const b of store.barsFor(db, s, { from: DATA_FROM, to: MAX_DATE })) {
        if (!sessionIndex.has(b.date)) continue;
        if (!by1.has(b.date)) by1.set(b.date, []);
        by1.get(b.date).push(b);
      }
      for (const [d, list] of by1) {
        const open = ms(d, 'open'), out = [];
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
    const nsym = new Map();
    for (const r of store.newsSymbols(db)) { if (!nsym.has(r.news_id)) nsym.set(r.news_id, []); nsym.get(r.news_id).push(r.symbol); }
    const items = [
      ...newsItems(store.newsFor(db).map((n) => ({ ...n, basketSymbols: nsym.get(n.id) ?? [] }))),
      ...filingItems(store.filingsFor(db)),
      ...fomcItems(store.fomcFor(db)),
    ].filter((it) => it.session <= MAX_DATE).map((it) => {
      // An item whose eligible session is excluded (periods-hxr-v3.json: 2021-10-25, almost no NYSE trades at Alpaca)
      // becomes eligible at the next included session's first bar close.
      if (sessionIndex.has(it.session) || it.session < sessions[0]) return it;
      const next = sessions.find((d) => d > it.session);
      return next ? { ...it, session: next, eligibleMs: ms(next, 'open') + 300000, movedFromExcludedSession: it.session } : { ...it, session: '9999-12-31' };
    }).filter((it) => it.session <= MAX_DATE);
    const unitsFactor = (sym, date, asOf) => splits.reduce((f, x) => (x.symbol === sym && x.date > date && x.date <= asOf ? f * x.ratio : f), 1);
    const profCache = new Map();
    const profiles = (sym, prior, asOf) => {
      const key = `${sym}|${prior}|${asOf}`;
      if (!profCache.has(key)) { const pb = bars1.get(sym)?.get(prior) || []; const f = unitsFactor(sym, prior, asOf); profCache.set(key, pb.length ? sessionProfile(pb.map((b) => ({ ...b, h: b.h / f, l: b.l / f, c: b.c / f, vw: b.vw ? b.vw / f : null })), { session: prior, asOfSession: asOf }) : null); }
      return profCache.get(key);
    };
    // Campaign 2's composite target (CAMPAIGN-2.md section 5): the five completed sessions before the fill session, in its units.
    const composite = (sym, fillSession, fillPrice) => {
      const i = sessionIndex.get(fillSession);
      const list = sessions.slice(Math.max(0, i - 5), i).map((d) => { const f = unitsFactor(sym, d, fillSession); return { session: d, bars: (bars1.get(sym)?.get(d) || []).map((b) => ({ ...b, h: b.h / f, l: b.l / f, c: b.c / f })) }; });
      return compositeTarget(list, { fillSession, fillPrice });
    };
    const market = prepareMarket({ sessions, sessionIndex, bars5, daily, profiles, composite, splits, dividends, halfSpread: halfSpreadFn(spread), openMs: (d) => ms(d, 'open'), closeMs: (d) => ms(d, 'close') });
    const loader = createLoader({ items, daily: dailyArr, bars5, bars1, splits, sessions });
    const replaySessions = sessions.filter((d) => d >= from && d <= to);
    const itemSessions = new Map(syms.map((s) => [s, new Set()]));
    for (const it of items) for (const s of it.stocks) itemSessions.get(s)?.add(it.session);
    const itemFree = new Map(syms.map((s) => [s, replaySessions.filter((d) => bars5.get(s)?.has(d) && !itemSessions.get(s).has(d))]));
    const controls = new Map(syms.map((s) => [s, replaySessions.filter((d) => { const i = sessionIndex.get(d); if (!bars5.get(s)?.has(d)) return false; for (let j = i - 3; j <= i + 3; j++) { const dd = sessions[j]; if (dd && itemSessions.get(s).has(dd)) return false; } return true; })]));
    const groups = planGroups(items, { from, to });
    A = { universe, syms, inputs, spread, sessions, sessionIndex, daily, dailyArr, splits, dividends, bars1, bars5, items, market, loader, itemFree, controls, groups, index: indexFor(inputs, { from, startingCash: matrix.portfolio.startingCash, withholdingPct: matrix.costs.withholdingPct }), inputsHash: inputs.inputsHash, calibrationHash: spread.hash };
    return A;
  }

  // ---------- plans: entry plans at T and follow-up checks at later eligible times of the session ----------
  function planSet(planner, groups, { light = false } = {}) {
    const a = assemble();
    const out = [];
    if (planner === 'P') {
      for (const [s, list] of a.controls) for (const d of list) {
        const T = ms(d, 'open') + 300000;
        const packet = a.loader.packetAt({ stock: s, T, session: d, control: true, light });
        out.push({ packet, plan: deterministicPlan(packet, { variant: 'P' }) });
      }
      return out.sort((x, y) => x.plan.T - y.plan.T || (x.plan.stock < y.plan.stock ? -1 : 1));
    }
    for (const g of groups) {
      const times = [...new Set((g.placeboOf ? movedItems(g) : g.items).map((it) => it.eligibleMs))].sort((x, y) => x - y);
      times.forEach((T, j) => {
        const packet = a.loader.packetAt({ stock: g.stock, T, session: g.session, itemsOverride: g.placeboOf ? movedItems(g) : null, light });
        out.push({ packet, plan: deterministicPlan(packet, { variant: planner, words, followUp: j > 0 }) });
      });
    }
    return out.sort((x, y) => x.plan.T - y.plan.T || (x.plan.stock < y.plan.stock ? -1 : 1) || (x.plan.followUp ? 1 : 0) - (y.plan.followUp ? 1 : 0));
  }
  // The stored plans of a planner: written once (append-only, chained); later calls verify the chain and recompute
  // every packet hash.
  function storedPlans(planner) {
    const a = assemble();
    const rows = store.listPlans(db, planner);
    const fresh = planSet(planner, a.groups);
    if (!rows.length) {
      store.tx(db, () => { for (const { packet, plan } of fresh) store.insertPlan(db, { planner, stock: plan.stock, session: plan.session, eligibleMs: plan.T, packetHash: hashOf(packet), plan, at: now(), codeRevision: CODE_REVISION }); });
      return storedPlans(planner);
    }
    const chain = store.verifyChain(rows, (r) => `${r.packetHash}|${sha256(JSON.stringify(r.plan))}`);
    if (!chain.ok) throw new NrError(500, `the ${planner} plan chain is broken at row ${chain.at}`);
    if (rows.length !== fresh.length || rows.some((r, i) => r.packetHash !== hashOf(fresh[i].packet))) throw new NrError(500, `the stored ${planner} plans differ from the plans the frozen code makes from the stored data`);
    return rows.map((r) => ({ ...r.plan, id: r.id }));
  }


  // ---------- the fast plan path (the placebo): the deterministic planners' arithmetic on cached inputs ----------
  // Same levels as deterministicPlan on the loader's packet (runPlacebo checks equality on every real group before use): R = the
  // last 5-minute close at or before T, else the previous daily close; m from the 21 closes before the session in its
  // share units; DC disarms on a negative headline among the items eligible by T.
  let F = null;
  function fastInputs() {
    if (F) return F;
    const a = assemble();
    const mCache = new Map(), prevClose = new Map();
    const unitsFactor = a.loader.unitsFactor;
    const mOf = (sym, session) => {
      const k = `${sym}|${session}`;
      if (!mCache.has(k)) {
        const arr = a.dailyArr.get(sym) || [];
        let hi = arr.length; while (hi > 0 && arr[hi - 1].date >= session) hi--;
        const w = arr.slice(Math.max(0, hi - 25), hi).map((r) => ({ date: r.date, c: r.c / unitsFactor(sym, r.date, session) }));
        mCache.set(k, typicalMoveOf(w)); prevClose.set(k, w.at(-1)?.c ?? null);
      }
      return mCache.get(k);
    };
    const Rof = (sym, session, T) => {
      const bars = a.bars5.get(sym)?.get(session) || [];
      let lo = 0, hi = bars.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].e <= T) lo = mid + 1; else hi = mid; }
      if (lo > 0) return bars[lo - 1].c;
      mOf(sym, session); return prevClose.get(`${sym}|${session}`);
    };
    const meta = new Map();
    for (const g of a.groups) {
      const times = [...new Set(g.items.map((it) => it.eligibleMs))].sort((x, y) => x - y);
      const negativeBy = times.map((t) => g.items.some((it) => it.eligibleMs <= t && classifyHeadline(it.headline, words) === 'negative'));
      meta.set(g, { times, negativeBy });
    }
    F = { mOf, Rof, meta };
    return F;
  }
  function fastPlans(groups) {
    const f = fastInputs();
    const out = [];
    for (const g of groups) {
      const orig = g.orig ?? g, shift = g.shift ?? 0, mt = f.meta.get(orig);
      mt.times.forEach((t0, j) => {
        const T = t0 + shift, m = f.mOf(g.stock, g.session), R = f.Rof(g.stock, g.session, T);
        const base = { stock: g.stock, session: g.session, T, followUp: j > 0 };
        if (R == null || m == null || !(m > 0)) { out.push({ ...base, status: 'no_trade', negative: mt.negativeBy[j] }); return; }
        out.push({ ...base, status: 'armed', negative: mt.negativeBy[j], bullish: { armed: true, activation: { level: R + ACTIVATION_M * m } }, bearish: { activation: { level: R - ACTIVATION_M * m } }, invalidation: { level: R - INVALIDATION_M * m } });
      });
    }
    return out.sort((x, y) => x.T - y.T || (x.stock < y.stock ? -1 : 1) || (x.followUp ? 1 : 0) - (y.followUp ? 1 : 0));
  }
  const asDC = (plans) => plans.map((p) => (p.status === 'armed' && p.negative ? { ...p, bullish: { ...p.bullish, armed: false } } : p));

  // ---------- counts (before any run) ----------
  function counts() {
    const a = assemble();
    const per = Object.fromEntries(a.syms.map((s) => [s, { news: 0, newsMoreThan3Symbols: 0, revised: 0, filings: 0, outsideHours: 0, entryPlans: 0, followUps: 0, controlSessions: a.controls.get(s).length, itemFreeSessions: a.itemFree.get(s).length, negativeHeadlinePlans: 0, bullish: 0, bearish: 0, none: 0, intradaySessions: a.bars5.get(s)?.size ?? 0, firstIntraday: [...(a.bars5.get(s)?.keys() ?? [])].sort()[0] ?? null }]));
    for (const it of a.items) {
      if (it.kind === 'news') {
        const tags = it.allSymbols.map((x) => (x === 'FB' ? 'META' : x)).filter((x) => a.syms.includes(x));
        for (const s of new Set(tags)) { if (!per[s]) continue; if (it.stocks.includes(s)) { per[s].news++; if (it.revised) per[s].revised++; if (it.outsideHours) per[s].outsideHours++; } else per[s].newsMoreThan3Symbols++; }
      } else if (it.kind === 'filing') { const s = it.stocks[0]; per[s].filings++; if (it.outsideHours) per[s].outsideHours++; }
    }
    const D = planSet('D', a.groups, { light: true });
    for (const { plan } of D) { const p = per[plan.stock]; if (plan.followUp) { p.followUps++; continue; } p.entryPlans++; const act = activationOf(plan, a.market); p[act ? (act.dir === 'bull' ? 'bullish' : 'bearish') : 'none']++; }
    for (const g of a.groups) if (g.items.some((it) => classifyHeadline(it.headline, words) === 'negative' && it.eligibleMs === g.T)) per[g.stock].negativeHeadlinePlans++;
    const tot = (k) => Object.values(per).reduce((x, p) => x + p[k], 0);
    const comparisons = {
      C1: Math.min(tot('entryPlans'), tot('controlSessions')), C2: tot('negativeHeadlinePlans'), C3: null, C4: null, C5: tot('bullish'), C6: tot('bullish'),
    };
    const descriptive = Object.fromEntries(Object.entries(comparisons).map(([k, n]) => [k, n == null ? 'pending (AI arms not run)' : n < matrix.inference.descriptiveBelowEvents ? 'descriptive only' : 'tested']));
    const fomc = a.items.filter((it) => it.kind === 'fomc').length;
    return { perStock: per, totals: { entryPlans: tot('entryPlans'), followUps: tot('followUps'), controlSessions: tot('controlSessions'), news: tot('news'), filings: tot('filings'), revised: tot('revised'), fomc }, comparisons, descriptive, replay: { from, to, sessions: a.sessions.filter((d) => d >= from && d <= to).length } };
  }
  function manifest() {
    const bars = store.barCoverage(db);
    const news = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS a, MAX(created_at) AS b FROM nr_news').get();
    const newsHash = sha256(db.prepare('SELECT id, created_at, updated_at, headline FROM nr_news ORDER BY id').all().map((r) => `${r.id}|${r.created_at}|${r.updated_at}|${sha256(r.headline ?? '')}`).join('\n'));
    const filings = store.filingsFor(db), fomc = store.fomcFor(db);
    const barSum = db.prepare('SELECT symbol, COUNT(*) AS n, ROUND(SUM(c), 4) AS s, ROUND(SUM(v), 0) AS v FROM nr_bars1m GROUP BY symbol ORDER BY symbol').all();
    const m = { method: 'nr-manifest-1', bars: barSum, newsCount: news.n, newsHash, filings: filings.map((f) => [f.accession, f.acceptedEt]), fomc: fomc.map((f) => [f.id, f.releaseEt]) };
    return { hash: hashOf(m), bars, news, filings: filings.length, fomc: fomc.length };
  }
  function countsMarkdown(c) {
    const L = [`Replay ${c.replay.from} to ${c.replay.to} (${c.replay.sessions} sessions). Totals: ${c.totals.entryPlans} entry plans and ${c.totals.followUps} follow-up checks from ${c.totals.news} news items (at most three symbols) and ${c.totals.filings} filings; ${c.totals.revised} news items possibly revised; ${c.totals.controlSessions} price-only control sessions; ${c.totals.fomc} FOMC statements (context for the AI planner only).`, '', '| Stock | First 1-min session | 1-min sessions | News (≤3 symbols) | News (>3, not used) | Possibly revised | Filings | Outside hours | Entry plans | Follow-ups | Bullish | Bearish | No activation | Negative-headline plans | Item-free sessions | Control sessions |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
    for (const [s, p] of Object.entries(c.perStock)) L.push(`| ${s} | ${p.firstIntraday} | ${p.intradaySessions} | ${p.news} | ${p.newsMoreThan3Symbols} | ${p.revised} | ${p.filings} | ${p.outsideHours} | ${p.entryPlans} | ${p.followUps} | ${p.bullish} | ${p.bearish} | ${p.none} | ${p.negativeHeadlinePlans} | ${p.itemFreeSessions} | ${p.controlSessions} |`);
    L.push('', '| Comparison | Events | Status |', '|---|---|---|');
    for (const [k, n] of Object.entries(c.comparisons)) L.push(`| ${k} | ${n ?? '—'} | ${c.descriptive[k]} |`);
    return L.join('\n');
  }

  // ---------- the gate ----------
  function gateStatus() {
    const conds = [];
    const add = (name, ok, detail) => conds.push({ name, ok: !!ok, detail });
    if (overrides.skipGit) { add('pinned files', true, 'skipped (tests)'); add('campaign commit', true, 'skipped (tests)'); add('no uncommitted change', true, 'skipped (tests)'); }
    else {
      const pins = Object.entries(PREREG.sha256);
      add('pinned files', PREREG.commit && pins.length === 4 && pins.every(([f, want]) => textSha256(fs.readFileSync(path.join(path.dirname(MATRIX_PATH), f), 'utf8')) === want), PREREG.commit ? `${pins.length} files pinned` : 'not pinned yet (set at the campaign commit)');
      add('campaign commit', PREREG.commit && isAncestor(PREREG.commit) && pins.every(([f, want]) => committedSha(PREREG.commit, `strategy/news-replay/${f}`) === want), PREREG.commit ? PREREG.commit.slice(0, 7) : 'none');
      const dirty = uncommitted();
      add('no uncommitted change', !dirty.length, dirty.length ? dirty.slice(0, 5).join('; ') : 'committed');
    }
    const dls = store.listDownloads(db);
    const kinds = ['intraday_1min', 'news', 'filings'];
    const missing = [];
    for (const k of kinds) for (const s of BASKET) if (!dls.some((d) => d.kind === k && d.symbol === s && d.status === 'complete')) missing.push(`${k} ${s}`);
    if (!dls.some((d) => d.kind === 'fomc')) missing.push('fomc');
    add('data downloaded', !missing.length, missing.length ? `missing: ${missing.slice(0, 6).join(', ')}` : 'intraday, news, filings and FOMC complete');
    const log = logStatus(readLog(logFile));
    add('event counts recorded', log.counts.length >= 1, log.counts.length ? `log entry ${log.counts[0]}` : 'no **Event counts** entry');
    const man = manifest();
    const frozen = log.frozen.filter((f) => f.codeRevision === CODE_REVISION && (overrides.skipGit || f.commit === PREREG.commit) && f.manifest === man.hash);
    add('frozen for campaign 1', frozen.length === 1, frozen.length ? `log entry ${frozen[0].number}` : `no entry names ${CODE_REVISION} and manifest ${man.hash.slice(0, 12)}`);
    const logged = new Set(log.runs.map((r) => r.runId));
    const unlogged = store.listRuns(db).filter((r) => r.status !== 'running' && !logged.has(r.id));
    add('every run logged', !unlogged.length, unlogged.length ? `runs ${unlogged.map((r) => r.id).join(', ')}` : 'yes');
    return { ok: conds.every((c) => c.ok), conditions: conds, manifest: man };
  }
  function recordCounts() {
    if (logStatus(readLog(logFile)).counts.length) throw new NrError(409, 'the event counts are already recorded');
    const c = counts();
    return appendLogEntry({ title: '**Event counts** (before any run; signals counted, no outcome computed)', body: countsMarkdown(c), date: today(), file: logFile });
  }
  function freeze() {
    const g = gateStatus();
    const need = ['pinned files', 'campaign commit', 'no uncommitted change', 'data downloaded', 'event counts recorded'];
    const bad = g.conditions.filter((c) => need.includes(c.name) && !c.ok);
    if (bad.length) throw new NrError(409, `cannot freeze: ${bad.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
    const a = assemble();
    return appendLogEntry({ title: '**Frozen for campaign 1**', body: `code revision: \`${CODE_REVISION}\`; engine \`${ENGINE_VERSION}\`; campaign commit: \`${PREREG.commit ?? 'tests'}\`; HEAD \`${overrides.skipGit ? 'tests' : headCommit()}\`; data manifest hash: \`${g.manifest.hash}\`; daily inputs hash \`${a.inputsHash}\`; calibration hash \`${a.calibrationHash}\` (samples on or before ${MAX_DATE}). Configurations and settings: matrix-v1.json, headline-words-v1.json, ai-planner-v1.json and CAMPAIGN-1.md as pinned. Implementation ends here.`, date: today(), file: logFile });
  }

  // ---------- runs ----------
  const plannerOf = (id) => matrix.configurations.find((c) => c.id === id);
  // Phase order (CAMPAIGN-1.md section 11): Phase A's D-A and P-A first, then Phase B1; the placebo after every base run.
  const RUNNABLE = [...matrix.phases.A, ...matrix.phases.B1];
  function executeConfig(id, plans, variant = null, { activations = null, lean = false } = {}) {
    const a = assemble(), c = plannerOf(id);
    const v = variant ? matrix.sensitivities.find((s) => s.id === variant) : {};
    return runReplay({ plans, treatment: c.entry, market: a.market, costs: matrix.costs, portfolio: matrix.portfolio, from, to, costMultiplier: v.costMultiplier ?? 1, delay: v.delay ?? null, activations, lean });
  }
  const evaluate = (actions) => { const a = assemble(); return evaluateActions(actions, a.market, { from, to, startingCash: matrix.portfolio.startingCash, symbols: a.syms }); };
  function runAll({ log = () => {}, maxMs = matrix.budget.deterministicAndPriceOnlyHours * 3600_000, phase = null } = {}) {
    if (phase != null && !matrix.phases[phase]) throw new NrError(400, `unknown phase ${phase} (${Object.keys(matrix.phases).join(', ')})`);
    const ids = phase == null ? RUNNABLE : matrix.phases[phase];
    const g = gateStatus();
    if (!g.ok) throw new NrError(409, `The gate is closed: ${g.conditions.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')}`);
    const token = crypto.randomBytes(8).toString('hex');
    if (!store.takeLock(db, { token, at: now(), staleMs: 600000 }).ok) throw new NrError(409, 'another news-replay worker holds the lock');
    const t0 = Date.now();
    try {
      const plans = { D: storedPlans('D'), DC: storedPlans('DC'), P: storedPlans('P') };
      for (const id of ids) for (const variant of [null, ...matrix.sensitivities.map((s) => s.id)]) {
        const vname = variant ?? 'base';
        if (store.listRuns(db).some((r) => r.configId === id && r.variant === vname && r.status === 'done')) continue;
        const c = plannerOf(id);
        const runId = store.startRun(db, { configId: id, variant: vname, configHash: hashOf({ c, matrix: { portfolio: matrix.portfolio, costs: matrix.costs }, variant: vname }), codeRevision: CODE_REVISION, manifestHash: g.manifest.hash, startedAt: now() });
        const s0 = Date.now();
        try {
          const r = executeConfig(id, plans[c.planner], variant);
          store.insertActions(db, runId, [...r.actions].map((x, i) => ({ ...x, _i: i })).sort((x, y) => x.ms - y.ms || x._i - y._i).map(({ _i, ...x }) => x));
          // The evaluation pass reads the saved actions back.
          const saved = store.listActions(db, runId);
          const result = evaluate(saved);
          const rep = runReport(result, { index: assemble().index, startingCash: matrix.portfolio.startingCash, signals: r.signals, plansMeta: { entryPlans: plans[c.planner].filter((p) => !p.followUp).length, followUps: plans[c.planner].filter((p) => p.followUp).length } });
          rep.planFates = planFates(saved, result.trades, result.openPositions, new Map(plans[c.planner].map((p) => [p.id, p.category ?? (c.planner === 'P' ? 'control' : 'unknown')])));
          store.insertEvaluation(db, runId, { report: rep, equity: result.equity.map((p) => [p.date, r2(p.equity), Math.round(p.invested * 1e4) / 1e4]) }, now());
          store.finishRun(db, runId, { status: 'done', summary: { report: rep }, at: now(), durationMs: Date.now() - s0 });
          log(`run ${runId} ${id} ${vname}: net ${rep.net}, T ${rep.T}, trades ${rep.completedTrades}`);
        } catch (e) { store.finishRun(db, runId, { status: 'failed', error: String(e.stack || e.message).slice(0, 3000), at: now(), durationMs: Date.now() - s0 }); log(`run ${runId} ${id} ${vname} failed: ${e.message}`); }
        const run = store.getRun(db, runId);
        appendLogEntry({ title: `**Run** run id: ${run.id}, config: ${run.configId}, config hash: ${run.configHash}, status: ${run.status}; variant: ${run.variant}`, body: run.status === 'done' ? `net ${run.summary.report.net} US$; T ${run.summary.report.T}; completed trades ${run.summary.report.completedTrades}; exploratory (a heavily used development period).` : `failed: ${(run.error || '').split('\n')[0]}`, date: today(), file: logFile });
      }
      const allBase = RUNNABLE.every((id) => store.listRuns(db).some((r) => r.configId === id && r.variant === 'base' && r.status === 'done'));
      if (!allBase) log(`the placebo waits until every runnable configuration has its base run (${RUNNABLE.join(', ')})`);
      const placebo = allBase ? runPlacebo({ log, deadline: t0 + maxMs }) : store.listPlacebo(db);
      return { runs: store.listRuns(db).length, placebo, elapsedMs: Date.now() - t0 };
    } finally { store.releaseLock(db, token); }
  }

  // ---------- the placebo and Holm ----------
  function baseT() {
    const out = {};
    for (const r of store.listRuns(db)) if (r.status === 'done' && r.variant === 'base') out[r.configId] = r.summary.report.T;
    return out;
  }
  function statFrom(cmp, T) {
    let s = 0, used = 0;
    for (const [x, y] of cmp.pairs) if (T[x] != null && T[y] != null) { s += T[x] - T[y]; used++; }
    return used ? s : null;
  }
  function runPlacebo({ log = () => {}, deadline = Infinity, resamples = matrix.inference.resamples } = {}) {
    const a = assemble();
    const T0 = baseT();
    const tested = ['C1', 'C2', 'C5', 'C6'].filter((id) => !store.listPlacebo(db).some((p) => p.comparison === id));
    const c = counts();
    const todo = tested.filter((id) => c.descriptive[id] === 'tested');
    for (const id of tested.filter((x) => !todo.includes(x))) store.insertPlacebo(db, { comparison: id, resamples: 0, seed: matrix.inference.seed, tObs: statFrom(matrix.comparisons.find((m) => m.id === id), T0), countGe: null, p: null, details: { skipped: c.descriptive[id] } }, now());
    if (!todo.length) return store.listPlacebo(db);
    // The fast path must equal the planner on every real group before it stands in for it (CAMPAIGN-1.md section 9).
    const full = planSet('D', a.groups, { light: true }).map((x) => x.plan), quick = fastPlans(a.groups);
    const key = (p) => [p.stock, p.session, p.T, p.status, p.followUp, p.bullish?.activation.level, p.bearish?.activation.level, p.invalidation?.level].join('|');
    const mismatch = full.length !== quick.length ? 'count' : full.findIndex((p, i) => key(p) !== key(quick[i]));
    if (mismatch === 'count' || mismatch >= 0) throw new NrError(500, `the placebo's fast plans differ from the planner's plans (at ${mismatch}): refused`);
    log(`fast plans equal the planner's on all ${full.length} real plans`);
    const drawer = groupPlaceboDrawer({ groups: a.groups, itemFree: a.itemFree, openMs: (d) => ms(d, 'open'), closeMs: (d) => ms(d, 'close') });
    const rng = mulberry32(matrix.inference.seed);
    const obs = Object.fromEntries(todo.map((id) => [id, statFrom(matrix.comparisons.find((m) => m.id === id), T0)]));
    const ge = Object.fromEntries(todo.map((id) => [id, 0]));
    let unclustered = 0, failedGroups = 0, done = 0;
    const start = matrix.portfolio.startingCash;
    for (let r = 0; r < resamples; r++) {
      if (Date.now() > deadline) { log(`placebo stopped at the execution budget after ${done} resamples`); break; }
      const d = drawer.draw(rng);
      unclustered += d.unclustered; failedGroups += d.failed;
      const pD = fastPlans(d.groups), pDC = asDC(pD);
      const acts = pD.map((p) => activationOf(p, a.market));
      const T = { ...T0 };
      for (const [id, plans] of [['D-A', pD], ['D-B', pD], ['D-C', pD], ['DC-A', pDC]]) T[id] = tOf(evaluate(executeConfig(id, plans, null, { activations: acts, lean: true }).actions), a.index, start);
      for (const id of todo) { const s = statFrom(matrix.comparisons.find((m) => m.id === id), T); if (s != null && s >= obs[id] - 1e-9) ge[id]++; }
      done++;
      if (done % 100 === 0) log(`placebo ${done} of ${resamples}`);
    }
    for (const id of todo) store.insertPlacebo(db, { comparison: id, resamples: done, seed: matrix.inference.seed, tObs: obs[id], countGe: ge[id], p: done === resamples ? pValue(ge[id], done) : null, details: { complete: done === resamples, unclusteredClusters: unclustered, groupsWithoutCandidate: failedGroups, clusters: drawer.clusters, multiStockClusters: drawer.multiStock, withoutCommonDate: drawer.withoutCommonDate } }, now());
    return store.listPlacebo(db);
  }
  const aiOnly = (cid) => matrix.comparisons.find((x) => x.id === cid).pairs.every((pr) => pr.some((z) => matrix.configurations.find((x) => x.id === z)?.status));
  function holm() {
    const pl = new Map(store.listPlacebo(db).map((p) => [p.comparison, p]));
    const fam = matrix.inference.holmFamily;
    const h = holmAdjust(fam.map((id, i) => ({ id: i, p: pl.get(id)?.p ?? null })), { m: fam.length, alpha: matrix.inference.alpha });
    return Object.fromEntries(fam.map((id, i) => [id, { statistic: r2(pl.get(id)?.tObs ?? null), p: pl.get(id)?.p ?? null, holmP: h.get(i).adjustedP, significant: h.get(i).significant, status: pl.get(id)?.details?.skipped ?? (pl.has(id) ? (pl.get(id).p == null ? 'incomplete' : 'tested') : aiOnly(id) ? 'not run: no API spending authorised' : 'pending: the placebo has not run yet') }]));
  }
  function aiEstimate() {
    const a = assemble();
    const spec = loadAiSpec();
    const packets = a.groups.map((g) => a.loader.packetAt({ stock: g.stock, T: g.T, session: g.session }));
    return estimateCost(packets, spec, { variants: 2 });
  }

  function status() {
    return { simulated: true, downloads: store.listDownloads(db).map((d) => ({ kind: d.kind, symbol: d.symbol, status: d.status, finishedAt: d.finished_at, summary: d.summary })), runs: store.listRuns(db).map((r) => ({ id: r.id, configId: r.configId, variant: r.variant, status: r.status, net: r.summary?.report?.net ?? null, T: r.summary?.report?.T ?? null, trades: r.summary?.report?.completedTrades ?? null, error: r.error ? r.error.split('\n')[0] : null })), placebo: store.listPlacebo(db), holm: holm() };
  }

  return { db, matrix, words, assemble, planSet, fastPlans, asDC, storedPlans, counts, countsMarkdown, manifest, gateStatus, recordCounts, freeze, runAll, runPlacebo, holm, aiEstimate, executeConfig, evaluate, status, baseT, close: () => { try { db.close(); } catch { /* */ } }, closedWindows: CLOSED_WINDOWS };
}
