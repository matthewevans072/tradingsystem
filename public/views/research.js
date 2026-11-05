// Research runner (simulated): the autonomous development campaign dashboard
// (strategy/research-runner/CAMPAIGN-1.md). Everything here is a simulation on
// HXR's development-period data: the page never reads or changes real holdings
// or cash, never sends an order anywhere and never sends anything outside the
// app. Every text from the server is rendered as a text node through h().
// Figures come from the server; this page only formats them. A development
// leader is a development result, never a validated strategy. The optional
// browser notification is the browser's own and shows only while this page is
// open; there is no closed-browser delivery.
import { h, mount, fmt, tone, notice, empty, badge, drawer, field, toast, errorState, section, kv } from '../lib/ui.js';
import { line } from '../lib/charts.js';

const STAGE = { 0: 'reference', 1: 'single change (baseline)', 2: 'single change (other bases)', 3: 'combination' };
const STATUS_KIND = { running: 'info', paused: 'warn', planned: 'muted', cancelled: 'danger', stopped: 'danger', done: 'ok', queued: 'muted', failed: 'danger' };
const CRIT_LABEL = { improvement: '10% above the baseline', drawdown: 'drawdown limit', trades: 'minimum trades', accounting: 'accounting reconciles', dataQuality: 'data quality', stress: 'best-5% stress', nullTest: 'random-timing null', concentration: 'profit concentration', decisionGain: 'gain beyond exposure' };
const S = { q: '', stage: '', status: '', label: '', lastNotified: 0 };
let epoch = 0, timer = null;
const onPage = () => location.hash.startsWith('#/research');
const live = (ep) => ep === epoch && onPage();
const money = (n) => fmt.money(n, '', 2);

export async function renderResearch(view, ctx) {
  const ep = ++epoch;
  clearTimeout(timer);
  if (ctx.app.workspace === 'demo') { mount(view, h('div', { class: 'stack' }, banner(), notice('info', h('strong', {}, 'Not available in the demo workspace. '), 'The research runner works on real market data in your own workspace only.'))); return; }
  const o = await ctx.api('GET', '/api/research/overview');
  if (!live(ep)) return;
  const reload = () => renderResearch(view, ctx).catch((e) => { if (onPage()) mount(view, errorState(e, reload)); });
  const c = o.active;
  let exps = null, notes = [];
  if (c) {
    const qs = new URLSearchParams({ q: S.q, stage: S.stage, status: S.status, label: S.label, limit: '300' });
    [exps, notes] = await Promise.all([ctx.api('GET', `/api/research/campaigns/${c.id}/experiments?${qs}`), ctx.api('GET', '/api/research/notifications?limit=50')]);
    if (!live(ep)) return;
  }
  const P = { api: ctx.api, o, c, exps, notes, reload };
  mount(view, h('div', { class: 'stack lab hxr' }, banner(), statusSection(P), controlsSection(P), c ? leaderSection(P) : null, notificationsSection(P), c ? resultsSection(P) : null, rulesSection(P)));
  browserNotify(notes);
  if (c && (c.status === 'running' || c.worker)) timer = setTimeout(() => { if (live(ep)) reload(); }, 3000);
}

function banner() {
  return h('div', { class: 'hxr-banner', role: 'note' }, h('strong', {}, 'Simulated research campaign. '), 'Development data only (2017-10-02 to 2021-12-31, already seen by earlier programmes); every result is a development result on seen data, never a validated strategy. No order, no broker, no delivery outside this app. The evaluation window is never opened by this runner.');
}

