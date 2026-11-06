// news-replay (strategy/news-replay/CAMPAIGN-1.md) on the Research page: read-only results of the historical news
// replay (2020-01-02 to 2021-12-31) with the four plain-English answers per configuration, plan fates, the comparisons
// and a plan inspector (simulated time, inputs, plans, activation, recorded action, next fill; the outcome in a
// separate panel). Runs start only from the command line. Every text from the server, headlines included, is rendered
// as a text node through h(). Every figure is a simulated development result, not validated.
import { h, fmt, badge, notice, empty, section, kv, toast } from '../lib/ui.js';

const OPEN = new Set(['D-A', 'P-A']);
const I = { el: null, api: null, config: 'D-A', stock: '', session: '', offset: 0, list: null, detail: null, busy: false };
const money = (n) => fmt.money(n, '', 2);
const et = (ms) => (ms == null ? '—' : new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' ET');
const lvl = (n) => (n == null ? '—' : Number(n).toFixed(4));
const FATE = {
  neither_activated: 'neither activated before expiry', bearish_activated: 'bearish activated', activated_then_gain: 'bullish activated, then a gain',
  activated_then_loss_at_exit: 'bullish activated, then a loss at exit', activated_then_invalidated: 'bullish activated, then invalidated',
  activated_open_at_end: 'bullish activated, open at the end', funding_or_caps_rejected: 'funding or caps rejected',
  rejected_invalidation_at_or_above_fill: 'rejected: invalidation at or above the fill', expired: 'expired', no_setup: 'no setup (entry condition not met)',
  cancelled: 'cancelled by a later bearish activation', already_held: 'already held', disarmed: 'disarmed by a negative headline (DC)',
};
const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', {}, t)))), h('tbody', {}, ...rows)));
const num = (v) => h('td', { class: 'num' }, v);

export function newsReplaySection(o, api) {
  const title = 'news-replay (historical news replay): campaign 1';
  if (!o) return section(title, empty('Not available', 'The news-replay overview could not be loaded.'));
  if (o.demo) return section(title, notice('info', o.note));
  I.api = api;
  const parts = [h('div', { class: 'hxr-banner', role: 'note' }, h('strong', {}, 'Simulated historical replay. '), `${o.replay.from} to ${o.replay.to} on basket A; every figure is a ${o.label}. Plans were saved before the market could trigger them; outcomes come from a separate evaluation pass. The AI configurations are not run: no API spending authorised.`)];
  const done = o.runs.filter((r) => r.status === 'done').length, failed = o.runs.filter((r) => r.status === 'failed').length, running = o.runs.filter((r) => r.status === 'running').length;
  const runnable = o.configs.filter((c) => !c.notRun).length;
  const tested = o.comparisons.filter((c) => c.status === 'tested').length;
  parts.push(kv([
    ['Code', `${o.codeRevision}; engine ${o.engineVersion}`],
    ['Records', `${o.records.countsEntries ? 'event counts logged' : 'event counts not logged yet'}; ${o.records.frozen ? 'frozen for campaign 1' : 'not frozen yet'}; ${o.records.loggedRuns} run rows in the log`],
    ['Runs', `${done} done, ${failed} failed, ${running} running of ${runnable * 4} (${runnable} configurations, each with 3 sensitivities)`],
    ['Placebo', `${tested} of ${o.comparisons.length} comparisons tested (${o.inference.resamples.toLocaleString('en-US')} resamples, seed ${o.inference.seed}, Holm over ${o.inference.holmFamily.length})`],
  ]));
  parts.push(resultsTable(o));
  for (const c of o.configs) if (c.report) parts.push(configDetails(c, o));
  parts.push(h('h4', {}, 'Pre-registered comparisons'), table(['Comparison', 'Pairs', 'Statistic (sum of T differences)', 'Placebo p', 'Holm p', 'Status'], o.comparisons.map((c) => h('tr', {}, h('td', {}, `${c.id} ${c.name}`), h('td', {}, c.pairs.map((p) => p.join(' vs ')).join('; ')), num(c.statistic == null ? '—' : money(c.statistic)), num(c.p == null ? '—' : c.p.toFixed(4)), num(c.holmP == null ? '—' : c.holmP.toFixed(4)), h('td', {}, c.significant ? badge('Holm-significant', 'ok') : c.status)))));
  parts.push(inspector(o));
  return section(title, h('div', { class: 'stack' }, ...parts));
}

