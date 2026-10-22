// Scheduler, briefings, alerts and delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tempDir, putQuote } from './helpers.js';
import { loadConfig } from '../server/config.js';
import { createContext } from '../server/context.js';
import { createScheduler } from '../server/scheduler.js';
import { produceBriefing, searchBriefings } from '../server/briefings.js';
import { addTransaction, findInstrument, updateInstrument, computePortfolio, setCash } from '../server/portfolio.js';
import { evaluateAlerts, inQuietHours } from '../server/alerts.js';
import { sendSmtp, deliver } from '../server/delivery.js';
import { setSetting } from '../server/db.js';
import { zonedToUtc } from '../server/time.js';
import { NO_HOST_KEYS } from './no-host-keys.js';

function makeCtx(extra = {}) {
  const dir = tempDir();
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ...extra });
  return createContext(cfg, 'real');
}

function seedHolding(ctx) {
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-09-01', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 100 });
  const inst = findInstrument(ctx.db, 'VRT', 'NYSE');
  updateInstrument(ctx.db, inst.id, { identity_status: 'confirmed' });
  return inst;
}

test('scheduler runs each slot once, inside the grace window', async () => {
  const ctx = makeCtx();
  seedHolding(ctx);
  let now = zonedToUtc('2026-10-21', 9, 16);
  const sch = createScheduler(ctx, { clock: () => now });
  await sch.tick();
  await sch.tick();
  const rows = ctx.db.prepare("SELECT * FROM briefings WHERE kind = 'premarket'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slot_key, 'premarket:2026-10-21');
  assert.equal(rows[0].status, 'partial', 'no provider configured => partial with stated gaps');
  const content = JSON.parse(rows[0].content_json);
  assert.ok(content.dataIssues.some((d) => d.includes('No market-data provider')));
  const deliveries = ctx.db.prepare("SELECT * FROM deliveries WHERE ref_type = 'briefing'").all();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].channel, 'in_app');
  now = zonedToUtc('2026-10-21', 10, 31);
  await sch.tick();
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM briefings WHERE kind = 'first_hour'").get().n, 1);
});

test('after sleep, late slots are marked missed and not sent', async () => {
  const ctx = makeCtx();
  seedHolding(ctx);
  let now = zonedToUtc('2026-10-21', 8, 0);
  const sch = createScheduler(ctx, { clock: () => now, tickMs: 30000 });
  await sch.tick();
  now = zonedToUtc('2026-10-21', 14, 5); // laptop wakes up
  await sch.tick();
  const rows = ctx.db.prepare('SELECT kind, status FROM briefings ORDER BY kind').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ kind: 'first_hour', status: 'missed' }, { kind: 'premarket', status: 'missed' }]);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE ref_type = 'briefing'").get().n, 0);
  assert.equal(sch.state.resumes.length, 1);
  assert.ok(ctx.db.prepare("SELECT * FROM job_runs WHERE job = 'resume'").get());
  now = zonedToUtc('2026-10-21', 15, 1);
  await sch.tick();
  assert.equal(ctx.db.prepare("SELECT status FROM briefings WHERE kind = 'pre_close'").get().status, 'partial');
});

test('holidays produce no briefings; early close moves final briefing to noon', async () => {
  const ctx = makeCtx();
  let now = zonedToUtc('2026-11-26', 15, 5); // Thanksgiving
  const sch = createScheduler(ctx, { clock: () => now });
  await sch.tick();
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM briefings').get().n, 0);
  now = zonedToUtc('2026-11-27', 12, 1);
  await sch.tick();
  const r = ctx.db.prepare("SELECT * FROM briefings WHERE kind = 'pre_close'").get();
  assert.equal(r.scheduled_for, zonedToUtc('2026-11-27', 12, 0).toISOString());
  assert.ok(['ok', 'partial'].includes(r.status));
});

test('failed briefings retry up to the limit', async () => {
  const ctx = makeCtx();
  let now = zonedToUtc('2026-10-21', 9, 15);
  ctx.catalog.describeInstrument = () => { throw new Error('boom'); };
  seedHolding(ctx);
  const sch = createScheduler(ctx, { clock: () => now });
  for (let i = 0; i < 6; i++) { await sch.tick(); now = new Date(now.getTime() + 2.5 * 60000); }
  const r = ctx.db.prepare("SELECT * FROM briefings WHERE kind = 'premarket'").get();
  assert.equal(r.status, 'failed');
  assert.equal(r.attempts, 3);
  assert.match(r.error, /boom/);
});

test('manual briefings are saved and searchable; duplicate slot key ignored', async () => {
  const ctx = makeCtx();
  seedHolding(ctx);
  const a = await produceBriefing(ctx, { kind: 'pre_close', tradingDate: '2026-10-21', slotKey: 'pre_close:2026-10-21', now: zonedToUtc('2026-10-21', 15, 0) });
  const b = await produceBriefing(ctx, { kind: 'pre_close', tradingDate: '2026-10-21', slotKey: 'pre_close:2026-10-21', now: zonedToUtc('2026-10-21', 15, 1) });
  assert.equal(b.duplicate, true);
  assert.equal(a.id, b.id);
  assert.equal(searchBriefings(ctx.db, { q: 'VRT' }).length, 1);
  assert.equal(searchBriefings(ctx.db, { q: 'zzzz-not-there' }).length, 0);
});

