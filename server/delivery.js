// Report/alert delivery. The in-app archive always receives everything;
// email (SMTP) and ntfy push are optional. Every attempt is recorded with its
// outcome so the UI can show whether delivery succeeded.
import net from 'node:net';
import tls from 'node:tls';
import { nowIso, getSetting } from './db.js';
import { log } from './log.js';
import { redact } from './config.js';

export function recordDelivery(db, refType, refId, channel, status, detail) {
  db.prepare('INSERT INTO deliveries (ref_type, ref_id, channel, status, detail, attempted_at) VALUES (?,?,?,?,?,?)')
    .run(refType, refId ?? null, channel, status, detail ? String(detail).slice(0, 500) : null, nowIso());
}

// Minimal SMTP client: implicit TLS (port 465) or STARTTLS (587).
// `insecureForTests` allows a plain local test server and is never set by the app.
export function sendSmtp({ host, port, user, password, from, to, subject, text, insecureForTests = false, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const implicitTls = port === 465 && !insecureForTests;
    let socket = implicitTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '';
    let step = 0;
    let done = false;
    const timer = setTimeout(() => fail(new Error('SMTP timed out')), timeoutMs);
    const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { socket.destroy(); } catch { /* ignore */ } reject(e); };
    const ok = () => { if (done) return; done = true; clearTimeout(timer); try { socket.end(); } catch { /* ignore */ } resolve(); };
    const write = (s) => socket.write(s + '\r\n');
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const recipients = String(to).split(',').map((s) => s.trim()).filter(Boolean);
    const body = [
      `From: ${from}`, `To: ${recipients.join(', ')}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`, '', b64(text).replace(/.{76}/g, '$&\r\n'),
    ].join('\r\n');
    let rcptIndex = 0;
    let upgraded = implicitTls;

    const handlers = [
      // 0 greeting
      (code) => { if (code !== 220) return fail(new Error(`SMTP greeting ${code}`)); write('EHLO signal-desk.local'); step = 1; },
      // 1 EHLO response
      (code, lines) => {
        if (code !== 250) return fail(new Error(`EHLO rejected ${code}`));
        if (!upgraded && !insecureForTests) {
          if (!lines.some((l) => /STARTTLS/i.test(l))) return fail(new Error('Server does not offer STARTTLS; refusing to send credentials unencrypted'));
          write('STARTTLS'); step = 2; return;
        }
        write('AUTH LOGIN'); step = 3;
      },
      // 2 STARTTLS
      (code) => {
        if (code !== 220) return fail(new Error(`STARTTLS rejected ${code}`));
        socket.removeAllListeners('data');
        socket = tls.connect({ socket, servername: host }, () => { upgraded = true; write('EHLO signal-desk.local'); step = 1; });
        socket.on('data', onData); socket.on('error', fail);
      },
      // 3 AUTH LOGIN
      (code) => { if (code !== 334) return fail(new Error(`AUTH not accepted ${code}`)); write(b64(user)); step = 4; },
      (code) => { if (code !== 334) return fail(new Error(`AUTH user rejected ${code}`)); write(b64(password)); step = 5; },
      (code) => { if (code !== 235) return fail(new Error(`Authentication failed (${code}). For Gmail use an app password.`)); write(`MAIL FROM:<${from.replace(/.*</, '').replace(/>.*/, '')}>`); step = 6; },
      // 6 MAIL FROM
      (code) => { if (code !== 250) return fail(new Error(`MAIL FROM rejected ${code}`)); write(`RCPT TO:<${recipients[rcptIndex]}>`); step = 7; },
      // 7 RCPT TO
      (code) => {
        if (code !== 250 && code !== 251) return fail(new Error(`Recipient rejected ${code}`));
        rcptIndex += 1;
        if (rcptIndex < recipients.length) { write(`RCPT TO:<${recipients[rcptIndex]}>`); return; }
        write('DATA'); step = 8;
      },
      // 8 DATA
      (code) => { if (code !== 354) return fail(new Error(`DATA rejected ${code}`)); socket.write(body.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n'); step = 9; },
      // 9 message accepted
      (code) => { if (code !== 250) return fail(new Error(`Message rejected ${code}`)); write('QUIT'); step = 10; ok(); },
      () => {},
    ];

    function onData(chunk) {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n');
      buf = lines.pop();
      const block = [];
      for (const line of lines) {
        block.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const code = Number(line.slice(0, 3));
          handlers[step](code, block.splice(0));
        }
      }
    }
    socket.on('data', onData);
    socket.on('error', fail);
  });
}

export async function sendNtfy({ url, token, title, text, priority = 3, fetchImpl = globalThis.fetch }) {
  const headers = { Title: title.replace(/[^\x20-\x7E]/g, ''), Priority: String(priority) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { method: 'POST', headers, body: text.slice(0, 3900), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ntfy returned HTTP ${res.status}`);
}

export function deliveryPrefs(db) {
  return getSetting(db, 'delivery', { briefings: ['in_app'], alerts: ['in_app'] });
}

// Deliver to the configured channels. Returns per-channel results.
export async function deliver(ctx, { refType, refId, title, text, priority = 3, channels }) {
  const { db, cfg } = ctx;
  const prefs = deliveryPrefs(db);
  const wanted = channels || (refType === 'alert' ? prefs.alerts : prefs.briefings) || ['in_app'];
  const results = [];
  if (ctx.mode === 'demo') {
    recordDelivery(db, refType, refId, 'in_app', 'sent', 'Demo workspace: external delivery disabled');
    return [{ channel: 'in_app', status: 'sent' }];
  }
  for (const ch of wanted) {
    try {
      if (ch === 'in_app') {
        recordDelivery(db, refType, refId, 'in_app', 'sent', 'Saved to archive');
        results.push({ channel: ch, status: 'sent' });
      } else if (ch === 'email') {
        const s = cfg.smtp;
        if (!(s.host && s.user && cfg.secrets.SMTP_PASSWORD && s.to)) throw Object.assign(new Error('Email not configured'), { skip: true });
        await (ctx.sendSmtp || sendSmtp)({ host: s.host, port: s.port, user: s.user, password: cfg.secrets.SMTP_PASSWORD, from: s.from || s.user, to: s.to, subject: title, text });
        recordDelivery(db, refType, refId, 'email', 'sent', `to ${s.to}`);
        results.push({ channel: ch, status: 'sent' });
      } else if (ch === 'ntfy') {
        if (!cfg.ntfy.url) throw Object.assign(new Error('ntfy not configured'), { skip: true });
        await sendNtfy({ url: cfg.ntfy.url, token: cfg.secrets.NTFY_TOKEN, title, text, priority, fetchImpl: ctx.fetchImpl });
        recordDelivery(db, refType, refId, 'ntfy', 'sent', null);
        results.push({ channel: ch, status: 'sent' });
      }
    } catch (e) {
      const msg = redact(e.message, cfg);
      recordDelivery(db, refType, refId, ch, e.skip ? 'skipped' : 'failed', msg);
      results.push({ channel: ch, status: e.skip ? 'skipped' : 'failed', error: msg });
      log.warn('delivery', `${ch} ${refType} ${refId}: ${msg}`);
    }
  }
  return results;
}
