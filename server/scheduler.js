// Scheduler for the three daily briefings and the separate continuous monitor.
//
// Briefings (America/New_York, NYSE calendar):
//   premarket 9:15, first-hour 10:30, before-close = regular close - 60 min
//   (15:00 normally, 12:00 on 1:00 p.m. early-close days). Skipped on holidays.
//
// Reliability rules:
// - Each slot has a unique key (kind:date), so it is generated at most once.
// - A slot may start up to GRACE minutes late (e.g. the app was just opened).
//   Later than that it is recorded as "missed" and NOT generated, so a laptop
//   waking at 14:00 never sends a 9:15 premarket report as if it were timely.
// - Failures retry up to MAX_ATTEMPTS, RETRY_DELAY apart, within the grace window.
// - A gap between ticks (sleep/hibernate) is detected and logged.
import { briefingSlots, sessionAt, previousTradingDay, isTradingDay } from './calendar.js';
import { todayIn, zonedParts, NY } from './time.js';
import { produceBriefing } from './briefings.js';
import { refreshQuotes, refreshFx, refreshDailyBars, refreshEarnings, heldInstruments, checkSplits } from './marketdata.js';
import { ingestNews } from './news.js';
import { computePortfolio } from './portfolio.js';
import { evaluateAlerts } from './alerts.js';
import { getSetting, nowIso } from './db.js';
import { log } from './log.js';

export const DEFAULT_SCHEDULE = {
  graceMinutes: 20,
  maxAttempts: 3,
  retryDelayMinutes: 2,
  monitor: { enabled: true, intervalMinutes: 5, extendedHours: false },
  newsIntervalMinutes: 30,
};