function statusSection(P) {
  const c = P.c;
  if (!c) return section('Campaign', empty('No campaign yet', 'Create the pre-registered campaign 1 below. Nothing runs until you start it.'));
  const k = c.counts;
  const cards = [
    ['Status', h('span', {}, badge(c.status, STATUS_KIND[c.status] || ''), c.stopReason ? h('div', { class: 'cell-sub' }, c.stopReason) : null)],
    ['Worker', c.worker ? `alive (pid ${c.worker.pid}, heartbeat ${fmt.ago(c.worker.heartbeatAt)})` : 'none running'],
    ['Queue', `${k.queued} queued`], ['Active', c.active.length ? c.active.map((a) => `${a.name} (#${a.id})`).join(', ') : 'none'],
    ['Progress', `${Math.round(c.progress * 100)}% (${k.done} done, ${k.failed} failed, ${k.cancelled} cancelled of ${k.total})`],
    ['Clear the target / shortlisted', `${c.cleared} / ${c.shortlisted}`],
    ['Time used', `${(c.elapsedMs / 60000).toFixed(1)} min of ${c.limits.maxHours} h; ${k.done + k.failed} of ${c.limits.maxConfigs} configurations`],
    ['Code / data', `${c.codeRevision}; engine ${c.engineVersion || '—'}; data ${c.hashes.data ? c.hashes.data.slice(0, 12) : 'not yet read'}; document ${c.hashes.doc ? c.hashes.doc.slice(0, 12) : '—'}`],
  ];
  return section(`Campaign ${c.id}: ${c.name}`, h('div', { class: 'grid' }, cards.map(([t, v]) => h('div', { class: 'card' }, h('div', { class: 'cat-label' }, t), h('div', {}, v)))));
}

function controlsSection(P) {
  const { api, reload, c, o } = P;
  const act = async (path, body, msg) => { try { await api('POST', path, { confirm: true, ...body }); toast(msg, 'ok'); reload(); } catch (e) { toast(String(e.message || e), 'danger'); } };
  const btn = (label, fn, kind = '') => h('button', { class: `btn ${kind}`, onclick: fn }, label);
  const doc = o.campaignDoc;
  const items = [];
  if (!c || ['done', 'stopped', 'cancelled'].includes(c.status)) items.push(btn('Create campaign 1 (queues up to 100 development experiments; nothing runs yet)', () => act('/api/research/campaigns', { name: 'Campaign 1' }, 'Campaign created; nothing ran')), doc.ok ? badge('document ready', 'ok') : badge(`document not ready: ${doc.problem}`, 'danger'));
  if (c) {
    if (c.status === 'planned') items.push(btn('Start (launches the background worker)', () => act(`/api/research/campaigns/${c.id}/start`, {}, 'Worker launched'), 'primary'));
    if (c.status === 'running') items.push(btn('Pause (after the experiment in progress)', () => act(`/api/research/campaigns/${c.id}/pause`, {}, 'Pausing')));
    if (c.status === 'paused') items.push(btn('Resume', () => act(`/api/research/campaigns/${c.id}/resume`, {}, 'Resumed'), 'primary'));
    if (['planned', 'running', 'paused'].includes(c.status)) items.push(btn('Cancel (queued experiments are cancelled; results are kept)', () => { if (confirm('Cancel the campaign? Queued experiments are cancelled; completed results stay.')) act(`/api/research/campaigns/${c.id}/cancel`, {}, 'Cancelled'); }, 'danger'));
  }
  return section('Controls', h('div', { class: 'hxr-actions' }, ...items), h('p', { class: 'hxr-caveat' }, 'The worker is a separate process (scripts/research-worker.mjs); it keeps running when this page is closed and stops between experiments on pause or cancel. Recovery after an interruption re-queues an unfinished experiment once.'));
}

