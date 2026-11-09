// prop-sim (strategy/prop-sim/CAMPAIGN-1.md) on the Research page: the simulated Lucid evaluations of the ICT structure
// strategies against matched random entries, with the four plain-English answers. Read-only; text through h().
// Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid.
import { h, badge, notice, empty, section } from '../lib/ui.js';

const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
const usd = (n) => (n == null ? '—' : `${n < 0 ? '-' : ''}US$${Math.abs(n).toFixed(2)}`);
const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', {}, t)))), h('tbody', {}, ...rows)));
const num = (v) => h('td', { class: 'num' }, v);
const OPEN = new Set();

export function propSimSection(o) {
  const title = 'prop-sim: ICT structure strategies in a simulated funded-account evaluation';
  if (!o) return section(title, empty('Not available', 'The prop-sim overview could not be loaded.'));
  if (o.demo) return section(title, notice('info', o.note));
  const parts = [h('div', { class: 'hxr-banner', role: 'note' }, h('strong', {}, `${o.label}. `), `${o.standIn}. Development data 2018-06-01 to 2022-12-30, already examined by earlier programmes: exploratory. A strategy that passes sometimes but no more often than random has shown no edge.`)];
  if (o.note) { parts.push(notice('info', o.note)); return section(title, h('div', { class: 'stack' }, ...parts)); }
  parts.push(h('p', { class: 'cell-sub' }, `Worker: ${o.worker ? `running (pid ${o.worker.pid}, heartbeat ${o.worker.heartbeatAt})` : 'not running'}; code ${o.codeRevision}.`));
  parts.push(table(['Config', 'Trades', 'LucidFlex 50K pass rate', 'Random twins', 'D', 'p', 'Holm p', 'Payout rate', 'Net per attempt (after fee)', 'LucidPro pass rate', 'Status'], o.configs.map((c) => {
    if (!c.run) return h('tr', {}, h('td', {}, c.id), h('td', { colspan: '10' }, 'not run yet'));
    const i = c.inference || {};
    return h('tr', {}, h('td', {}, c.id), num(c.run.trades), num(pct(c.run.primary.passRate)), num(`${c.randomSeeds} of ${o.seedsPerConfig}${i.randomMean != null ? ` (${pct(i.randomMean)})` : ''}`), num(i.D == null ? '—' : (100 * i.D).toFixed(1)), num(i.p == null ? '—' : i.p.toFixed(4)), num(i.holmP == null ? '—' : i.holmP.toFixed(4)), num(pct(c.run.primary.payoutRate)), num(usd(c.run.primary.expectedNet)), num(pct(c.run.secondary.passRate)), h('td', {}, i.significant ? badge('beats random', 'ok') : i.status || '—'));
  })));
  for (const c of o.configs) {
    if (!c.answers) continue;
    const d = h('details', { class: 'card', open: OPEN.has(c.id), ontoggle: (e) => { if (e.target.open) OPEN.add(c.id); else OPEN.delete(c.id); } });
    d.append(h('summary', {}, h('strong', {}, c.id), ` — pass rate ${pct(c.run.primary.passRate)}`),
      h('div', { class: 'stack' },
        h('div', {}, h('strong', {}, '1. How often did it pass, and did it make money after fees? '), c.answers.money),
        h('div', {}, h('strong', {}, '2. Did it beat random entries and the plain level break? '), c.answers.controls),
        h('div', {}, h('strong', {}, '3. How much risk did it take? '), c.answers.risk),
        h('div', {}, h('strong', {}, '4. How strong is the evidence? '), c.answers.evidence)));
    parts.push(d);
  }
  return section(title, h('div', { class: 'stack' }, ...parts));
}
