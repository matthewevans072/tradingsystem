import { h, mount, fmt, tone, section, notice, badge, extLink, toast, field, select, formData, drawer } from '../lib/ui.js';

const AI_CONN = { direct: ['Direct AI link', 'ok'], indirect: ['Indirect', ''], speculative: ['Speculative', 'warn'], none: ['No AI link', 'muted'] };

function card(it, ctx) {
  const [connLabel, connKind] = AI_CONN[it.aiConnection] || ['Not assessed', 'muted'];
  return h('article', { class: 'wl-card' },
    h('div', { class: 'spread' },
      h('div', {}, h('span', { class: 'sym' }, it.symbol), ' ', h('span', { class: 'exch' }, `${it.exchange}${it.currency ? ' · ' + it.currency : ''}`)),
      h('div', { class: 'row' }, it.held ? badge('You hold this', 'info') : null, badge(connLabel, connKind))),
    it.name ? h('div', { class: 'sec-name' }, it.name) : null,
    h('div', { class: 'one-liner' }, it.oneLiner || 'No description stored yet.'),
    it.supplyChainRole ? h('div', { class: 'role' }, `Supply-chain role: ${it.supplyChainRole}`) : null,
    it.quote ? h('div', { class: 'small' }, `${fmt.num(it.quote.price)} `, h('span', { class: tone(it.quote.changePct) }, fmt.pct(it.quote.changePct)), h('span', { class: 'muted' }, ` · ${it.quote.provider} ${fmt.et(it.quote.at)}`)) : null,
    it.whyAttention ? h('div', { class: 'small' }, h('strong', {}, 'Why it deserves attention: '), it.whyAttention) : null,
    it.investigateIf?.length ? h('div', { class: 'small' }, h('strong', {}, 'Investigate further if:'), h('ul', { class: 'bullets' }, it.investigateIf.map((x) => h('li', {}, x)))) : null,
    it.catalysts?.length ? h('div', { class: 'small' }, h('strong', {}, 'Upcoming: '), it.catalysts.map((c) => `${c.type} ${c.date}`).join(', ')) : null,
    it.news?.length ? h('div', { class: 'small' }, h('strong', {}, 'Recent: '), h('ul', { class: 'bullets' }, it.news.map((n) => h('li', {}, extLink(n.url, n.title), ` (${n.status}, ${fmt.date(n.published_at)})`)))) : null,
    h('details', { class: 'more' }, h('summary', {}, 'Business, risks & relationships'),
      it.business ? h('p', { class: 'small' }, it.business) : null,
      it.howItMakesMoney ? h('p', { class: 'small' }, h('strong', {}, 'How it makes money: '), it.howItMakesMoney) : null,
      it.aiRole ? h('p', { class: 'small' }, h('strong', {}, 'AI role: '), it.aiRole) : null,
      it.risks?.length ? h('div', { class: 'small' }, h('strong', {}, 'Main risks'), h('ul', { class: 'bullets' }, it.risks.map((x) => h('li', {}, x)))) : null,
      it.relationships?.length ? h('div', { class: 'small' }, h('strong', {}, 'Verified relationships'), h('ul', { class: 'bullets' }, it.relationships.map((r) => h('li', {}, r.text, ' ', extLink(r.sourceUrl, 'source'))))) : h('p', { class: 'small muted' }, 'No verified business relationships recorded.'),
      it.ambiguity ? notice('warn', it.ambiguity) : null,
      h('div', { class: 'small muted' }, 'Source: ', extLink(it.sourceUrl), ` · reviewed ${it.lastReviewed || '—'} · ${it.verification === 'verified' ? 'checked against official source' : it.verification}`),
      h('div', { class: 'row mt' }, h('button', { class: 'btn small ghost danger', onclick: async () => {
        if (!confirm(`Remove ${it.symbol} from the watchlist?`)) return;
        await ctx.api('DELETE', `/api/watchlist?symbol=${encodeURIComponent(it.symbol)}&exchange=${encodeURIComponent(it.exchange)}`);
        toast('Removed'); ctx.rerender();
      } }, 'Remove from watchlist'))));
}