function leaderSection(P) {
  const c = P.c;
  const b = c.baseline, l = c.leader;
  const cmp = l?.comparison;
  return section('Baseline and current leader', h('div', { class: 'grid' },
    h('div', { class: 'card' }, h('div', { class: 'cat-label' }, 'Fixed baseline'), b ? kv([['Experiment', `${b.name} (#${b.id})`], ['Net profit after costs', money(b.net)], ['Max drawdown', fmt.plainPct(b.maxDrawdownPct, 2)], ['Completed trades', String(b.completedTrades)], ['Must reproduce', money(b.expectedNet)]]) : h('p', {}, `${c.baselineFile}: not run yet`)),
    h('div', { class: 'card' }, h('div', { class: 'cat-label' }, 'Current leader (development result, not validated)'), l ? kv([['Experiment', `${l.name} (#${l.id})`], ['Basis', l.basis], ['Net profit', money(l.net)], ['vs baseline', cmp ? `${fmt.signedMoney(cmp.diffUsd)} (${cmp.improvementApplicable ? fmt.pct(cmp.improvementPct) : 'ratio not applicable'})` : '—'], ['Of which exposure / decisions', cmp ? `${fmt.signedMoney(cmp.exposureGainUsd)} / ${fmt.signedMoney(cmp.decisionGainUsd)}` : '—'], ['Labels', (l.labels || []).join(', ') || 'development result'], ['Failed criteria', cmp ? (cmp.failed.length ? cmp.failed.map((k) => CRIT_LABEL[k] || k).join(', ') : 'none') : '—']]) : h('p', {}, 'none yet'))));
}

function notificationsSection(P) {
  const { api, reload, notes } = P;
  const unseen = notes.filter((n) => !n.seen_at);
  const pref = getPref();
  const toggle = h('input', { type: 'checkbox', checked: pref ? true : null, onchange: async (e) => { if (e.target.checked) { const ok = await askPermission(); if (!ok) { e.target.checked = false; toast('Browser notifications were not allowed', 'warn'); return; } setPref(true); toast('Browser notifications on while this page is open', 'ok'); } else { setPref(false); } } });
  const list = notes.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['When', 'Kind', 'Message', ''].map((t) => h('th', {}, t)))), h('tbody', {}, notes.map((n) => h('tr', { class: n.seen_at ? 'muted' : '' },
    h('td', {}, fmt.et(n.created_at)), h('td', {}, badge(n.kind, n.kind === 'shortlisted' ? 'ok' : 'info')), h('td', {}, h('strong', {}, n.title), ' ', n.body),
    h('td', {}, n.seen_at ? 'seen' : h('button', { class: 'btn', onclick: async () => { await api('POST', '/api/research/notifications/seen', { ids: [n.id] }); reload(); } }, 'Mark seen')))))) : h('p', {}, 'No notification yet. One is created when a result clears the 10% target with the risk and data-quality conditions; later ones only when a result beats the last notified by at least 5% of the baseline.');
  return section(`Notifications (${unseen.length} unseen)`, h('p', { class: 'hxr-caveat' }, 'Every notification is labelled "development improvement - not yet validated" and is stored in the runner\'s database, so it is here when the page is reopened. No email or message leaves the app.'),
    field('Also show browser notifications while this page is open', toggle, 'Uses the browser\'s own notification; nothing is delivered while the page is closed.'), list);
}

