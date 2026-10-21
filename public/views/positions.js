import {
  h, mount, fmt, tone, section, notice, empty, actionChip, badge, freshnessDot, drawer, field, select, formData, toast, kv, extLink,
  CATEGORY_LABEL, ACTION_LABEL, loading, errorState,
} from '../lib/ui.js';
import { line } from '../lib/charts.js';
import { setContext } from '../lib/api.js';

const STRATEGY = { long_term: 'Long-term', swing: 'Swing trade', unclassified: 'Unclassified' };
const EXCHANGES = [['NASDAQ', 'NASDAQ'], ['NYSE', 'NYSE'], ['NYSE Arca', 'NYSE Arca'], ['NYSE American', 'NYSE American'], ['Cboe BZX', 'Cboe BZX'], ['TSX', 'TSX'], ['TSXV', 'TSX Venture'], ['Cboe Canada', 'Cboe Canada (NEO)'], ['CSE', 'CSE']];
const AI_CONN = { direct: 'Direct AI link', indirect: 'Indirect AI link', speculative: 'Speculative AI link', none: 'No AI link' };

function securityCell(p) {
  const d = p.description;
  const oneLiner = d?.oneLiner
    ? h('div', { class: `one-liner ${d.identityWarning ? 'warn' : ''}` }, d.oneLiner)
    : h('div', { class: 'one-liner warn' }, 'Description not yet available — add one from an official source in the detail panel.');
  return h('div', { class: 'sec-cell' },
    h('div', { class: 'sec-top' },
      h('span', { class: 'sym' }, p.symbol), h('span', { class: 'exch' }, `${p.exchange} · ${p.currency}`),
      d?.leveraged ? badge(d.dailyObjective ? 'Leveraged/inverse — daily reset' : 'Leveraged', 'lev', d.dailyObjective || '') : null,
      p.identityStatus !== 'confirmed' ? badge('Confirm identity', 'warn', 'Exact security not yet confirmed from your brokerage record; not priced') : null,
      p.unconfirmed?.length ? badge(`Unconfirmed: ${p.unconfirmed.join(', ')}`, 'warn') : null),
    p.name ? h('div', { class: 'sec-name' }, p.name) : null,
    oneLiner,
    d?.leveraged && d.dailyObjective && !/daily/i.test(d.oneLiner || '') ? h('div', { class: 'one-liner warn' }, `Objective: ${d.dailyObjective}`) : null);
}

function priceCell(p) {
  if (p.price == null) return h('td', { class: 'num' }, h('span', { class: 'price-line' }, freshnessDot(p.quote), '—'), h('div', { class: 'cell-sub' }, p.identityStatus !== 'confirmed' ? 'not priced' : 'no quote'));
  const q = p.quote;
  return h('td', { class: 'num' },
    h('span', { class: 'price-line' }, freshnessDot(q), fmt.num(p.price)),
    h('div', { class: 'cell-sub' }, q.freshness === 'stale' ? 'stale · ' : '', q.timeliness === 'delayed' ? `${q.delayMinutes || ''}m delay` : q.timeliness || ''));
}