function resultsTable(o) {
  const rows = o.configs.map((c) => {
    const r = c.report;
    if (!r) return h('tr', {}, h('td', {}, c.id), h('td', {}, c.phase ?? '—'), h('td', { colspan: '11' }, c.notRun || 'not run yet'));
    const s = c.sensitivities;
    return h('tr', {}, h('td', {}, c.id), h('td', {}, c.phase ?? '—'), num(money(r.net)), num(money(r.T)), num(money(r.index.net)), num(money(r.exposureMatched.net)), num(fmt.plainPct(r.maxDrawdownPct, 2)), num(fmt.plainPct(r.avgInvestedPct, 1)), num(r.completedTrades), num(money(r.costs)), num(s.costs_x2 == null ? '—' : money(s.costs_x2)), num(s.delay_bar == null ? '—' : money(s.delay_bar)), num(s.delay_session == null ? '—' : money(s.delay_session)));
  });
  return h('div', {}, h('h4', {}, 'Configurations against the benchmarks (US$, on US$15,000)'), table(['Config', 'Phase', 'Net after costs', 'T (net minus exposure-matched hold)', 'Equal-weight hold net', 'Exposure-matched hold net', 'Max drawdown', 'Avg invested', 'Completed trades', 'Costs', 'T, costs x2', 'T, +1 bar', 'T, +1 session'], rows));
}

function configDetails(c, o) {
  const r = c.report, a = c.answers;
  const d = h('details', { class: 'card', open: OPEN.has(c.id), ontoggle: (e) => { if (e.target.open) OPEN.add(c.id); else OPEN.delete(c.id); } });
  const qa = Object.entries(o.questions).map(([k, q]) => h('div', {}, h('strong', {}, q), h('p', {}, a[k])));
  const pf = r.planFates;
  const fates = pf ? table(['Plan fate', 'Plans'], Object.entries(pf.fates).sort((x, y) => y[1] - x[1]).map(([k, v]) => h('tr', {}, h('td', {}, FATE[k] || k), num(v)))) : null;
  const cats = pf ? table(['Event category', 'Activated or not (entry plans)', 'Trades', 'Wins', 'P/L of its trades'], Object.entries(pf.byCategory).map(([k, v]) => h('tr', {}, h('td', {}, k), num(v.plans), num(v.trades), num(v.wins), num(money(v.pnl))))) : null;
  const stocks = table(['Stock', 'P/L'], Object.entries(r.perStock).map(([s, v]) => h('tr', {}, h('td', {}, s), num(money(v)))));
  const years = table(['Year', 'Net', 'Exposure-matched hold', 'Equal-weight hold'], Object.entries(r.annual).map(([y, v]) => h('tr', {}, h('td', {}, y), num(money(v.net)), num(money(v.exposureMatchedNet)), num(money(v.indexNet)))));
  const sig = table(['Bullish signal fate', 'Count'], Object.entries(r.signalFates || {}).map(([k, v]) => h('tr', {}, h('td', {}, FATE[k] || k), num(v))));
  d.append(
    h('summary', {}, h('strong', {}, `${c.id}: `), `net ${money(r.net)}, T ${money(r.T)}, ${r.completedTrades} trades `, a.madeMoney ? badge('made money (simulated)', 'ok') : badge('did not make money (simulated)', 'muted'), ' ', a.qualified ? badge('development candidate', 'ok') : badge('does not qualify', 'muted')),
    h('div', { class: 'stack' }, ...qa,
      h('h4', {}, 'Plan fates (entry plans)'), fates || h('p', {}, '—'), cats,
      h('h4', {}, 'Signals (bullish activations)'), sig,
      h('h4', {}, 'By stock and by year'), stocks, years,
      h('p', { class: 'cell-sub' }, `Exits ${Object.entries(r.exits || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}; ${r.winTrades} wins, ${r.lossTrades} losses; open at the end ${r.openAtEnd}; top stock ${r.concentration.topStock ?? '—'}${r.concentration.topShare != null ? ` (${(r.concentration.topShare * 100).toFixed(1)}% of the gross gain)` : ''}; accounting ${r.accounting.ok ? 'reconciles' : `does not reconcile: ${r.accounting.problems.join('; ')}`}.`)));
  return d;
}