function resultsSection(P) {
  const { exps, reload } = P;
  const input = (name, value, placeholder) => h('input', { type: 'text', name, value, placeholder, oninput: (e) => { S[name] = e.target.value; } });
  const sel = (name, opts, value) => h('select', { name, onchange: (e) => { S[name] = e.target.value; reload(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l)));
  const form = h('form', { class: 'hxr-actions', onsubmit: (e) => { e.preventDefault(); reload(); } },
    input('q', S.q, 'search name or hypothesis'), sel('stage', [['', 'all stages'], ['0', 'reference'], ['1', 'single (baseline)'], ['2', 'single (other bases)'], ['3', 'combinations']], S.stage),
    sel('status', [['', 'all statuses'], ['done', 'done'], ['queued', 'queued'], ['running', 'running'], ['failed', 'failed'], ['cancelled', 'cancelled']], S.status),
    sel('label', [['', 'all labels'], ['development result', 'development result'], ['shortlisted candidate', 'shortlisted candidate'], ['independently evaluated', 'independently evaluated']], S.label),
    h('button', { class: 'btn', type: 'submit' }, 'Search'));
  const head = ['#', 'Stage', 'Experiment', 'Status', 'Net profit', 'Return', 'Max DD', 'Exposure', 'Turnover', 'Costs', 'Trades', 'Top stock', 'vs baseline', 'Null p', 'Labels'];
  const rows = exps.items.map((e) => { const s = e.summary, cmp = s?.comparison; return h('tr', { class: cmp?.clearsTarget ? 'hxr-hit' : '', onclick: () => openExperiment(P, e.id) },
    h('td', {}, String(e.id)), h('td', {}, STAGE[e.stage]), h('td', {}, h('strong', {}, e.name), h('div', { class: 'cell-sub' }, e.hypothesis.slice(0, 120))), h('td', {}, badge(e.status, STATUS_KIND[e.status] || ''), e.error ? h('div', { class: 'cell-sub' }, e.error.slice(0, 80)) : null),
    h('td', { class: tone(s?.net) }, s ? fmt.signedMoney(s.net) : '—'), h('td', {}, s ? fmt.pct(s.totalReturnPct) : '—'), h('td', {}, s ? fmt.plainPct(s.maxDrawdownPct, 2) : '—'), h('td', {}, s ? fmt.plainPct(s.avgInvestedPct, 1) : '—'), h('td', {}, s ? fmt.num(s.turnoverPerYear) : '—'), h('td', {}, s ? money(s.costs) : '—'), h('td', {}, s ? `${s.completedTrades}${s.openAtEnd ? ` +${s.openAtEnd} open` : ''}` : '—'),
    h('td', {}, s?.topStock ? `${s.topStock.symbol} ${fmt.plainPct(s.topStock.share * 100, 0)}` : '—'), h('td', { class: tone(cmp?.diffUsd) }, cmp ? `${fmt.signedMoney(cmp.diffUsd)}${cmp.improvementApplicable ? ` (${fmt.pct(cmp.improvementPct, 1)})` : ''}` : '—'), h('td', {}, s?.nullP == null ? '—' : fmt.num(s.nullP, 3)),
    h('td', {}, (s?.labels || []).map((l) => badge(l, l === 'shortlisted candidate' ? 'ok' : 'muted')))); });
  return section(`Experiments (${exps.total} shown of the campaign; click a row for details, the equity curve and the config)`, form, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: head.length }, 'nothing matches'))))));
}