export async function renderPositions(view, ctx) {
  const { api } = ctx;
  const data = await api('GET', '/api/positions');
  const ps = data.positions;
  const rerender = () => renderPositions(view, ctx);

  const toolbar = h('div', { class: 'spread' },
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => openTransactionForm(ctx, rerender) }, '+ Add trade or holding'),
      h('button', { class: 'btn', onclick: () => openImport(ctx, rerender) }, 'Import CSV'),
      h('button', { class: 'btn', onclick: () => openCash(ctx, data, rerender) }, 'Cash balances')),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => openAudit(ctx) }, 'Change history'),
      h('button', { class: 'btn ghost', onclick: async () => { try { await api('POST', '/api/refresh', { what: 'assess' }); toast('Assessments updated'); rerender(); } catch (e) { toast(e.message, 'error'); } } }, 'Re-run assessments')));

  if (!ps.length) {
    mount(view, h('div', { class: 'stack' }, toolbar, empty('No open positions',
      'Add each holding from your latest brokerage statement (as a dated baseline), or import a CSV of trades. Exchange and currency are required so tickers are never guessed.')),
    data.closed.length ? closedSection(data, ctx) : null);
    return;
  }

  const rows = ps.map((p) => h('tr', { onclick: () => openDetail(ctx, p.instrument_id, rerender) },
    h('td', {}, securityCell(p)),
    h('td', {}, h('div', {}, STRATEGY[p.strategy]), h('div', { class: 'cell-sub' }, p.account)),
    h('td', { class: 'num' }, fmt.qty(p.shares)),
    h('td', { class: 'num' }, fmt.num(p.avgCost), h('div', { class: 'cell-sub' }, p.hasBaseline ? 'from snapshot' : '')),
    priceCell(p),
    h('td', { class: `num ${tone(p.dailyPL)}` }, fmt.pct(p.dailyPct), h('div', { class: 'cell-sub' }, fmt.signedMoney(p.dailyPL))),
    h('td', { class: 'num' }, fmt.money(p.marketValue), h('div', { class: 'cell-sub' }, p.currency)),
    h('td', { class: `num ${tone(p.unrealizedPL)}` }, fmt.signedMoney(p.unrealizedPL), h('div', { class: 'cell-sub' }, fmt.pct(p.unrealizedPct))),
    h('td', { class: 'num' }, p.weightPct != null ? fmt.plainPct(p.weightPct) : p.weightInCurrencyPct != null ? h('span', { title: 'Share of holdings in the same currency (no FX rate yet)' }, `${fmt.plainPct(p.weightInCurrencyPct)}*`) : '—'),
    h('td', {}, actionChip(p.assessment?.action), p.assessment ? h('div', { class: 'cell-sub' }, p.assessment.horizon) : null)));

  const table = h('div', { class: 'card desktop-table' }, h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Security', 'Strategy', 'Shares', 'Avg cost', 'Price', 'Today', 'Value', 'Unrealized', 'Weight', 'Assessment'].map((x, i) => h('th', { class: i >= 2 && i <= 8 ? 'num' : '' }, x)))),
    h('tbody', {}, rows))));

  const cards = h('div', { class: 'mobile-cards' }, ps.map((p) => h('div', { class: 'pos-card', onclick: () => openDetail(ctx, p.instrument_id, rerender) },
    h('div', { class: 'spread' }, securityCell(p), actionChip(p.assessment?.action)),
    h('div', { class: 'grid2' },
      h('div', {}, h('div', { class: 'l' }, 'Price'), h('div', { class: 'row' }, freshnessDot(p.quote), fmt.num(p.price))),
      h('div', {}, h('div', { class: 'l' }, 'Today'), h('div', { class: tone(p.dailyPL) }, `${fmt.pct(p.dailyPct)} · ${fmt.signedMoney(p.dailyPL)}`)),
      h('div', {}, h('div', { class: 'l' }, 'Value'), h('div', {}, fmt.money(p.marketValue, p.currency))),
      h('div', {}, h('div', { class: 'l' }, 'Unrealized'), h('div', { class: tone(p.unrealizedPL) }, `${fmt.signedMoney(p.unrealizedPL)} (${fmt.pct(p.unrealizedPct)})`)),
      h('div', {}, h('div', { class: 'l' }, 'Shares · avg'), h('div', {}, `${fmt.qty(p.shares)} @ ${fmt.num(p.avgCost)}`)),
      h('div', {}, h('div', { class: 'l' }, 'Strategy'), h('div', {}, STRATEGY[p.strategy]))))));

  const cash = data.cash.length ? h('div', { class: 'row small muted' }, 'Cash: ', data.cash.map((c) => badge(`${c.account} ${fmt.money(c.amount, c.currency)} · ${c.as_of}${c.confirmed ? '' : ' · unconfirmed'}`, c.confirmed ? '' : 'warn'))) : notice('warn', 'Available cash is not recorded. Assessments will not suggest adding to any position until you confirm cash in each currency.');

  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('symbol');
  // Consume the deep link so a later refresh does not reopen the drawer and the same link works again.
  if (wanted) history.replaceState(null, '', '#/positions');
  const target = wanted && ps.find((p) => p.symbol === wanted.toUpperCase());
  if (target) setTimeout(() => openDetail(ctx, target.instrument_id, rerender), 0);
  else if (wanted) toast(`${wanted.toUpperCase()} is not an open position.`, 'error');

  mount(view, h('div', { class: 'stack' },
    toolbar,
    data.issues.length ? notice('danger', h('strong', {}, 'Ledger issues'), h('ul', {}, data.issues.map((i) => h('li', {}, i.message)))) : null,
    ps.some((p) => p.identityStatus !== 'confirmed') ? notice('warn', 'Some instruments are not yet confirmed. Open them and confirm the exchange, currency and issuer from your brokerage record; until then they are not priced or described.') : null,
    cash,
    table, cards,
    data.limitations.length ? notice('info', h('ul', {}, data.limitations.map((l) => h('li', {}, l)))) : null,
    h('p', { class: 'small muted' }, 'Assessments are rule-based, conditional and refreshed with each briefing. They are decision support, not instructions. * = weight within the same currency.'),
    data.closed.length ? closedSection(data, ctx) : null));
}

function closedSection(data, ctx) {
  return section('Closed positions', h('div', { class: 'list' }, data.closed.map((p) => h('div', { class: 'list-item spread' },
    h('div', {}, h('span', { class: 'sym' }, p.symbol), ' ', h('span', { class: 'muted small' }, `${p.exchange} · ${p.account}`)),
    h('div', { class: `num ${tone(p.realizedPL)}` }, `Realized ${fmt.signedMoney(p.realizedPL, p.currency)}`)))));
}

// ---------- detail drawer ----------

