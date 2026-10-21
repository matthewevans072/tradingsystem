import { h, mount, fmt, section, notice, badge, toast, field, select, formData } from '../lib/ui.js';

function form(onSubmit, ...children) {
  const f = h('form', { class: 'stack', style: { gap: '12px' } }, ...children);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try { await onSubmit(formData(f)); } catch (err) { toast(err.message, 'error'); } finally { if (btn) btn.disabled = false; }
  });
  return f;
}
const save = (label = 'Save') => h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, label));

export async function renderSettings(view, ctx) {
  const { api, app } = ctx;
  const [{ settings: s, riskQuestions, config }, status, backups, deliveries] = await Promise.all([
    api('GET', '/api/settings'), api('GET', '/api/status'), api('GET', '/api/backups'), api('GET', '/api/deliveries')]);
  const put = async (key, value, msg = 'Saved') => { await api('PUT', `/api/settings/${key}`, value); toast(msg); await ctx.refreshStatus(); ctx.rerender(); };

  // ---- Setup questions ----
  const p = s.profile;
  const setup = section('Setup questions',
    h('p', { class: 'muted' }, 'Only what is needed to connect real data. Nothing here is assumed until you answer.'),
    form((f) => put('profile', { ...p, brokerage: f.brokerage, snapshotConfirmed: f.snapshotConfirmed === '' ? null : f.snapshotConfirmed === 'yes', dataBudget: f.dataBudget, inAppOnly: f.inAppOnly, notes: f.notes }),
      h('div', { class: 'form-grid' },
        field('Which brokerage holds these accounts?', h('input', { name: 'brokerage', value: p.brokerage || '', placeholder: 'e.g. Wealthsimple, Questrade, TD Direct Investing' }), 'Lets Signal Desk match its CSV export format.'),
        field('Have your holdings changed since the saved snapshot?', select('snapshotConfirmed', [['', 'Not answered'], ['yes', 'No changes — snapshot is current'], ['no', 'Yes, holdings changed']], p.snapshotConfirmed === true ? 'yes' : p.snapshotConfirmed === false ? 'no' : '')),
        field('Market-data budget', select('dataBudget', [['', 'Not answered'], ['free', 'Free only (delayed / limited)'], ['low', 'Up to ~US$10–30/month'], ['mid', 'Up to ~US$30–80/month'], ['high', 'Whatever gives real-time US + Canadian data']], p.dataBudget || ''))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'inAppOnly', checked: !!p.inAppOnly }), 'Keep reports in the app only (no email or phone delivery)'),
      field('Notes', h('input', { name: 'notes', value: p.notes || '' })),
      save()));

  // ---- Providers ----
  const cfgRow = (label, ok, hint) => h('div', { class: 'list-item spread' }, h('div', {}, h('strong', {}, label), hint ? h('div', { class: 'small muted' }, hint) : null), badge(ok ? 'Configured' : 'Not configured', ok ? 'ok' : 'warn'));
  const testOut = h('div', {});
  const testBtn = h('button', { class: 'btn', type: 'button' }, 'Test connections');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    mount(testOut, h('p', { class: 'muted' }, 'Testing…'));
    try {
      const r = await api('POST', '/api/providers/test');
      mount(testOut, h('div', { class: 'list' }, r.map((x) => h('div', { class: 'list-item' }, h('div', { class: 'row' }, badge(x.ok ? 'OK' : 'Failed', x.ok ? 'ok' : 'danger'), h('strong', {}, x.name), x.ms ? h('span', { class: 'small muted' }, `${x.ms} ms`) : null), h('div', { class: 'small' }, x.detail)))));
    } catch (e) { mount(testOut, notice('danger', e.message)); } finally { testBtn.disabled = false; }
  });
  const pv = s.providers;
  const providers = section('Data providers',
    h('div', { class: 'list' },
      h('div', { class: 'list-item spread' }, h('strong', {}, 'Active market-data provider'), badge(config.marketProvider === 'none' ? 'None selected' : config.marketProvider, config.marketProvider === 'none' ? 'danger' : 'ok')),
      cfgRow('Twelve Data (quotes, history, earnings; US + Canada on paid plans)', config.configured.twelvedata, 'TWELVEDATA_API_KEY in .env'),
      cfgRow('Finnhub (US quotes, company news, earnings calendar)', config.configured.finnhub, 'FINNHUB_API_KEY in .env'),
      cfgRow('SEC EDGAR (official US filings, free)', config.configured.secEdgar, 'SEC_CONTACT_EMAIL in .env (required by the SEC)'),
      cfgRow('Bank of Canada USD/CAD (free, daily official rate)', true, 'No key needed'),
      cfgRow('AI analyst — Claude (optional news interpretation & briefing summaries)', config.configured.anthropic, 'ANTHROPIC_API_KEY in .env')),
    notice('info', 'API keys are read only from the .env file on this computer. They are never sent to the browser, written to logs, or stored in the database. Edit .env and restart Signal Desk to change them.'),
    h('div', { class: 'row' }, testBtn), testOut,
    h('h4', { class: 'card-title mt' }, 'Plan limits & timeliness'),
    form((f) => put('providers', {
      twelvedata: { perMinute: Number(f.td_pm), perDay: Number(f.td_pd), delayMinutesUS: Number(f.td_us), delayMinutesCA: Number(f.td_ca), extendedHours: f.td_ext },
      finnhub: { perMinute: Number(f.fh_pm), delayMinutesUS: Number(f.fh_us) },
    }, 'Provider settings saved'),
      h('p', { class: 'small muted' }, 'Set these to match your plan so quotes are labelled correctly. If unsure, leave the delay at 15 minutes: Signal Desk will label quotes as delayed rather than overstate their timeliness.'),
      h('div', { class: 'form-grid' },
        field('Twelve Data credits / minute', h('input', { name: 'td_pm', type: 'number', value: pv.twelvedata.perMinute })),
        field('Twelve Data credits / day', h('input', { name: 'td_pd', type: 'number', value: pv.twelvedata.perDay })),
        field('Twelve Data US delay (min)', h('input', { name: 'td_us', type: 'number', value: pv.twelvedata.delayMinutesUS })),
        field('Twelve Data Canada delay (min)', h('input', { name: 'td_ca', type: 'number', value: pv.twelvedata.delayMinutesCA })),
        field('Finnhub calls / minute', h('input', { name: 'fh_pm', type: 'number', value: pv.finnhub.perMinute })),
        field('Finnhub US delay (min)', h('input', { name: 'fh_us', type: 'number', value: pv.finnhub.delayMinutesUS }))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'td_ext', checked: !!pv.twelvedata.extendedHours }), 'My Twelve Data plan includes pre/post-market data'),
      save()));

  // ---- Delivery ----
  const dl = s.delivery;
  const chk = (group, ch, label, disabled) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `${group}_${ch}`, checked: (dl[group] || []).includes(ch), disabled: disabled || null }), label);
  const testDelivery = (ch) => {
    const b = h('button', { class: 'btn small', type: 'button' }, `Send test (${ch})`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api('POST', '/api/delivery/test', { channel: ch }); const x = r[0]; toast(`${x.channel}: ${x.status}${x.error ? ' — ' + x.error : ''}`, x.status === 'sent' ? '' : 'error'); ctx.rerender(); } catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; }
    });
    return b;
  };
  const delivery = section('Report delivery',
    h('div', { class: 'list' },
      cfgRow('Email (SMTP)', config.configured.email, 'SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_TO in .env. For Gmail use an app password.'),
      cfgRow('Phone push (ntfy)', config.configured.ntfy, 'NTFY_URL in .env, e.g. https://ntfy.sh/your-private-topic')),
    form((f) => put('delivery', {
      briefings: ['in_app', ...(f.briefings_email ? ['email'] : []), ...(f.briefings_ntfy ? ['ntfy'] : [])],
      alerts: ['in_app', ...(f.alerts_email ? ['email'] : []), ...(f.alerts_ntfy ? ['ntfy'] : [])],
    }, 'Delivery saved'),
      h('div', { class: 'form-grid' },
        h('div', {}, h('div', { class: 'field-label' }, 'Briefings'), chk('briefings', 'in_app', 'In-app archive (always on)', true), chk('briefings', 'email', 'Email'), chk('briefings', 'ntfy', 'Phone push')),
        h('div', {}, h('div', { class: 'field-label' }, 'Alerts'), chk('alerts', 'in_app', 'In-app (always on)', true), chk('alerts', 'email', 'Email'), chk('alerts', 'ntfy', 'Phone push'))),
      save()),
    h('div', { class: 'row' }, testDelivery('email'), testDelivery('ntfy')),
    deliveries.length ? h('div', { class: 'list mt' }, deliveries.slice(0, 8).map((d) => h('div', { class: 'list-item spread small' }, h('span', {}, `${d.ref_type} ${d.ref_id || ''} → ${d.channel}`), h('span', {}, badge(d.status, d.status === 'sent' ? 'ok' : d.status === 'failed' ? 'danger' : ''), ' ', fmt.et(d.attempted_at), d.detail ? ` · ${d.detail}` : '')))) : null);

  // ---- Alerts ----
  const al = s.alerts;
  const alerts = section('Alerts & continuous monitoring',
    notice('info', 'The three briefings are scheduled reports. Alerts are separate: a monitor refreshes prices every few minutes during market hours and checks these thresholds. Session highs and lows are the extremes observed so far; Signal Desk never claims a final high or low in advance.'),
    form((f) => Promise.all([
      put('alerts', { quietHours: { enabled: f.qh, start: f.qs, end: f.qe }, defaults: { pct_move: Number(f.pct_move), near_high: Number(f.near_high), near_low: Number(f.near_low), volume_spike: Number(f.volume_spike), earnings_soon: Number(f.earnings_soon), concentration: Number(f.concentration), drawdown: Number(f.drawdown), news_material: f.news_material } }, 'Alert settings saved'),
      api('PUT', '/api/settings/schedule', { ...s.schedule, monitor: { enabled: f.mon, intervalMinutes: Math.max(1, Number(f.mon_int)), extendedHours: f.mon_ext } }),
    ]),
      h('div', { class: 'form-grid' },
        field('Daily move beyond ± %', h('input', { name: 'pct_move', type: 'number', step: 'any', value: al.defaults.pct_move })),
        field('Within % of session high so far', h('input', { name: 'near_high', type: 'number', step: 'any', value: al.defaults.near_high })),
        field('Within % of session low so far', h('input', { name: 'near_low', type: 'number', step: 'any', value: al.defaults.near_low })),
        field('Volume ≥ × average (if provider supplies volume)', h('input', { name: 'volume_spike', type: 'number', step: 'any', value: al.defaults.volume_spike })),
        field('Earnings reminder (days before)', h('input', { name: 'earnings_soon', type: 'number', value: al.defaults.earnings_soon })),
        field('Concentration: position weight above %', h('input', { name: 'concentration', type: 'number', step: 'any', value: al.defaults.concentration })),
        field('Drawdown: position below avg cost by %', h('input', { name: 'drawdown', type: 'number', step: 'any', value: al.defaults.drawdown })),
        field('Quiet hours start (ET)', h('input', { name: 'qs', type: 'time', value: al.quietHours.start })),
        field('Quiet hours end (ET)', h('input', { name: 'qe', type: 'time', value: al.quietHours.end })),
        field('Monitor interval (minutes)', h('input', { name: 'mon_int', type: 'number', min: 1, value: s.schedule.monitor?.intervalMinutes ?? 5 }), 'Each check uses one quote request per holding.')),
      h('div', { class: 'row' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'news_material', checked: al.defaults.news_material !== false }), 'Material news & filings'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'qh', checked: !!al.quietHours.enabled }), 'Quiet hours (no push/email)'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'mon', checked: s.schedule.monitor?.enabled !== false }), 'Continuous monitor on'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'mon_ext', checked: !!s.schedule.monitor?.extendedHours }), 'Also monitor pre/after-market')),
      save()));

  // ---- Risk profile ----
  const rp = s.riskProfile || {};
  const risk = section('Risk questions (needed before any position sizing)',
    h('p', { class: 'muted' }, 'Signal Desk will not suggest trade sizes until these are answered, and treats an unanswered question as “no permission”, not consent. It never assumes you can add money, use margin or accept unlimited losses.'),
    form((f) => put('riskProfile', f, 'Risk profile saved'),
      h('div', { class: 'form-grid' }, riskQuestions.map((q) => field(q.q, h('input', { name: q.id, type: q.type === 'number' ? 'number' : 'text', step: 'any', value: rp[q.id] ?? '' })))),
      save()),
    form((f) => put('assessmentThresholds', { reviewWeightPct: Number(f.reviewWeightPct), earningsWindowDays: Number(f.earningsWindowDays), leveragedHoldDays: Number(f.leveragedHoldDays) }, 'Thresholds saved'),
      h('h4', { class: 'card-title mt' }, 'Assessment thresholds'),
      h('div', { class: 'form-grid' },
        field('Concentration review above % of portfolio', h('input', { name: 'reviewWeightPct', type: 'number', step: 'any', value: s.assessmentThresholds.reviewWeightPct })),
        field('Earnings caution window (days)', h('input', { name: 'earningsWindowDays', type: 'number', value: s.assessmentThresholds.earningsWindowDays })),
        field('Leveraged ETF holding horizon (trading days)', h('input', { name: 'leveragedHoldDays', type: 'number', value: s.assessmentThresholds.leveragedHoldDays }))),
      save()));

  // ---- Backups ----
  const fileIn = h('input', { type: 'file', accept: '.sqlite' });
  const restoreUpload = h('button', { class: 'btn small', type: 'button' }, 'Restore from file');
  restoreUpload.addEventListener('click', async () => {
    const f = fileIn.files[0];
    if (!f) return toast('Choose a .sqlite backup file first', 'error');
    if (!confirm('Replace the current data with this backup? A safety copy of the current data is taken first.')) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try { const r = await api('POST', '/api/backups/upload', { dataBase64: btoa(bin), restore: true }); toast(`Restored (${r.transactions} transactions). Safety copy: ${r.safetyBackup}`); ctx.rerender(); } catch (e) { toast(e.message, 'error'); }
  });
  const backupsSec = section('Backup & restore',
    h('p', { class: 'small muted' }, `Data folder: ${status.host.dataDir}. An automatic backup is taken once a day when Signal Desk starts (last 30 kept).`),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { try { const b = await api('POST', '/api/backups'); toast(`Backup created: ${b.name}`); ctx.rerender(); } catch (e) { toast(e.message, 'error'); } } }, 'Create backup now'),
      h('a', { class: 'btn ghost', href: '#', onclick: async (e) => { e.preventDefault(); const data = await api('GET', '/api/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `signal-desk-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); } }, 'Export JSON')),
    backups.length ? h('div', { class: 'list' }, backups.slice(0, 10).map((b) => h('div', { class: 'list-item spread' },
      h('div', {}, h('div', { class: 'small' }, b.name), h('div', { class: 'small muted' }, `${fmt.et(b.createdAt)} · ${(b.size / 1024).toFixed(0)} KB`)),
      h('button', { class: 'btn small ghost', onclick: async () => {
        if (!confirm(`Restore ${b.name}? Current data will be replaced (a safety backup is taken first).`)) return;
        try { const r = await api('POST', '/api/backups/restore', { name: b.name }); toast(`Restored. Safety copy: ${r.safetyBackup}`); ctx.rerender(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Restore')))) : h('p', { class: 'muted' }, 'No backups yet.'),
    h('div', { class: 'row mt' }, fileIn, restoreUpload));

  // ---- Ask Signal Desk ----
  let chat = null;
  try { chat = await api('GET', '/api/chat/status'); } catch { /* shown as unavailable */ }
  const chatSec = section('Ask Signal Desk (chat agent)',
    h('div', { class: 'list' },
      h('div', { class: 'list-item spread' }, h('strong', {}, 'Status'), badge(chat?.available ? 'Ready' : 'Not configured', chat?.available ? 'ok' : 'warn')),
      chat?.available ? h('div', { class: 'list-item spread' }, h('span', {}, 'Model'), h('span', { class: 'small' }, `${chat.model} · effort ${chat.effort}`)) : null,
      h('div', { class: 'list-item spread' }, h('span', {}, 'Spent today (estimate)'), h('span', { class: 'small' }, `US$${(chat?.spentTodayUsd || 0).toFixed(2)} of US$${chat?.dailyBudgetUsd ?? '—'} daily cap`))),
    !chat?.available ? notice('warn', chat?.reason || 'Unavailable') : null,
    notice('info', h('strong', {}, 'Model access and cost. '), 'The chat agent calls Anthropic’s API with your own key (ANTHROPIC_API_KEY in .env). Building Signal Desk with Claude Code does not give the app model access, and a Claude subscription does not cover API usage. Usage is billed per token; a typical question uses 5–40k input tokens. Set CHAT_DAILY_BUDGET_USD to cap spending, CHAT_MODEL to change model (e.g. claude-sonnet-5-5 is cheaper), and CHAT_EFFORT (low–max) to trade depth for cost.'),
    h('details', { class: 'more' }, h('summary', {}, 'What is sent to the model provider'), h('ul', { class: 'bullets small' }, (chat?.disclosure || []).map((d) => h('li', {}, d)))));

  // ---- Workspace, security & logs ----
  const logsOut = h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto', color: 'var(--text-2)' } });
  const ws = section('Workspace, security & logs',
    h('div', { class: 'row' },
      h('span', {}, 'Current workspace: ', h('strong', {}, app.workspace === 'demo' ? 'Demo (synthetic data)' : 'My portfolio')),
      h('button', { class: 'btn small', onclick: async () => { const m = await import('../app.js'); m.setWorkspace(app.workspace === 'demo' ? 'real' : 'demo'); } }, app.workspace === 'demo' ? 'Switch to my portfolio' : 'Open demo workspace')),
    h('p', { class: 'small muted' }, 'The demo workspace uses a separate database with clearly labelled synthetic prices. It never mixes with your real portfolio, and its reports are never emailed.'),
    h('div', { class: 'list' },
      h('div', { class: 'list-item spread' }, h('span', {}, 'Network access'), badge(config.localOnly ? `Local only (${config.host}:${config.port})` : `REMOTE (${config.host})`, config.localOnly ? 'ok' : 'warn')),
      h('div', { class: 'list-item spread' }, h('span', {}, 'Trading permissions'), badge('None — read-only', 'ok')),
      h('div', { class: 'list-item spread' }, h('span', {}, 'Runtime'), h('span', { class: 'small muted' }, `Node ${status.host.node} on ${status.host.platform} · Signal Desk ${status.version}`))),
    h('div', { class: 'row mt' }, h('button', { class: 'btn small', onclick: async () => { const l = await api('GET', '/api/logs?n=150'); logsOut.textContent = l.map((x) => `${x.at} ${x.level} [${x.scope}] ${x.msg}`).join('\n') || 'No log entries yet.'; } }, 'Show recent log')),
    logsOut);

  mount(view, h('div', { class: 'stack' },
    h('div', { class: 'grid two' }, setup, providers),
    h('div', { class: 'grid two' }, delivery, alerts),
    h('div', { class: 'grid two' }, risk, h('div', { class: 'stack' }, chatSec, backupsSec, ws))));
}