async function openExperiment(P, id) {
  let e;
  try { e = await P.api('GET', `/api/research/experiments/${id}`); } catch (err) { toast(String(err.message || err), 'danger'); return; }
  const s = e.summary || {}, cmp = s.comparison || null;
  const crit = cmp ? h('ul', { class: 'bullets' }, Object.entries(cmp.criteria).map(([k, v]) => h('li', {}, badge(v.ok ? 'pass' : 'fail', v.ok ? 'ok' : 'danger'), ` ${CRIT_LABEL[k] || k}: ${v.value == null ? '—' : typeof v.value === 'number' ? fmt.num(v.value, k === 'nullTest' ? 3 : 2) : v.value} (${v.limit})${v.note ? `; ${v.note}` : ''}`))) : h('p', {}, 'not evaluated');
  const changes = (e.change || []).length ? h('ul', { class: 'bullets' }, e.change.map((c) => h('li', {}, `${c.field}: ${String(c.from)} -> ${String(c.to)} (${c.meaning})`))) : h('p', {}, e.stage === 0 ? 'a planned config, unchanged' : 'no change recorded');
  const chart = e.equity?.length > 1 ? h('div', {}, h('h4', { class: 'lab-h4 first' }, 'Account value at each close vs the equal-weight index (simulated, US$)'),
    line(e.equity.map((p) => ({ t: p.date, v: p.equity })), { height: 220, overlays: [{ points: e.equity.map((p) => ({ t: p.date, v: p.indexValue ?? null })), label: 'Equal-weight index (benchmark (a))', class: 'hxr-hold' }], refLines: [{ v: s.startValue ?? 15000, label: 'Starting cash', class: 'cost' }] })) : null;
  const body = h('div', { class: 'stack' },
    kv([['Hypothesis', e.hypothesis], ['Stage', STAGE[e.stage]], ['Base / parent', `${e.baseFile || '—'}${e.parent ? ` / #${e.parent.id} ${e.parent.name}` : ''}`], ['Status', e.status], ['Labels', (s.labels || []).join(', ') || '—'], ['Code revision', `${e.codeRevision || '—'}; engine ${e.engineVersion || '—'}`], ['Data / symbols / calibration', `${(e.dataHash || '').slice(0, 12)} / ${(e.symbolsHash || '').slice(0, 12)} / ${(e.calibrationHash || '').slice(0, 12)}`], ['Config hash', e.configHash], ['Duration', e.durationMs != null ? `${e.durationMs} ms` : '—'], e.error ? ['Error', e.error] : null]),
    h('h4', { class: 'lab-h4' }, 'What changed'), changes,
    h('h4', { class: 'lab-h4' }, 'Result (measured; benchmarks derived)'),
    s.net != null ? kv([['Starting / ending equity', `${money(s.startValue)} / ${money(s.endValue)}`], ['Net profit after costs', fmt.signedMoney(s.net)], ['Return / annualised', `${fmt.pct(s.totalReturnPct)} / ${fmt.pct(s.annualisedReturnPct)}`], ['Max drawdown', `${fmt.plainPct(s.maxDrawdownPct, 2)} (${money(s.maxDrawdownUsd)})`], ['Exposure (avg invested) / time in cash', `${fmt.plainPct(s.avgInvestedPct, 1)} / ${fmt.plainPct(s.timeInCashPct, 1)}`], ['Turnover a year / costs', `${fmt.num(s.turnoverPerYear)} / ${money(s.costs)}`], ['Trades / open at end / skips', `${s.completedTrades} / ${s.openAtEnd} / ${s.skips}`], ['Profit concentration', s.topStock ? `${s.topStock.symbol} ${fmt.plainPct(s.topStock.share * 100, 1)} of gross gain ${money(s.grossGain)}` : '—'], ['Exposure-matched hold', s.exposureMatched ? `${money(s.exposureMatched.endValue)} (${fmt.pct(s.exposureMatched.annualisedReturnPct)} a year, DD ${fmt.plainPct(s.exposureMatched.maxDrawdownPct, 2)})` : '—'], ['Equal-weight index', s.index ? `${money(s.index.endValue)} (${fmt.pct(s.index.annualisedReturnPct)} a year, DD ${fmt.plainPct(s.index.maxDrawdownPct, 2)})` : '—'], ['Best-5% stress', s.bestFive ? `${s.bestFive.K} of ${s.bestFive.n} removed (${money(s.bestFive.removedPL)}): net ${fmt.signedMoney(s.bestFive.adjustedNet)}` : '—'], ['Random-timing null', s.nullTest?.p != null ? `p = ${fmt.num(s.nullTest.p, 3)} (${s.nullTest.atOrAbove} of ${s.nullTest.resamples} at or above; timing P/L ${money(s.nullTest.actualTimingPnl)}; p50 ${money(s.nullTest.percentiles.p50)}, p95 ${money(s.nullTest.percentiles.p95)})` : '—'], ['Accounting', s.accounting ? (s.accounting.ok ? `reconciles (difference ${money(s.accounting.reconciliation.difference)})` : s.accounting.problems.join('; ')) : '—']]) : h('p', {}, 'no result'),
    cmp ? h('div', {}, h('h4', { class: 'lab-h4' }, 'Against the baseline and the criteria'), kv([['Baseline', `#${cmp.baselineExperimentId ?? '—'}: ${money(cmp.baselineNet)}`], ['Difference', `${fmt.signedMoney(cmp.diffUsd)} (${cmp.improvementApplicable ? fmt.pct(cmp.improvementPct) : 'ratio not applicable'})`], ['From exposure / from decisions', `${fmt.signedMoney(cmp.exposureGainUsd)} / ${fmt.signedMoney(cmp.decisionGainUsd)}`], ['vs leader at the time', cmp.vsLeader ? `#${cmp.vsLeader.leaderId} ${cmp.vsLeader.leaderName}: ${fmt.signedMoney(cmp.vsLeader.diffUsd)}` : '—'], ['Clears the target / shortlisted', `${cmp.clearsTarget ? 'yes' : 'no'} / ${cmp.shortlisted ? 'yes' : 'no'}`], ['Why', cmp.why.join('; ') || '—']]), crit) : null,
    chart,
    h('h4', { class: 'lab-h4' }, 'Configuration (executable; the research notes are separate)'), h('pre', { class: 'hxr-json' }, JSON.stringify(e.config, null, 2)));
  drawer(`Experiment #${e.id}: ${e.name}`, body, { wide: true });
}

function rulesSection(P) {
  const o = P.o, cr = o.criteria, lim = o.limits;
  return section('Fixed rules of the campaign (CAMPAIGN-1.md; nothing is lowered later)', kv([
    ['Data', `${o.period.start} to ${o.period.end} (warm-up ${o.period.warmupFrom}), basket ${o.period.basket}; the only window with a code path here`],
    ['Baseline', `${o.baselineFile}, re-run as experiment 1 and required to reproduce the practice run`],
    ['Target', `net profit at least ${cr.improvement * 100}% above the baseline; max drawdown at most ${cr.maxDrawdownPct}%; at least ${cr.minCompletedTrades} completed trades; accounting reconciles within $${cr.reconcileToleranceUsd}; data quality checked at start`],
    ['Shortlist', `also: best-${cr.bestFiveFraction * 100}% stress keeps net at least the baseline's; random-timing null p at most ${cr.nullMaxP} (${cr.nullResamples} resamples, seed ${cr.nullSeed}); top stock at most ${cr.maxTopStockShare * 100}% of gross gain; gain not explained by exposure alone`],
    ['Budget', `${lim.maxConfigs} unique configurations or ${lim.maxHours} hours, whichever first; one worker by default (concurrency ${lim.concurrency}); stop on resource limits (${(lim.minFreeBytes / 1024 ** 3).toFixed(0)} GB free, ${(lim.maxHeapBytes / 1024 ** 2).toFixed(0)} MB heap), invalid data or an accounting error`],
    ['Notifications', `on the first result that clears the target; then only when a result beats the last notified by ${cr.notifyStep * 100}% of the baseline; shortlisting is its own; all labelled "development improvement - not yet validated"`],
    ['Never', 'the evaluation window, a validated label, an order, a broker, email or messages outside the app'],
  ]));
}

// Browser notifications (optional, per-browser preference; only while the page is open).
function getPref() { try { return localStorage.getItem('rr-browser-notify') === '1'; } catch { return false; } }
function setPref(v) { try { localStorage.setItem('rr-browser-notify', v ? '1' : '0'); } catch { /* ignore */ } }
async function askPermission() { if (!('Notification' in window)) return false; if (Notification.permission === 'granted') return true; if (Notification.permission === 'denied') return false; return (await Notification.requestPermission()) === 'granted'; }
function browserNotify(notes) {
  if (!getPref() || !('Notification' in window) || Notification.permission !== 'granted') return;
  let last = 0;
  try { last = Number(localStorage.getItem('rr-browser-notify-last') || 0); } catch { /* ignore */ }
  const fresh = notes.filter((n) => n.id > last && !n.seen_at).sort((a, b) => a.id - b.id);
  for (const n of fresh.slice(-3)) { try { new Notification(n.title, { body: n.body.slice(0, 200) }); } catch { /* ignore */ } }
  if (fresh.length) { try { localStorage.setItem('rr-browser-notify-last', String(fresh.at(-1).id)); } catch { /* ignore */ } }
}