export async function renderWatchlist(view, ctx) {
  const { api } = ctx;
  const [wl, pos] = await Promise.all([api('GET', '/api/watchlist'), api('GET', '/api/positions')]);
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const cat = params.get('cat') || 'all';
  const cash = ['USD', 'CAD'].map((c) => ({ c, t: pos.totals[c] }));
  const cashLine = cash.map(({ c, t }) => (t.cash == null ? `${c}: not recorded` : `${c}: ${fmt.money(t.cash, c)}${t.cashConfirmed ? '' : ' (unconfirmed)'}`)).join(' · ');
  const anyCash = cash.some(({ t }) => t.cash > 0 && t.cashConfirmed);

  const tabs = h('div', { class: 'tabs' },
    h('button', { class: `tab ${cat === 'all' ? 'active' : ''}`, onclick: () => { location.hash = '#/watchlist'; } }, `All (${wl.items.length})`),
    wl.categories.map((c) => {
      const n = wl.items.filter((i) => i.category === c.id).length;
      return n ? h('button', { class: `tab ${cat === c.id ? 'active' : ''}`, onclick: () => { location.hash = `#/watchlist?cat=${c.id}`; } }, `${c.label} (${n})`) : null;
    }));

  const groups = wl.categories.filter((c) => cat === 'all' || c.id === cat).map((c) => {
    const items = wl.items.filter((i) => i.category === c.id);
    if (!items.length) return null;
    return h('div', {}, h('div', { class: 'section-head' }, h('h2', {}, c.label), h('span', { class: 'muted small' }, `${items.length} candidates`)), h('div', { class: 'wl-grid' }, items.map((i) => card(i, ctx))));
  });
  const others = wl.items.filter((i) => !wl.categories.some((c) => c.id === i.category));
  if (others.length && cat === 'all') groups.push(h('div', {}, h('div', { class: 'section-head' }, h('h2', {}, 'Other')), h('div', { class: 'wl-grid' }, others.map((i) => card(i, ctx)))));

  mount(view, h('div', { class: 'stack' },
    notice('info', h('strong', {}, 'Research candidates, not buy recommendations. '),
      'Each company is here because of its role in AI infrastructure. Watchlist membership says nothing about whether the price is attractive. Descriptions come from official company sources with links and review dates.'),
    section('What current cash allows',
      h('p', {}, cashLine),
      anyCash ? h('p', { class: 'small muted' }, 'Any purchase would need to fit within the confirmed cash above and your risk limits. Possible future purchases that would need new money are kept separate and are not suggested.')
        : h('p', { class: 'small' }, 'No confirmed available cash. Nothing on this list is actionable without adding money or selling something, and Signal Desk does not assume either. Confirm cash under Positions → Cash balances.')),
    h('div', { class: 'spread' }, tabs, h('button', { class: 'btn small', onclick: () => addForm(ctx, wl) }, '+ Add company')),
    groups));
}

function addForm(ctx, wl) {
  const form = h('form', { class: 'stack' },
    h('div', { class: 'form-grid' },
      field('Symbol', h('input', { name: 'symbol', required: true })),
      field('Exchange', select('exchange', [['NASDAQ', 'NASDAQ'], ['NYSE', 'NYSE'], ['NYSE Arca', 'NYSE Arca'], ['TSX', 'TSX'], ['TSXV', 'TSX Venture'], ['Cboe Canada', 'Cboe Canada']], 'NASDAQ')),
      field('Category', select('category', wl.categories.map((c) => [c.id, c.label]), wl.categories[0].id))),
    field('Why you are watching it', h('input', { name: 'note' })),
    h('p', { class: 'small muted' }, 'Add a description from the company’s official site afterwards so the one-line summary appears on the card.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add')));
  const d = drawer('Add to AI watchlist', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await ctx.api('POST', '/api/watchlist', formData(form)); toast('Added'); d.close(); ctx.rerender(); } catch (err) { toast(err.message, 'error'); }
  });
}
