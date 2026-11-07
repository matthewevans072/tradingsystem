// news-forward (strategy/news-forward/PROTOCOL-1.md) on the Research page: the forward simulated account's running
// result, labelled "running simulated result, not validated", the worker's health, plans recorded on time or late,
// and recent updates. Read-only: the worker is started and stopped from the command line. Server text is rendered as
// text nodes through h().
import { h, fmt, badge, notice, empty, section, kv } from '../lib/ui.js';

const money = (n) => fmt.money(n, '', 2);
export function newsForwardSection(o) {
  const title = 'Forward account (news-forward): running simulated result, not validated';
  if (!o) return section(title, empty('Not available', 'The forward account overview could not be loaded.'));
  if (o.demo) return section(title, notice('info', o.note));
  const parts = [h('div', { class: 'hxr-banner', role: 'note' }, h('strong', {}, 'Running simulated result, not validated. '), 'news-replay\'s tested pipeline on live Alpaca news and SEC filings, from the start session on. No order is placed anywhere; no frozen rule is tuned on these figures. The Claude-read news account (C2) is ', o.c2)];
  if (!o.activated) { parts.push(notice('info', o.note)); return section(title, h('div', { class: 'stack' }, ...parts)); }
  const w = o.worker;
  parts.push(kv([
    ['Start', `${o.activation.startSession} (activated ${o.activation.at}); pipeline planner ${o.activation.pipeline.planner}, entry ${o.activation.pipeline.entry}, exits ${o.activation.pipeline.exit}`],
    ['Worker', h('span', {}, w.alive ? badge(`alive (pid ${w.pid})`, 'ok') : badge('not running', 'danger'), ` requested: ${w.requested}; last heartbeat ${w.heartbeatAt ?? '—'}${w.state ? `; ${w.state}` : ''}`)],
    ['Plans', `${o.plans.total} recorded (${o.plans.entry} entry plans), ${o.plans.late} late (recorded after their window: they can never trade)`],
  ]));
  const r = o.latest?.report;
  if (r) parts.push(kv([
    ['As of', `${o.latest.date} (recorded ${o.latest.recordedAt})`],
    ['Net after costs', money(r.net)], ['T (net minus the exposure-matched hold)', money(r.T)],
    ['Equal-weight hold of basket A', money(r.index.net)], ['Exposure-matched hold', money(r.exposureMatched.net)],
    ['Maximum drawdown', fmt.plainPct(r.maxDrawdownPct, 2)], ['Average invested', fmt.plainPct(r.avgInvestedPct, 1)],
    ['Costs', money(r.costs)], ['Trades', `${r.completedTrades} completed, ${r.openAtEnd} open`],
  ]));
  else parts.push(empty('No complete session yet', 'The running result appears after the first complete session since the start.'));
  if (o.updates?.length) parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...['Update', 'Kind', 'Status', 'Finished', 'Plans (recorded / late)', 'Error'].map((t) => h('th', {}, t)))), h('tbody', {}, ...o.updates.map((u) => h('tr', {}, h('td', {}, String(u.id)), h('td', {}, u.kind), h('td', {}, badge(u.status, u.status === 'done' ? 'ok' : 'danger')), h('td', {}, u.finishedAt), h('td', {}, u.plans ? `${u.plans.recorded} / ${u.plans.late}` : '—'), h('td', {}, u.error || '')))))));
  return section(title, h('div', { class: 'stack' }, ...parts));
}
