import { h, mount, fmt, tone, section, notice, empty, actionChip, badge, CATEGORY_LABEL, ACTION_LABEL } from '../lib/ui.js';
import { donut, PALETTE } from '../lib/charts.js';

function bars(items) {
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return h('div', { class: 'bars' }, items.map((i) => h('div', { class: 'bar-row' },
    h('span', { class: 'bar-label' }, i.label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${(i.value / max) * 100}%` } })),
    h('span', { class: 'bar-value num' }, `${i.value.toFixed(1)}%`))));
}

function kpiMoney(label, perCcy, foot, { signed = false, pctKey = null } = {}) {
  const rows = ['USD', 'CAD'].filter((c) => perCcy[c] != null);
  return h('div', { class: 'card kpi' },
    h('div', { class: 'kpi-label' }, label),
    rows.length === 0 ? h('div', { class: 'kpi-value muted' }, '—') : null,
    rows.map((c, i) => {
      const v = perCcy[c];
      const p = pctKey ? perCcy[`${c}_pct`] : null;
      const text = signed ? fmt.signedMoney(v.value, c) : fmt.money(v.value, c);
      return h(i === 0 ? 'div' : 'div', { class: i === 0 ? `kpi-value ${signed ? tone(v.value) : ''}` : `kpi-sub ${signed ? tone(v.value) : ''}` },
        text, p != null ? h('span', { class: 'small' }, ` (${fmt.pct(p)})`) : null,
        v.note ? h('span', { class: 'small muted' }, ` ${v.note}`) : null);
    }),
    foot ? h('div', { class: 'kpi-foot' }, foot) : null);
}

export async function renderOverview(view, { api, app }) {
  const [o, status] = await Promise.all([api('GET', '/api/overview'), app.status ? Promise.resolve(app.status) : api('GET', '/api/status')]);
  const t = o.totals;
  const has = (c) => t[c].positions > 0 || t[c].cash != null;
  const blocks = [];

  // Setup checklist until everything essential is done.
  const pending = status.setup.filter((s) => !s.done);
  if (pending.length && status.mode === 'real') {
    blocks.push(section('Getting started',
      h('p', { class: 'muted' }, 'These steps connect Signal Desk to your real portfolio. Nothing is assumed or filled in for you.'),
      h('div', { class: 'setup' }, status.setup.map((s) => h('div', { class: `setup-item ${s.done ? 'done' : ''}` }, h('span', { class: 'tick' }, s.done ? '✓' : ''), s.label))),
      h('div', { class: 'row mt' },
        h('a', { class: 'btn primary', href: '#/settings' }, 'Open setup'),
        h('a', { class: 'btn', href: '#/positions' }, 'Add or import holdings'))));
  }

  if (!o.positions.length) {
    blocks.push(empty('No holdings recorded yet',
      'Import your brokerage CSV or enter positions from your latest statement. Example data is kept in a separate demo workspace (Settings → Workspace).',
      h('a', { class: 'btn primary', href: '#/positions' }, 'Add holdings')));
    mount(view, h('div', { class: 'stack' }, blocks));
    return;
  }

  // KPIs: always per currency; combined only with a dated FX rate.
  const mv = {}, day = {}, unrl = {}, cash = {};
  for (const c of ['USD', 'CAD']) {
    if (!has(c)) continue;
    mv[c] = { value: t[c].marketValue, note: t[c].complete ? '' : `(${t[c].positions - t[c].pricedPositions} unpriced)` };
    day[c] = { value: t[c].dailyPL }; day[`${c}_pct`] = t[c].dailyPct;
    unrl[c] = { value: t[c].unrealizedPL }; unrl[`${c}_pct`] = t[c].unrealizedPct;
    cash[c] = t[c].cash == null ? { value: null, note: 'not recorded' } : { value: t[c].cash, note: t[c].cashConfirmed ? '' : '(unconfirmed)' };
  }
  const fxFoot = o.combined
    ? `Combined ≈ ${fmt.money(o.combined.total, 'CAD')} incl. cash at USD/CAD ${o.combined.fxRate} (${o.combined.fxSource}, ${o.combined.fxAsOf})${o.combined.complete ? '' : ' — excludes unpriced positions'}`
    : 'USD and CAD are not combined: no dated exchange rate is stored yet.';
  const cashDates = ['USD', 'CAD'].filter((c) => t[c].cashAsOf).map((c) => `${c} as of ${t[c].cashAsOf}`).join(' · ');
  blocks.push(h('div', { class: 'grid kpis' },
    kpiMoney('Market value', mv, fxFoot),
    kpiMoney('Available cash', cash, cashDates || 'Enter cash balances in Positions → Cash.'),
    kpiMoney("Today's P/L", day, 'Price change since previous close on current holdings.', { signed: true, pctKey: true }),
    kpiMoney('Unrealized P/L', unrl, 'Versus your recorded average cost. Not a time-weighted return.', { signed: true, pctKey: true })));

  // Allocation and sectors.
  const weighted = o.positions.filter((p) => p.weightPct != null).sort((a, b) => b.weightPct - a.weightPct);
  const top = weighted.slice(0, 8);
  const rest = weighted.slice(8).reduce((s, p) => s + p.weightPct, 0);
  const slices = [...top.map((p, i) => ({ label: p.symbol, value: p.weightPct, color: PALETTE[i % PALETTE.length] })), ...(rest > 0 ? [{ label: 'Other', value: rest, color: '#56657a' }] : [])];
  const allocation = section(o.combined ? 'Position weights (CAD-equivalent)' : 'Position weights (within each currency)',
    slices.length ? h('div', { class: 'donut-wrap' },
      donut(slices, { centerValue: `${o.positions.length}`, centerLabel: 'positions' }),
      h('div', { class: 'legend' }, slices.map((s) => h('div', { class: 'legend-row' }, h('span', { class: 'lbl' }, h('span', { class: 'sw', style: { background: s.color } }), s.label), h('span', { class: 'num' }, fmt.plainPct(s.value)))))) :
      h('p', { class: 'muted' }, o.combined ? 'No priced positions yet.' : 'Weights across currencies need a USD/CAD rate. Within-currency weights are on the Positions page.'));

  const sectorItems = Object.entries(o.sectors).map(([k, v]) => ({ label: CATEGORY_LABEL[k] || k, value: o.combined ? v.value : v.byCurrency.USD + v.byCurrency.CAD }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const sectorTotal = sectorItems.reduce((s, x) => s + x.value, 0);
  const sectors = section('Sector exposure',
    sectorItems.length ? bars(sectorItems.map((x) => ({ ...x, value: (x.value / sectorTotal) * 100 }))) : h('p', { class: 'muted' }, 'No priced positions yet.'),
    !o.combined && sectorItems.length ? h('p', { class: 'small muted' }, 'Mixed-currency values summed without conversion; approximate until a USD/CAD rate is stored.') : null,
    h('p', { class: 'small muted' }, 'ETFs are counted in their own category; their underlying holdings may overlap with individual stocks you own.'));
  blocks.push(h('div', { class: 'grid two' }, allocation, sectors));

  // Contributors & catalysts.
  const contribList = ['USD', 'CAD'].flatMap((c) => [...o.contributors[c].top, ...o.contributors[c].bottom]);
  const contributors = section("Today's largest contributors",
    contribList.length ? h('div', { class: 'list' }, contribList.map((p) => h('div', { class: 'list-item spread' },
      h('div', {}, h('span', { class: 'sym' }, p.symbol), ' ', h('span', { class: 'muted small' }, p.oneLiner || '')),
      h('div', { class: `num ${tone(p.dailyPL)}` }, fmt.signedMoney(p.dailyPL, p.currency), h('span', { class: 'small' }, ` ${fmt.pct(p.dailyPct)}`))))) :
      h('p', { class: 'muted' }, 'No daily price changes available (needs current quotes with a previous close).'));
  const catalysts = section('Upcoming earnings & catalysts (30 days)',
    o.events.length ? h('div', { class: 'list' }, o.events.slice(0, 10).map((e) => h('div', { class: 'list-item' },
      h('div', { class: 'spread' }, h('strong', {}, e.type === 'earnings' ? `${e.symbol} earnings` : e.title), h('span', { class: 'num' }, fmt.date(e.date))),
      h('div', { class: 'meta' }, e.time_hint && e.time_hint !== 'unknown' ? badge(e.time_hint === 'bmo' ? 'Before open' : e.time_hint === 'amc' ? 'After close' : 'During market') : null, h('span', {}, e.source))))) :
      h('p', { class: 'muted' }, 'No scheduled events found for your holdings. Earnings dates appear once a data provider is connected; you can add macro events under Intelligence.'));
  blocks.push(h('div', { class: 'grid two' }, contributors, catalysts));

  // Briefing & alerts.
  const b = o.briefing;
  const briefing = section('Latest briefing',
    b ? h('div', { class: 'stack', style: { gap: '10px' } },
      h('div', { class: 'spread' }, h('a', { href: `#/reports?id=${b.id}` }, h('strong', {}, b.title)), h('span', { class: `small status-${b.status}` }, b.status === 'partial' ? 'Partial data' : 'Complete')),
      h('div', { class: 'muted small' }, `Generated ${fmt.et(b.generated_at)}`),
      b.narrative ? h('div', { class: 'narrative' }, h('div', { class: 'headline' }, b.narrative.headline), h('div', {}, b.narrative.summary), h('div', { class: 'small muted' }, b.narrative.label)) : null,
      b.priorities.length ? h('div', { class: 'list' }, b.priorities.map((it) => h('div', { class: 'list-item' }, it.action ? actionChip(it.action) : null, ' ', it.text))) : null,
      b.dataIssues?.length ? notice('warn', `${b.dataIssues.length} data limitation(s) in this briefing.`) : null) :
      h('p', { class: 'muted' }, 'No briefings yet. They are generated at 9:15, 10:30 and one hour before the close on trading days while Signal Desk is running, or on demand from Reports.'),
    o.lastFailed.length ? notice('danger', 'Recent briefing problems: ', o.lastFailed.map((f) => `${f.kind} ${f.trading_date} ${f.status}`).join('; ')) : null);
  const alerts = section('Alerts',
    o.alerts.length ? h('div', { class: 'list' }, o.alerts.map((a) => h('div', { class: 'list-item' },
      h('div', {}, badge(a.severity, a.severity === 'high' ? 'danger' : a.severity === 'warn' ? 'warn' : 'info'), ' ', h('strong', {}, a.title)),
      h('div', { class: 'meta' }, h('span', {}, fmt.et(a.triggered_at)), h('span', {}, `delivery: ${a.delivery_status || '—'}`))))) :
      h('p', { class: 'muted' }, 'No unacknowledged alerts. Alerts come from the separate monitor that checks prices every few minutes during market hours.'));
  blocks.push(h('div', { class: 'grid main-side' }, briefing, alerts));

  // Freshness & limitations.
  const f = o.freshness;
  const actions = Object.entries(o.actionCounts).map(([k, n]) => `${n} ${ACTION_LABEL[k] || k}`).join(' · ');
  blocks.push(section('Data freshness',
    h('div', { class: 'row' },
      badge(`${f.fresh} fresh`, 'ok'), f.stale ? badge(`${f.stale} stale`, 'warn') : null, f.missing ? badge(`${f.missing} without a quote`, 'danger') : null,
      f.providers.length ? h('span', { class: 'muted small' }, `Provider: ${f.providers.join(', ')} · ${f.timeliness.join(', ') || 'timeliness unknown'}`) : h('span', { class: 'muted small' }, 'No quotes stored.'),
      f.newest ? h('span', { class: 'muted small' }, `Newest quote ${fmt.et(f.newest)}`) : null,
      f.fx ? h('span', { class: 'muted small' }, `USD/CAD ${f.fx.rate} (${f.fx.source}, ${f.fx.asOf})`) : h('span', { class: 'muted small' }, 'No USD/CAD rate stored')),
    actions ? h('p', { class: 'small muted mt' }, `Assessments: ${actions}`) : null,
    o.limitations.length ? notice('info', h('strong', {}, 'What these numbers can and cannot tell you'), h('ul', {}, o.limitations.map((l) => h('li', {}, l)))) : null,
    o.issues.length ? notice('danger', h('strong', {}, 'Ledger issues'), h('ul', {}, o.issues.map((i) => h('li', {}, i.message)))) : null));

  mount(view, h('div', { class: 'stack' }, blocks));
}
