// news-forward's persistent worker (master work order version 3, section 5; PROTOCOL-1.md section 6). One process
// at a time (the control row's token and heartbeat; a stale heartbeat can be taken over). It reads the owner's
// request (running, paused, stopped) at least once a minute, updates every 5 minutes during the regular session (on
// each 5-minute bar close plus 30 seconds), makes one final update once the session's bars are final, and checks
// once every 15 minutes outside the session. Its checkpoint is the database itself: every update is recorded, a
// restart resumes from the stored rows, and nothing is ever backfilled as on time (a plan recorded after its window
// is late). It writes no code and reads no news site; it never places or prepares an order.
import { regularSessionBounds, isTradingDay } from '../calendar.js';
import { etDate } from '../newsreplay/download.js';
import { UPDATE_EVERY_MS, IDLE_EVERY_MS, FINAL_AFTER_CLOSE_MS, STALE_HEARTBEAT_MS, NfError } from './config.js';
import * as store from './store.js';

// What the worker should do at `nowMs`: { due, kind, nextMs }. lastSessionMs / finalDone come from the stored updates.
export function schedule(nowMs, { lastUpdateMs = null, finalDoneFor = null } = {}) {
  const d = etDate(nowMs);
  const b = isTradingDay(d, 'NYSE') ? regularSessionBounds(d) : null;
  if (b) {
    const open = new Date(b.open).getTime(), close = new Date(b.close).getTime();
    const firstAt = open + 5 * 60000 + 30000; // the first 5-minute bar close, plus 30 seconds
    if (nowMs >= firstAt && nowMs < close + FINAL_AFTER_CLOSE_MS) {
      const slot = firstAt + Math.floor((nowMs - firstAt) / UPDATE_EVERY_MS) * UPDATE_EVERY_MS;
      return { due: lastUpdateMs == null || lastUpdateMs < slot, kind: 'session', nextMs: slot + UPDATE_EVERY_MS };
    }
    if (nowMs >= close + FINAL_AFTER_CLOSE_MS && finalDoneFor !== d) return { due: true, kind: 'final', nextMs: nowMs + IDLE_EVERY_MS };
    if (nowMs < firstAt) return { due: lastUpdateMs == null || nowMs - lastUpdateMs >= IDLE_EVERY_MS, kind: 'idle', nextMs: Math.min(firstAt, nowMs + IDLE_EVERY_MS) };
  }
  return { due: lastUpdateMs == null || nowMs - lastUpdateMs >= IDLE_EVERY_MS, kind: 'idle', nextMs: nowMs + IDLE_EVERY_MS };
}

export async function runWorker({ db, forward, clock = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pid = process.pid, token, maxLoops = Infinity, log = () => {} }) {
  const at = () => clock().toISOString();
  const claim = store.claimWorker(db, { token, pid, at: at(), staleMs: STALE_HEARTBEAT_MS });
  if (!claim.ok) throw new NfError(409, `another news-forward worker is alive (pid ${claim.holder.pid}, heartbeat ${claim.holder.heartbeat_at})`);
  store.logLine(db, at(), 'info', `worker started (pid ${pid})`);
  const done = store.listUpdates(db, 200).filter((u) => u.status === 'done');
  let lastUpdateMs = done.length ? Date.parse(done[0].finishedAt) : null;
  let finalDoneFor = done.find((u) => u.kind === 'final')?.detail?.today ?? null;
  let loops = 0;
  try {
    while (loops++ < maxLoops) {
      const w = store.worker(db);
      if (!w || w.token !== token) { store.logLine(db, at(), 'warn', 'worker lost the control row: exiting'); return { exit: 'taken over' }; }
      if (w.desired === 'stopped') { store.logLine(db, at(), 'info', 'stop requested: exiting'); return { exit: 'stopped' }; }
      if (w.desired === 'paused') { store.heartbeat(db, token, at(), 'paused'); await sleep(60000); continue; }
      const nowMs = clock().getTime();
      const s = schedule(nowMs, { lastUpdateMs, finalDoneFor });
      if (s.due) {
        store.heartbeat(db, token, at(), `updating (${s.kind})`);
        try {
          const r = await forward.update({ kind: s.kind, withFilings: s.kind !== 'session' || Math.floor(nowMs / UPDATE_EVERY_MS) % 3 === 0 });
          if (s.kind === 'final') finalDoneFor = r.detail.today;
          log(`update ${s.kind} done`);
        } catch (e) { log(`update ${s.kind} failed: ${e.message}`); }
        lastUpdateMs = nowMs;
      }
      store.heartbeat(db, token, at(), 'waiting');
      const wait = Math.max(1000, Math.min(60000, (s.due ? schedule(clock().getTime(), { lastUpdateMs, finalDoneFor }).nextMs : s.nextMs) - clock().getTime()));
      await sleep(wait);
    }
    return { exit: 'loop limit' };
  } finally { store.releaseWorker(db, token, at()); }
}