test('alerts deduplicate, respect quiet hours and never predict the final high', async () => {
  const ctx = makeCtx();
  const inst = seedHolding(ctx);
  const now = zonedToUtc('2026-10-21', 14, 0);
  putQuote(ctx.db, inst.id, { price: 108, prev_close: 100, change: 8, change_pct: 8, high: 108.2, low: 99, open: 100, quote_time: now.toISOString(), session: 'regular' });
  const p = computePortfolio(ctx.db, { now, catalog: ctx.catalog });
  const fired = await evaluateAlerts(ctx, p, { now });
  const keys = fired.map((f) => f.key.split(':')[0]).sort();
  assert.ok(keys.includes('pct_move'));
  assert.ok(keys.includes('near_high'));
  const nh = fired.find((f) => f.key.startsWith('near_high'));
  assert.match(nh.message, /not a prediction/);
  const again = await evaluateAlerts(ctx, p, { now });
  assert.equal(again.length, 0, 'deduplicated');
  assert.equal(inQuietHours({ quietHours: { enabled: true, start: '21:00', end: '07:30' } }, zonedToUtc('2026-10-21', 23, 0)), true);
  assert.equal(inQuietHours({ quietHours: { enabled: true, start: '21:00', end: '07:30' } }, zonedToUtc('2026-10-21', 12, 0)), false);
});

test('notification failures are recorded, not hidden', async () => {
  const ctx = makeCtx({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u@example.com', SMTP_PASSWORD: 'pw-123456', SMTP_TO: 'me@example.com' });
  setSetting(ctx.db, 'delivery', { briefings: ['in_app', 'email', 'ntfy'], alerts: ['in_app'] });
  ctx.sendSmtp = async () => { throw new Error('connect ECONNREFUSED with pw-123456'); };
  const r = await deliver(ctx, { refType: 'briefing', refId: 1, title: 't', text: 'x' });
  assert.deepEqual(r.map((x) => [x.channel, x.status]), [['in_app', 'sent'], ['email', 'failed'], ['ntfy', 'skipped']]);
  assert.ok(!r[1].error.includes('pw-123456'), 'password redacted from error');
  const rows = ctx.db.prepare('SELECT channel, status FROM deliveries').all();
  assert.equal(rows.length, 3);
});

test('SMTP client speaks the protocol and refuses plaintext auth without STARTTLS', async () => {
  const received = [];
  const server = net.createServer((sock) => {
    sock.write('220 test\r\n');
    let data = false;
    sock.on('data', (b) => {
      for (const line of b.toString().split('\r\n').filter(Boolean)) {
        received.push(line);
        if (data) { if (line === '.') { data = false; sock.write('250 queued\r\n'); } continue; }
        if (line.startsWith('EHLO')) sock.write('250-test\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (received.at(-2) === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (line.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (line.startsWith('RCPT TO')) sock.write('250 ok\r\n');
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
        else if (received.at(-3) === 'AUTH LOGIN') sock.write('235 ok\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await sendSmtp({ host: '127.0.0.1', port, user: 'me', password: 'pw', from: 'me@x.com', to: 'you@x.com', subject: 'Hi', text: 'body', insecureForTests: true });
  assert.ok(received.includes('DATA'));
  assert.ok(received.some((l) => l.startsWith('RCPT TO:<you@x.com>')));
  await assert.rejects(
    () => sendSmtp({ host: '127.0.0.1', port, user: 'me', password: 'pw', from: 'me@x.com', to: 'you@x.com', subject: 'Hi', text: 'b' }),
    /STARTTLS/);
  server.close();
});

test('assessments never offer adds without confirmed cash and withhold sizing without a risk profile', async () => {
  const ctx = makeCtx();
  const inst = seedHolding(ctx);
  const { setStrategy } = await import('../server/portfolio.js');
  setStrategy(ctx.db, 1, inst.id, 'swing');
  // Steady uptrend history, price just above the 20-day average.
  const st = ctx.db.prepare("INSERT INTO bars (instrument_id, interval, ts, o, h, l, c, v, session, provider) VALUES (?, '1day', ?, ?, ?, ?, ?, 1000000, 'regular', 'fixture')");
  for (let i = 0; i < 80; i++) {
    const d = new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10);
    const c = 80 + i * 0.5;
    st.run(inst.id, d, c - 0.3, c + 0.8, c - 0.8, c);
  }
  const now = zonedToUtc('2026-10-21', 14, 0);
  putQuote(ctx.db, inst.id, { price: 115.5, prev_close: 115, change: 0.5, change_pct: 0.43, high: 116, low: 114.8, quote_time: now.toISOString() });
  const { runAssessments } = await import('../server/assessments.js');
  setSetting(ctx.db, 'assessmentThresholds', { reviewWeightPct: 101 }); // single-holding test portfolio
  let a = runAssessments(ctx, computePortfolio(ctx.db, { now, catalog: ctx.catalog }), { now })[0];
  assert.notEqual(a.action, 'CONDITIONAL_ADD', 'no cash recorded');
  assert.ok(a.notes.some((n) => n.includes('cash is not recorded')));
  setCash(ctx.db, { currency: 'USD', amount: 500, asOf: '2026-10-21', confirmed: true });
  a = runAssessments(ctx, computePortfolio(ctx.db, { now, catalog: ctx.catalog }), { now })[0];
  assert.equal(a.action, 'CONDITIONAL_ADD');
  assert.equal(a.sizing, null, 'no sizing without risk profile');
  assert.match(a.sizingStatus, /withheld/);
  assert.ok(!/entry/i.test(a.reason), 'reason not based on entry price');
});