async function openDetail(ctx, instrumentId, onChange) {
  const { api } = ctx;
  const d = drawer('Loading…', loading(), { wide: true, onClose: () => setContext({ selectedSymbol: null }) });
  let x;
  try {
    x = await api('GET', `/api/instruments/${instrumentId}`);
  } catch (e) {
    mount(d.body, errorState(e));
    return;
  }
  const inst = x.instrument;
  const pos = x.positions[0];
  setContext({ selectedSymbol: inst.symbol });
  document.querySelector('.drawer-head h2').textContent = `${inst.symbol} · ${inst.exchange} · ${inst.currency}`;
  const desc = x.description || {};
  const r = x.research;
  const a = pos?.assessment || x.assessments[0];
  const ind = x.indicators;

  const blocks = [];
  if (inst.identity_status !== 'confirmed') {
    blocks.push(notice('warn', h('strong', {}, 'Instrument identity not confirmed. '),
      'Check your brokerage record for the exact exchange, currency and issuer before relying on any data. ',
      desc.ambiguity ? h('div', { class: 'mt small' }, desc.ambiguity) : null,
      x.otherListings?.length ? h('div', { class: 'small' }, `Other listings with this ticker: ${x.otherListings.map((o) => `${o.exchange} (${o.currency})`).join(', ')}`) : null,
      identityForm(ctx, inst, async () => { d.close(); await onChange(); openDetail(ctx, instrumentId, onChange); })));
  }

  // What it does.
  blocks.push(section('What it does',
    h('p', { class: desc.identityWarning ? 'warn-text' : '' }, desc.oneLiner || 'No description stored for this exact listing.'),
    r ? h('div', { class: 'stack', style: { gap: '10px' } },
      r.leveraged ? notice('danger', h('strong', {}, 'Leveraged / inverse fund. '), `${r.dailyObjective || ''} The multiple applies to a single day; over longer periods returns depend on the path of prices and can differ sharply from the multiple of the index return.`) : null,
      kv([
        ['Business', r.business], ['How it makes money', r.howItMakesMoney], ['AI / infrastructure role', r.aiRole],
        ['AI connection', r.aiConnection ? h('span', {}, badge(AI_CONN[r.aiConnection] || r.aiConnection, r.aiConnection === 'direct' ? 'ok' : r.aiConnection === 'speculative' ? 'warn' : '')) : null],
        ['Supply-chain role', r.supplyChainRole],
        ['Category', CATEGORY_LABEL[r.category] || r.category],
      ]),
      r.risks?.length ? h('div', {}, h('div', { class: 'field-label' }, 'Important business risks'), h('ul', { class: 'bullets' }, r.risks.map((x2) => h('li', {}, x2)))) : null,
      r.relationships?.length ? h('div', {}, h('div', { class: 'field-label' }, 'Verified business relationships'), h('ul', { class: 'bullets' }, r.relationships.map((rel) => h('li', {}, rel.text, ' ', extLink(rel.sourceUrl, 'source'))))) : null,
      h('div', { class: 'small muted' }, 'Source: ', extLink(r.sourceUrl), ` · last reviewed ${r.lastReviewed || '—'} · `, verificationLabel(r.verification), r.userEdited ? ' · edited by you' : ''),
      r.sourceNote ? h('div', { class: 'small muted' }, r.sourceNote) : null) : null,
    h('div', { class: 'row mt' }, h('button', { class: 'btn small', onclick: () => editDescription(ctx, inst, desc.identityWarning ? {} : (r || {}), () => { d.close(); openDetail(ctx, instrumentId, onChange); }) }, desc.missing ? 'Add description' : 'Edit description'))));

  // Assessment.
  if (a) {
    blocks.push(section('Assessment',
      h('div', { class: 'row' }, actionChip(a.action), h('span', { class: 'muted small' }, `${a.horizon || ''} · ${a.confidence || ''} · ${a.method === 'rules' ? 'rule-based' : a.method}`)),
      h('p', { class: 'mt' }, a.reason),
      kv([['Act if', a.trigger], ['Invalidated by', a.invalidation], ['Main downside risk', a.downside], ['Trend', a.trend], ['Data as of', a.dataAsOf ? fmt.et(a.dataAsOf) : '—']]),
      a.levels && Object.keys(a.levels).length ? h('div', { class: 'small muted mt' }, Object.entries(a.levels).map(([k, v]) => `${k}: ${v}`).join(' · ')) : null,
      a.sizing ? notice('info', h('strong', {}, 'Sizing (from your stated limits): '), `${a.sizing.shares} shares max. ${a.sizing.explanation}`) : h('div', { class: 'small muted mt' }, a.sizingStatus),
      a.notes?.length ? h('ul', { class: 'bullets small' }, a.notes.map((n) => h('li', {}, n))) : null,
      a.sources?.length ? h('div', { class: 'small muted mt' }, h('div', { class: 'field-label' }, 'Evidence used'), h('ul', { class: 'bullets' }, a.sources.map((s) => h('li', {}, s.url ? extLink(s.url, s.label) : s.label, s.at ? ` — ${fmt.et(s.at)}` : '', s.freshness ? ` (${s.freshness})` : '', s.status ? ` [${s.status}]` : '')))) : null));
  }

  // Price.
  if (x.bars.length > 1) {
    const pts = x.bars.slice(-130).map((b) => ({ t: b.t, v: b.c }));
    const smaSeries = (n) => x.bars.map((b, i, arr) => (i < n - 1 ? null : arr.slice(i - n + 1, i + 1).reduce((s, y) => s + y.c, 0) / n)).slice(-130).map((v, i) => ({ t: pts[i].t, v }));
    blocks.push(section('Price (daily closes, regular session)',
      line(pts, { overlays: [{ label: '20-day average', class: 'sma20', points: smaSeries(20) }, { label: '50-day average', class: 'sma50', points: smaSeries(50) }], refLines: pos ? [{ label: 'Your average cost', v: pos.avgCost, class: 'cost' }] : [] }),
      h('div', { class: 'row small muted' }, h('span', { class: 'warn-text' }, '— — 20-day'), h('span', { style: { color: '#a58fd8' } }, '— — 50-day'), pos ? h('span', {}, '····· your average cost') : null),
      kv([['20-day range', `${fmt.num(ind.low20)} – ${fmt.num(ind.high20)}`], ['52-week range', ind.high52 ? `${fmt.num(ind.low52)} – ${fmt.num(ind.high52)}` : 'needs ~1 year of history'], ['Typical daily range (ATR 14)', ind.atr14 ? `${fmt.num(ind.atr14)} (${fmt.plainPct(ind.atrPct)})` : '—']])));
  } else {
    blocks.push(section('Price', h('p', { class: 'muted' }, 'No daily history stored yet. It is collected from your market-data provider once connected.')));
  }

  // Quote.
  if (x.quote) {
    const q = x.quote;
    blocks.push(section('Latest quote',
      kv([
        ['Price', `${fmt.num(q.price)} ${inst.currency}`], ['Previous close', fmt.num(q.prevClose)], ['Change', `${fmt.signedMoney(q.change)} (${fmt.pct(q.changePct)})`],
        ['Regular session open / high / low', `${fmt.num(q.open)} / ${fmt.num(q.high)} / ${fmt.num(q.low)}`],
        ['Volume', q.volume != null ? Math.round(q.volume).toLocaleString() : 'not supplied by provider'],
        ['Extended hours', q.ext ? `${fmt.num(q.ext.price)} (${fmt.pct(q.ext.changePct)}) ${q.ext.session} at ${fmt.et(q.ext.time)}` : 'not available on current data plan'],
        ['Provider', q.provider], ['Quote time', fmt.et(q.quoteTime)], ['Session', q.session], ['Timeliness', `${q.timeliness || '—'}${q.delayMinutes ? ` (${q.delayMinutes} min)` : ''}`],
        ['Status', h('span', { class: 'row' }, freshnessDot(q), q.freshness, q.freshnessReason ? ` — ${q.freshnessReason}` : '')],
        q.lastError ? ['Last error', h('span', { class: 'neg' }, `${q.lastError} (${fmt.et(q.lastErrorAt)})`)] : null,
      ])));
  }

  // Position & actions.
  if (pos) {
    blocks.push(section('Your position',
      kv([
        ['Account', pos.account], ['Shares', fmt.qty(pos.shares)], ['Average cost (incl. fees)', `${fmt.num(pos.avgCost, 4)} ${pos.currency}`], ['Cost basis', fmt.money(pos.costBasis, pos.currency)],
        ['Unrealized', `${fmt.signedMoney(pos.unrealizedPL, pos.currency)} (${fmt.pct(pos.unrealizedPct)})`], ['Realized to date', fmt.signedMoney(pos.realizedPL, pos.currency)],
        pos.fxDecomposition ? ['In CAD terms', `${fmt.signedMoney(pos.fxDecomposition.totalCad, 'CAD')} = price ${fmt.signedMoney(pos.fxDecomposition.priceEffectCad)} + currency ${fmt.signedMoney(pos.fxDecomposition.currencyEffectCad)} (avg purchase rate ${pos.fxDecomposition.avgPurchaseFx})`] : null,
        pos.fxNote ? ['Currency effect', pos.fxNote] : null,
        pos.splitsApplied?.length ? ['Splits applied', pos.splitsApplied.map((s) => `${s.date} ${s.ratio}`).join(', ')] : null,
      ]),
      h('div', { class: 'row mt' },
        h('button', { class: 'btn small', onclick: () => openTransactionForm(ctx, async () => { d.close(); await onChange(); }, { symbol: inst.symbol, exchange: inst.exchange, currency: inst.currency, account: pos.account }) }, 'Record trade'),
        h('button', { class: 'btn small', onclick: () => strategyForm(ctx, pos, async () => { d.close(); await onChange(); }) }, 'Strategy & thesis'),
        h('button', { class: 'btn small', onclick: () => closeForm(ctx, pos, async () => { d.close(); await onChange(); }) }, 'Close position'),
        h('button', { class: 'btn small ghost', onclick: () => splitForm(ctx, inst, async () => { d.close(); await onChange(); }) }, 'Record split'),
        h('button', { class: 'btn small ghost', onclick: () => symbolForm(ctx, inst, async () => { d.close(); await onChange(); }) }, 'Symbol change'),
        h('button', { class: 'btn small ghost', onclick: () => alertRuleForm(ctx, inst) }, 'Price alert')),
      pos.thesis ? h('p', { class: 'small mt' }, h('strong', {}, 'Your thesis: '), pos.thesis) : null));
  }

  // Transactions.
  blocks.push(section('Transactions',
    x.transactions.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Date', 'Type', 'Qty', 'Price', 'Fees', 'Source', ''].map((c) => h('th', {}, c)))),
      h('tbody', {}, x.transactions.map((t) => h('tr', { style: { cursor: 'default', opacity: t.voided_at ? 0.45 : 1 } },
        h('td', {}, t.trade_date), h('td', {}, t.type, t.voided_at ? ' (void)' : ''), h('td', { class: 'num' }, fmt.qty(t.quantity)), h('td', { class: 'num' }, fmt.num(t.price, 4)),
        h('td', { class: 'num' }, fmt.num(t.fees)), h('td', {}, t.source, t.unconfirmed_fields ? badge('unconfirmed', 'warn', JSON.parse(t.unconfirmed_fields).join(', ')) : null),
        h('td', {}, t.voided_at ? null : h('div', { class: 'row' },
          h('button', { class: 'btn small ghost', onclick: () => editTxForm(ctx, t, async () => { d.close(); await onChange(); openDetail(ctx, instrumentId, onChange); }) }, 'Edit'),
          h('button', { class: 'btn small ghost danger', onclick: async () => { const why = prompt('Reason for voiding this transaction (kept in the change history):'); if (!why) return; await api('POST', `/api/transactions/${t.id}/void`, { reason: why }); toast('Voided'); d.close(); await onChange(); } }, 'Void')))))))) : h('p', { class: 'muted' }, 'No transactions.')));

  if (x.news.length) blocks.push(section('Recent news & filings', h('div', { class: 'list' }, x.news.slice(0, 8).map((n) => h('div', { class: 'list-item' }, extLink(n.url, n.title), h('div', { class: 'meta' }, badge(n.status, n.status === 'confirmed' ? 'ok' : n.status === 'conflicting' ? 'danger' : n.status === 'unconfirmed' ? 'warn' : ''), h('span', {}, n.source_name || n.provider), h('span', {}, fmt.et(n.published_at))))))));

  mount(d.body, blocks);
}