export function createScheduler(ctx, { tickMs = 30000, clock = () => new Date() } = {}) {
  const state = {
    started: null, lastTick: null, running: new Set(), lastAttempt: new Map(),
    lastMonitor: 0, lastNews: 0, lastFx: 0, lastDaily: '', lastEarnings: '', resumes: [], timer: null,
    lastMonitorResult: null,
  };
  const settings = () => {
    const s = getSetting(ctx.db, 'schedule', {});
    return { ...DEFAULT_SCHEDULE, ...s, monitor: { ...DEFAULT_SCHEDULE.monitor, ...(s.monitor || {}) } };
  };

  function recordJob(job, status, detail, startedAt) {
    ctx.db.prepare('INSERT INTO job_runs (job, started_at, finished_at, status, detail) VALUES (?,?,?,?,?)')
      .run(job, startedAt || nowIso(), nowIso(), status, detail ? String(detail).slice(0, 1000) : null);
  }

  async function guarded(name, fn) {
    if (state.running.has(name)) return null;
    state.running.add(name);
    const started = nowIso();
    try {
      const r = await fn();
      recordJob(name, 'ok', typeof r === 'string' ? r : JSON.stringify(r)?.slice(0, 500), started);
      return r;
    } catch (e) {
      recordJob(name, 'failed', e.message, started);
      log.error('scheduler', `${name} failed`, e);
      return null;
    } finally {
      state.running.delete(name);
    }
  }

  function markMissed(slot, date, reason) {
    const key = `${slot.kind}:${date}`;
    const row = ctx.db.prepare('SELECT * FROM briefings WHERE slot_key = ?').get(key);
    if (!row) {
      ctx.db.prepare(`INSERT INTO briefings (kind, trading_date, slot_key, scheduled_for, status, attempts, title, error)
                      VALUES (?,?,?,?, 'missed', 0, ?, ?)`).run(slot.kind, date, key, slot.at.toISOString(), `${slot.label} — ${date}`, reason);
      log.warn('scheduler', `${key} missed: ${reason}`);
    } else if (row.status === 'running' && !state.running.has(`briefing:${key}`)) {
      ctx.db.prepare("UPDATE briefings SET status = 'failed', error = ? WHERE id = ?").run('Interrupted (app closed or computer slept while generating)', row.id);
    }
  }

  async function handleSlots(now) {
    const s = settings();
    const today = todayIn(NY, now);
    for (const slot of briefingSlots(today)) {
      if (now < slot.at) continue;
      const key = `${slot.kind}:${today}`;
      const row = ctx.db.prepare('SELECT * FROM briefings WHERE slot_key = ?').get(key);
      if (row && ['ok', 'partial', 'missed'].includes(row.status)) continue;
      if (state.running.has(`briefing:${key}`)) continue;
      const lateMin = (now - slot.at) / 60000;
      if (lateMin > s.graceMinutes) {
        if (!row) markMissed(slot, today, `Not generated within ${s.graceMinutes} min of ${slot.at.toISOString()} — app not running, computer asleep or offline. Not sent late.`);
        else if (row.status === 'running') markMissed(slot, today);
        continue;
      }
      if (row && row.status === 'failed') {
        if (row.attempts >= s.maxAttempts) continue;
        const last = state.lastAttempt.get(key) || 0;
        if (now - last < s.retryDelayMinutes * 60000) continue;
      }
      state.lastAttempt.set(key, now.getTime());
      await guarded(`briefing:${key}`, () => produceBriefing(ctx, { kind: slot.kind, tradingDate: today, slotKey: key, scheduledFor: slot.at.toISOString(), now }));
    }
  }

  // Record slots from the previous trading day that never ran (app was off).
  function backfillMissed(now) {
    // Only once the scheduler has been in use; a fresh install has nothing to miss.
    if (!ctx.db.prepare('SELECT 1 FROM briefings LIMIT 1').get()) return;
    const prev = previousTradingDay(todayIn(NY, now));
    for (const slot of briefingSlots(prev)) markMissed(slot, prev, 'App was not running at the scheduled time. Not sent late.');
  }

  async function maintenance(now) {
    const s = settings();
    const p = zonedParts(now, NY);
    const today = p.date;
    const trading = isTradingDay(today);
    if (now - state.lastFx > 6 * 3600000) { state.lastFx = now.getTime(); await guarded('fx', () => refreshFx(ctx)); }
    if (trading && p.minutes >= 7 * 60 && state.lastEarnings !== today) {
      state.lastEarnings = today;
      await guarded('earnings', () => refreshEarnings(ctx));
      await guarded('splits', () => checkSplits(ctx));
    }
    if (trading && p.minutes >= 16 * 60 + 30 && state.lastDaily !== today) {
      state.lastDaily = today;
      await guarded('dailyBars', () => refreshDailyBars(ctx));
    }
    if (trading && p.minutes >= 6 * 60 && p.minutes <= 20 * 60 && now - state.lastNews > s.newsIntervalMinutes * 60000) {
      state.lastNews = now.getTime();
      await guarded('news', () => ingestNews(ctx, { now }));
    }
  }

  async function monitor(now) {
    const s = settings();
    if (!s.monitor.enabled) return;
    const sess = sessionAt(now).session;
    const active = sess === 'regular' || (s.monitor.extendedHours && (sess === 'pre' || sess === 'post'));
    if (!active) return;
    if (now - state.lastMonitor < s.monitor.intervalMinutes * 60000) return;
    state.lastMonitor = now.getTime();
    await guarded('monitor', async () => {
      const held = heldInstruments(ctx.db);
      if (!held.length) return 'no holdings';
      const q = await refreshQuotes(ctx, { now, instruments: held });
      const portfolio = computePortfolio(ctx.db, { now, catalog: ctx.catalog });
      const fired = await evaluateAlerts(ctx, portfolio, { now });
      state.lastMonitorResult = { at: now.toISOString(), quotes: q.message, alerts: fired.length };
      return state.lastMonitorResult;
    });
  }

  async function tick() {
    const now = clock();
    if (state.lastTick && now - state.lastTick > Math.max(3 * tickMs, 120000)) {
      const gapMin = Math.round((now - state.lastTick) / 60000);
      state.resumes.push({ at: now.toISOString(), gapMinutes: gapMin });
      if (state.resumes.length > 20) state.resumes.shift();
      recordJob('resume', 'ok', `Resumed after a ${gapMin}-minute gap (sleep, hibernate or clock change). Slots past their grace window are marked missed, not sent late.`);
      log.warn('scheduler', `resumed after ${gapMin} min gap`);
    }
    state.lastTick = now;
    labTick(now);
    try {
      await handleSlots(now);
      await maintenance(now);
      await monitor(now);
    } catch (e) {
      log.error('scheduler', 'tick failed', e);
    }
  }

  // Strategy Lab forward test (simulated): never awaited, so a slow provider
  // cannot delay a briefing, and its provider requests pause while one runs.
  function labTick(now) {
    try {
      const lab = ctx.lab;
      if (!lab?.tick) return;
      lab.tick({ now, shouldPause: () => [...state.running].some((n) => n.startsWith('briefing:')) })
        .catch((e) => log.error('scheduler', 'strategy lab tick failed', e));
    } catch (e) {
      log.error('scheduler', 'strategy lab tick failed', e);
    }
  }

  return {
    state,
    tick,
    start() {
      state.started = clock();
      backfillMissed(clock());
      log.info('scheduler', `started (tick ${tickMs / 1000}s)`);
      const loop = async () => {
        await tick();
        state.timer = setTimeout(loop, tickMs);
        state.timer.unref?.();
      };
      loop();
    },
    stop() {
      if (state.timer) clearTimeout(state.timer);
    },
    status() {
      const now = clock();
      const s = settings();
      const today = todayIn(NY, now);
      const slots = [];
      let d = today;
      for (let i = 0; i < 6 && slots.length < 4; i++) {
        for (const slot of briefingSlots(d)) {
          const row = ctx.db.prepare('SELECT id, status, attempts, error, generated_at FROM briefings WHERE slot_key = ?').get(`${slot.kind}:${d}`);
          if (slot.at > now || (row && d === today)) slots.push({ kind: slot.kind, label: slot.label, date: d, at: slot.at.toISOString(), earlyClose: !!slot.earlyClose, ...(row || { status: slot.at > now ? 'scheduled' : 'pending' }) });
        }
        d = new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
      }
      return {
        enabled: true, started: state.started?.toISOString() || null, lastTick: state.lastTick?.toISOString() || null,
        tickSeconds: tickMs / 1000, graceMinutes: s.graceMinutes, maxAttempts: s.maxAttempts,
        monitor: { ...s.monitor, last: state.lastMonitorResult },
        session: sessionAt(now), slots: slots.slice(0, 6), resumes: state.resumes.slice(-5),
        recentJobs: ctx.db.prepare('SELECT job, started_at, finished_at, status, detail FROM job_runs ORDER BY id DESC LIMIT 15').all(),
      };
    },
  };
}