// ---------- the plan inspector (kept across the page's periodic re-renders) ----------
function inspector(o) {
  if (!I.el) I.el = h('div', { class: 'stack' });
  const configs = o.configs.filter((c) => !c.notRun && c.report).map((c) => c.id);
  const changed = configs.join() !== (I.configs || []).join();
  I.configs = configs;
  I.basket = o.basket;
  if (!I.configs.includes(I.config)) I.config = I.configs[0] ?? 'D-A';
  if (!I.drawn || changed) drawInspector();
  return h('div', {}, h('h4', {}, 'Plan inspector'), I.el);
}
async function loadList() {
  if (I.busy) return;
  I.busy = true;
  try {
    const q = new URLSearchParams({ config: I.config, offset: String(I.offset) });
    if (I.stock) q.set('stock', I.stock);
    if (I.session) q.set('session', I.session);
    I.list = await I.api('GET', `/api/newsreplay/plans?${q}`);
  } catch (e) { toast(String(e.message || e), 'danger'); } finally { I.busy = false; }
  drawInspector();
}
async function loadPlan(id) {
  try { I.detail = await I.api('GET', `/api/newsreplay/plans/${id}?config=${encodeURIComponent(I.config)}`); } catch (e) { toast(String(e.message || e), 'danger'); }
  drawInspector();
}
function drawInspector() {
  I.drawn = true;
  const el = I.el;
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!I.configs?.length) { el.append(h('p', {}, 'Available once a configuration has finished its base run.')); return; }
  const cfg = h('select', { onchange: (e) => { I.config = e.target.value; I.offset = 0; I.detail = null; loadList(); } }, ...I.configs.map((c) => h('option', { value: c, selected: c === I.config }, c)));
  const stock = h('select', { onchange: (e) => { I.stock = e.target.value; I.offset = 0; } }, h('option', { value: '' }, 'all stocks'), ...(I.basket || []).map((s) => h('option', { value: s, selected: s === I.stock }, s)));
  const sess = h('input', { type: 'date', value: I.session, min: '2020-01-02', max: '2021-12-31', onchange: (e) => { I.session = e.target.value; I.offset = 0; } });
  el.append(h('div', { class: 'row' }, cfg, stock, sess, h('button', { class: 'btn', onclick: () => loadList() }, 'Show plans')));
  if (I.list) {
    const L = I.list;
    el.append(h('p', { class: 'cell-sub' }, `${L.total} entry plans of planner ${L.planner}${L.total ? `; showing ${L.offset + 1} to ${Math.min(L.offset + L.rows.length, L.total)}` : ''}. Pick one to inspect it.`));
    el.append(table(['Simulated time (T)', 'Stock', 'Category', 'Status', ''], L.rows.map((p) => h('tr', {}, h('td', {}, et(p.T)), h('td', {}, p.stock), h('td', {}, p.category), h('td', {}, p.status), h('td', {}, h('button', { class: 'btn', onclick: () => loadPlan(p.id) }, 'Inspect'))))));
    const nav = [];
    if (L.offset > 0) nav.push(h('button', { class: 'btn', onclick: () => { I.offset = Math.max(0, L.offset - L.limit); loadList(); } }, 'Earlier'));
    if (L.offset + L.rows.length < L.total) nav.push(h('button', { class: 'btn', onclick: () => { I.offset = L.offset + L.limit; loadList(); } }, 'Later'));
    if (nav.length) el.append(h('div', { class: 'row' }, ...nav));
  }
  if (I.detail) el.append(planView(I.detail));
}
function planView(d) {
  const p = d.plan, s = d.scenarios, inp = d.inputs;
  const items = inp.items.length ? h('ul', {}, ...inp.items.map((it) => h('li', {}, `${it.kind}, published ${it.published ?? '—'}${it.source ? ` (${it.source})` : ''}: `, it.missing ? h('em', {}, 'record not found') : it.headline ?? '—'))) : h('p', {}, 'No item: a price-only control session.');
  const bull = s.bullish ? `a 5-minute close at or above ${lvl(s.bullish.activation.level)} by ${et(s.bullish.activation.windowEndMs)}: ${s.bullish.armed ? s.bullish.action : 'disarmed by a negative headline'}` : '—';
  const bear = s.bearish ? `a 5-minute close at or below ${lvl(s.bearish.activation.level)} by ${et(s.bearish.activation.windowEndMs)}: ${s.bearish.action}` : '—';
  const act = d.activation ? (d.activation.detail.dir === 'none' ? 'Neither level was reached within 30 minutes (no trade).' : `${d.activation.detail.dir === 'bull' ? 'Bullish' : 'Bearish'}: the bar ending ${et(d.activation.detail.barEnd)} closed at ${lvl(d.activation.detail.close)}.`) : (d.runId ? 'No activation record.' : 'This configuration has not run yet.');
  const action = d.action ? `${FATE[d.action.detail.fate] || d.action.detail.fate}${d.action.detail.why ? `: ${d.action.detail.why}` : ''} (recorded ${et(d.action.ms)})` : '—';
  const fill = d.nextFill ? `the bar starting ${et(d.nextFill.ms)}: ${d.nextFill.shares} shares at ${lvl(d.nextFill.price)} (open ${lvl(d.nextFill.raw)} plus modelled spread and slippage), cost ${money(d.nextFill.cost)}, invalidation ${lvl(d.nextFill.invalidation)}` : 'no fill';
  const out = d.outcome;
  const outPanel = h('details', { class: 'card' }, h('summary', {}, 'Outcome (revealed separately)'),
    out ? h('div', { class: 'stack' }, h('p', {}, out.note), out.pnlFromRecords != null ? h('p', {}, h('strong', {}, 'P/L of this trade: '), money(out.pnlFromRecords)) : null,
      out.records.length ? h('ul', {}, ...out.records.map((a) => h('li', {}, `${et(a.ms)} ${a.kind}${a.detail.reason ? ` (${a.detail.reason})` : ''}${a.detail.price != null ? ` at ${lvl(a.detail.price)}` : ''}${a.detail.amount != null ? ` ${money(a.detail.amount)}` : ''}${a.detail.ratio != null ? ` ratio ${a.detail.ratio}` : ''}`))) : null) : h('p', {}, 'Not run yet.'));
  return h('div', { class: 'card stack' },
    h('h4', {}, `Plan ${p.id}: ${p.stock}, session ${p.session} (${d.config})`),
    kv([
      ['Simulated time', `${et(p.T)} (the first eligible item's time; nothing later is in the inputs)`],
      ['Saved', `${p.savedAt}, before any run; packet ${p.packetHash.slice(0, 12)}, chain ${p.chainHash.slice(0, 12)}, ${p.codeRevision}`],
      ['Category', p.category], ['Status', p.status === 'armed' ? 'armed' : `no trade: ${p.reason ?? ''}`],
      ['Reference price R', inp.reference ? `${lvl(inp.reference.R)} (${inp.reference.source})` : '—'], ['Typical move m', lvl(inp.typicalMove)],
    ]),
    h('strong', {}, 'Inputs available at T'), items,
    h('strong', {}, 'Plans'), kv([['Bullish', bull], ['Bearish', bear], ['No trade', s.noTrade], ['Invalidation', s.invalidation ? `a daily close below ${lvl(s.invalidation.level)}; exit at the next session's first bar open` : '—'], ['Exit', s.exit?.rule], ['Expiry', s.expirySession]]),
    h('strong', {}, 'What happened (recorded)'), kv([['Activation', act], ['Recorded action', action], ['Next eligible simulated fill', fill]]),
    outPanel);
}