function verificationLabel(v) {
  if (v === 'verified') return badge('Checked against official source', 'ok', 'Matched against official company/fund source excerpts');
  if (v === 'secondary') return badge('Secondary source', 'warn');
  if (v === 'user-reviewed') return badge('Reviewed by you', 'info');
  return badge('Unverified', 'danger');
}

// ---------- forms ----------

function submitRow(label, onSubmit) {
  const btn = h('button', { class: 'btn primary', type: 'submit' }, label);
  return { btn, row: h('div', { class: 'row mt' }, btn) };
}

async function guarded(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
}

function identityForm(ctx, inst, done) {
  const form = h('form', { class: 'stack mt', style: { gap: '10px' } },
    h('div', { class: 'form-grid' },
      field('Provider symbol (optional)', h('input', { name: 'provider_symbol', value: inst.provider_symbol || '', placeholder: inst.symbol }), 'Only if your data provider uses a different code.'),
      field('Security type', select('sec_type', [['stock', 'Stock'], ['etf', 'ETF'], ['adr', 'ADR / depositary receipt'], ['other', 'Other']], inst.sec_type))),
    field('How did you confirm it?', h('input', { name: 'identity_note', required: true, placeholder: 'e.g. Brokerage statement: SPCX, NASDAQ, USD, Space Exploration Technologies Corp. Class A' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'ok', required: true }), `I checked that ${inst.symbol} is listed on ${inst.exchange} in ${inst.currency} for the issuer named above.`));
  const { btn, row } = submitRow('Confirm instrument');
  form.append(row);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    await ctx.api('PATCH', `/api/instruments/${inst.id}`, { identity_status: 'confirmed', identity_note: f.identity_note, provider_symbol: f.provider_symbol || null, sec_type: f.sec_type });
    toast('Instrument confirmed');
    await done();
  }); });
  return form;
}

export function openTransactionForm(ctx, done, preset = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const form = h('form', { class: 'stack' },
    notice('info', 'Use BASELINE for a holding copied from a statement or screenshot: it records shares and average cost as of that date. Mark any value you are not sure about as unconfirmed.'),
    h('div', { class: 'form-grid' },
      field('Type', select('type', [['BASELINE', 'Baseline (from statement)'], ['BUY', 'Buy'], ['SELL', 'Sell'], ['DIVIDEND', 'Dividend (cash)'], ['DEPOSIT', 'Deposit'], ['WITHDRAWAL', 'Withdrawal'], ['FEE', 'Fee'], ['INTEREST', 'Interest']], preset.type || 'BASELINE')),
      field('Date', h('input', { name: 'trade_date', type: 'date', value: today, required: true })),
      field('Account', h('input', { name: 'account', value: preset.account || '', placeholder: 'e.g. TFSA', required: true })),
      field('Symbol', h('input', { name: 'symbol', value: preset.symbol || '', placeholder: 'e.g. VRT', autocomplete: 'off' })),
      field('Exchange', select('exchange', [['', 'Select…'], ...EXCHANGES], preset.exchange || '')),
      field('Trading currency', select('currency', [['USD', 'USD'], ['CAD', 'CAD']], preset.currency || 'USD')),
      field('Shares', h('input', { name: 'quantity', type: 'number', step: 'any', min: '0' })),
      field('Price per share', h('input', { name: 'price', type: 'number', step: 'any', min: '0' }), 'Average cost for a baseline'),
      field('Fees', h('input', { name: 'fees', type: 'number', step: 'any', min: '0', value: '0' })),
      field('Cash amount', h('input', { name: 'amount', type: 'number', step: 'any', min: '0' }), 'For deposits, dividends, fees'),
      field('USD→CAD rate at trade (optional)', h('input', { name: 'fx_rate_cad', type: 'number', step: 'any', min: '0' }), 'Lets Signal Desk separate currency effects'),
      field('Strategy', select('strategy', [['', 'Keep current'], ['long_term', 'Long-term'], ['swing', 'Swing trade'], ['unclassified', 'Unclassified']], ''))),
    h('div', { class: 'row' }, h('span', { class: 'field-label' }, 'Unconfirmed values:'),
      ['quantity', 'price', 'fees', 'trade_date'].map((k) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `u_${k}` }), k))),
    field('Note', h('input', { name: 'note', placeholder: 'e.g. From brokerage screenshot dated 2026-10-15' })));
  const { btn, row } = submitRow('Save');
  form.append(row);
  const d = drawer('Record a trade or holding', form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    const unconfirmed = ['quantity', 'price', 'fees', 'trade_date'].filter((k) => f[`u_${k}`]);
    const body = { type: f.type, trade_date: f.trade_date, account: f.account, symbol: f.symbol, exchange: f.exchange, currency: f.currency,
      quantity: f.quantity, price: f.price, fees: f.fees || 0, amount: f.amount, fx_rate_cad: f.fx_rate_cad, strategy: f.strategy || undefined, note: f.note,
      unconfirmed_fields: unconfirmed, source: f.type === 'BASELINE' ? 'screenshot' : 'manual' };
    await ctx.api('POST', '/api/transactions', body);
    toast('Saved');
    d.close();
    await done();
  }); });
}

function editTxForm(ctx, t, done) {
  const unconf = t.unconfirmed_fields ? JSON.parse(t.unconfirmed_fields) : [];
  const form = h('form', { class: 'stack' },
    h('div', { class: 'form-grid' },
      field('Date', h('input', { name: 'trade_date', type: 'date', value: t.trade_date })),
      field('Shares', h('input', { name: 'quantity', type: 'number', step: 'any', value: t.quantity ?? '' })),
      field('Price', h('input', { name: 'price', type: 'number', step: 'any', value: t.price ?? '' })),
      field('Fees', h('input', { name: 'fees', type: 'number', step: 'any', value: t.fees ?? 0 })),
      field('USD→CAD rate', h('input', { name: 'fx_rate_cad', type: 'number', step: 'any', value: t.fx_rate_cad ?? '' }))),
    h('div', { class: 'row' }, h('span', { class: 'field-label' }, 'Still unconfirmed:'),
      ['quantity', 'price', 'fees', 'trade_date'].map((k) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `u_${k}`, checked: unconf.includes(k) }), k))),
    field('Reason for change', h('input', { name: '_reason', required: true, placeholder: 'e.g. Confirmed against October statement' })));
  const { btn, row } = submitRow('Save changes');
  form.append(row);
  const d = drawer(`Edit ${t.type} of ${t.trade_date}`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    await ctx.api('PATCH', `/api/transactions/${t.id}`, { trade_date: f.trade_date, quantity: f.quantity, price: f.price, fees: f.fees, fx_rate_cad: f.fx_rate_cad,
      unconfirmed_fields: ['quantity', 'price', 'fees', 'trade_date'].filter((k) => f[`u_${k}`]), _reason: f._reason });
    toast('Updated (previous values kept in change history)');
    d.close();
    await done();
  }); });
}

function strategyForm(ctx, pos, done) {
  const form = h('form', { class: 'stack' },
    field('Classification', select('strategy', [['long_term', 'Long-term holding'], ['swing', 'Swing trade'], ['unclassified', 'Unclassified']], pos.strategy)),
    field('Thesis (why you own it, what would make you sell)', h('textarea', { name: 'thesis', style: { fontFamily: 'inherit', fontSize: '13px' } }, pos.thesis || '')));
  const { btn, row } = submitRow('Save');
  form.append(row);
  const d = drawer(`${pos.symbol} strategy`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    await ctx.api('POST', '/api/positions/strategy', { account_id: pos.account_id, instrument_id: pos.instrument_id, strategy: f.strategy, thesis: f.thesis });
    toast('Saved'); d.close(); await done();
  }); });
}

function closeForm(ctx, pos, done) {
  const form = h('form', { class: 'stack' },
    notice('info', `Records a sale of all ${fmt.qty(pos.shares)} shares. Enter the actual execution price from your brokerage; Signal Desk never places orders.`),
    h('div', { class: 'form-grid' },
      field('Sale date', h('input', { name: 'date', type: 'date', value: new Date().toISOString().slice(0, 10) })),
      field(`Sale price (${pos.currency})`, h('input', { name: 'price', type: 'number', step: 'any', required: true })),
      field('Fees', h('input', { name: 'fees', type: 'number', step: 'any', value: '0' }))));
  const { btn, row } = submitRow('Record sale');
  form.append(row);
  const d = drawer(`Close ${pos.symbol}`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    await ctx.api('POST', '/api/positions/close', { account_id: pos.account_id, instrument_id: pos.instrument_id, ...f });
    toast('Position closed'); d.close(); await done();
  }); });
}

function splitForm(ctx, inst, done) {
  const form = h('form', { class: 'stack' },
    notice('info', 'A split changes share count and per-share cost; total cost basis is unchanged. Example: a 4-for-1 split is 1 → 4.'),
    h('div', { class: 'form-grid' },
      field('Effective date', h('input', { name: 'effectiveDate', type: 'date', required: true })),
      field('Old shares', h('input', { name: 'ratioFrom', type: 'number', step: 'any', value: '1', required: true })),
      field('New shares', h('input', { name: 'ratioTo', type: 'number', step: 'any', required: true }))),
    field('Source / note', h('input', { name: 'note', placeholder: 'e.g. Company press release URL' })));
  const { btn, row } = submitRow('Record split');
  form.append(row);
  const d = drawer(`Split for ${inst.symbol}`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const r = await ctx.api('POST', `/api/instruments/${inst.id}/split`, formData(form));
    toast(r.added ? 'Split recorded' : 'That split was already recorded'); d.close(); await done();
  }); });
}

function symbolForm(ctx, inst, done) {
  const form = h('form', { class: 'stack' },
    notice('info', 'Use this when a company changes its ticker. History and cost basis stay attached to the same instrument.'),
    h('div', { class: 'form-grid' },
      field('New symbol', h('input', { name: 'newSymbol', required: true })),
      field('Effective date', h('input', { name: 'effectiveDate', type: 'date', required: true }))),
    field('Source / note', h('input', { name: 'note' })));
  const { btn, row } = submitRow('Change symbol');
  form.append(row);
  const d = drawer(`Symbol change for ${inst.symbol}`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    await ctx.api('POST', `/api/instruments/${inst.id}/symbol-change`, formData(form));
    toast('Symbol updated'); d.close(); await done();
  }); });
}

function alertRuleForm(ctx, inst) {
  const form = h('form', { class: 'stack' },
    h('div', { class: 'form-grid' },
      field('When price is', select('type', [['price_above', 'at or above'], ['price_below', 'at or below']], 'price_below')),
      field(`Price (${inst.currency})`, h('input', { name: 'price', type: 'number', step: 'any', required: true }))),
    h('p', { class: 'small muted' }, 'Checked by the continuous monitor during market hours, using the latest fresh quote.'));
  const { btn, row } = submitRow('Add alert');
  form.append(row);
  const d = drawer(`Price alert for ${inst.symbol}`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    await ctx.api('POST', '/api/alert-rules', { type: f.type, price: f.price, instrument_id: inst.id });
    toast('Alert added'); d.close();
  }); });
}

function editDescription(ctx, inst, cur, done) {
  const form = h('form', { class: 'stack' },
    notice('info', 'Use the company or fund issuer’s own website or filings. Keep the one-liner to one plain sentence about what it makes, sells or provides.'),
    field('One-line description', h('input', { name: 'oneLiner', value: cur.oneLiner && !cur.identityWarning ? cur.oneLiner : '', maxlength: 140, required: true })),
    field('Name', h('input', { name: 'name', value: cur.name || inst.name || '' })),
    field('Main business & products', h('textarea', { name: 'business', style: { fontFamily: 'inherit', fontSize: '13px' } }, cur.business || '')),
    field('How it makes money', h('textarea', { name: 'howItMakesMoney', style: { fontFamily: 'inherit', fontSize: '13px' } }, cur.howItMakesMoney || '')),
    field('Role in AI / infrastructure', h('textarea', { name: 'aiRole', style: { fontFamily: 'inherit', fontSize: '13px' } }, cur.aiRole || '')),
    h('div', { class: 'form-grid' },
      field('AI connection', select('aiConnection', [['none', 'None'], ['indirect', 'Indirect'], ['direct', 'Direct'], ['speculative', 'Speculative']], cur.aiConnection || 'none')),
      field('Official source URL', h('input', { name: 'sourceUrl', type: 'url', value: cur.sourceUrl || '', required: true }))),
    field('Key risks (one per line)', h('textarea', { name: 'risks', style: { fontFamily: 'inherit', fontSize: '13px' } }, (cur.risks || []).join('\n'))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'leveraged', checked: !!cur.leveraged }), 'Leveraged or inverse fund'),
    field('Daily objective (leveraged/inverse only)', h('input', { name: 'dailyObjective', value: cur.dailyObjective || '' })));
  const { btn, row } = submitRow('Save description');
  form.append(row);
  const d = drawer(`Description for ${inst.symbol} (${inst.exchange})`, form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    const f = formData(form);
    await ctx.api('PUT', '/api/descriptions', { symbol: inst.symbol, exchange: inst.exchange, ...f, risks: f.risks.split('\n').map((s) => s.trim()).filter(Boolean), leveraged: !!f.leveraged, dailyObjective: f.dailyObjective || null });
    toast('Description saved'); d.close(); await done();
  }); });
}

function openCash(ctx, data, done) {
  const form = h('form', { class: 'stack' },
    notice('warn', 'Your last known information was that no cash was available after buying dips. Please confirm current balances from your brokerage; until you do, Signal Desk will not suggest adding to any position.'),
    data.cash.length ? h('div', { class: 'list' }, data.cash.map((c) => h('div', { class: 'list-item spread' }, h('span', {}, `${c.account} · ${c.currency}`), h('span', {}, fmt.money(c.amount, c.currency), ` as of ${c.as_of} `, c.confirmed ? badge('confirmed', 'ok') : badge('unconfirmed', 'warn'))))) : null,
    h('div', { class: 'form-grid' },
      field('Account', h('input', { name: 'account', required: true, placeholder: 'e.g. TFSA', value: data.accounts[0]?.name || '' })),
      field('Currency', select('currency', [['CAD', 'CAD'], ['USD', 'USD']], 'CAD')),
      field('Available cash', h('input', { name: 'amount', type: 'number', step: 'any', required: true })),
      field('As of', h('input', { name: 'asOf', type: 'date', value: new Date().toISOString().slice(0, 10) }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'confirmed', checked: true }), 'I checked this against my brokerage today'));
  const { btn, row } = submitRow('Save balance');
  form.append(row);
  const d = drawer('Available cash', form);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(btn, async () => {
    await ctx.api('POST', '/api/cash', formData(form));
    toast('Cash saved'); d.close(); await done();
  }); });
}

function openImport(ctx, done) {
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv' });
  const text = h('textarea', { placeholder: 'Or paste CSV here…' });
  const preview = h('div', {});
  const tpl = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
    const t = await ctx.api('GET', '/api/import/template');
    text.value = t.csv;
  } }, 'Show template');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (f) text.value = await f.text();
  });
  const go = h('button', { class: 'btn primary', type: 'button' }, 'Preview import');
  go.addEventListener('click', () => guarded(go, async () => {
    const p = await ctx.api('POST', '/api/import/preview', { filename: fileInput.files[0]?.name || 'pasted.csv', text: text.value });
    renderPreview(p);
  }));
  function renderPreview(p) {
    const apply = h('button', { class: 'btn primary', disabled: p.summary.new === 0 }, `Apply ${p.summary.new} new row(s)`);
    apply.addEventListener('click', () => guarded(apply, async () => {
      const r = await ctx.api('POST', `/api/import/${p.batchId}/apply`);
      toast(`Imported ${r.inserted} row(s); ${r.skippedErrors} error row(s) skipped`);
      d.close(); await done();
    }));
    mount(preview, section('Preview — nothing has been saved yet',
      h('div', { class: 'row' }, badge(`${p.summary.new} new`, 'ok'), badge(`${p.summary.duplicate} already imported`, ''), badge(`${p.summary.error} with errors`, p.summary.error ? 'danger' : '')),
      p.unknownColumns.length ? h('p', { class: 'small muted' }, `Ignored columns: ${p.unknownColumns.join(', ')}`) : null,
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Line', 'Status', 'Date', 'Type', 'Symbol', 'Exch', 'Ccy', 'Qty', 'Price', 'Notes'].map((c) => h('th', {}, c)))),
        h('tbody', {}, p.rows.map((r) => h('tr', { style: { cursor: 'default' } },
          h('td', {}, r.line), h('td', {}, badge(r.status, r.status === 'new' ? 'ok' : r.status === 'error' ? 'danger' : '')), h('td', {}, r.trade_date || '—'), h('td', {}, r.type), h('td', {}, r.symbol || ''),
          h('td', {}, r.exchange || ''), h('td', {}, r.currency || ''), h('td', { class: 'num' }, r.quantity ?? ''), h('td', { class: 'num' }, r.price ?? ''),
          h('td', { class: 'small' }, [...(r.problems || []), ...(r.warnings || [])].join('; '))))))),
      h('div', { class: 'row mt' }, apply, h('span', { class: 'small muted' }, 'Rows with errors are skipped. Fix them in the file and import again; duplicates are detected automatically.'))));
  }
  const d = drawer('Import transactions from CSV', h('div', { class: 'stack' },
    notice('info', 'Required columns: date (YYYY-MM-DD), type, symbol, exchange, currency, quantity, price. Optional: fees, account, strategy, fx_rate_cad, note, transaction id. Ambiguous dates and missing exchanges are rejected rather than guessed.'),
    h('div', { class: 'row' }, fileInput, tpl), text, h('div', { class: 'row' }, go), preview), { wide: true });
}

async function openAudit(ctx) {
  const d = drawer('Change history', loading(), { wide: true });
  try {
    const rows = await ctx.api('GET', '/api/audit?limit=200');
    mount(d.body, rows.length ? h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'list-item' },
      h('div', { class: 'spread' }, h('strong', {}, `${r.entity} ${r.entity_id || ''} · ${r.action}`), h('span', { class: 'small muted' }, fmt.et(r.at))),
      r.note ? h('div', { class: 'small' }, r.note) : null,
      h('details', { class: 'more' }, h('summary', {}, 'Details'), h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap', color: 'var(--text-2)' } },
        r.before_json ? `Before: ${r.before_json}\n` : '', r.after_json ? `After: ${r.after_json}` : ''))))) : h('p', { class: 'muted' }, 'No changes recorded yet.'));
  } catch (e) {
    mount(d.body, errorState(e));
  }
}
