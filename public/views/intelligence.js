import { h, mount, fmt, section, notice, empty, badge, extLink, toast, field, select, formData } from '../lib/ui.js';

const STATUS = {
  confirmed: ['Confirmed (primary source)', 'ok'],
  reported: ['Reported by media', 'info'],
  unconfirmed: ['Unconfirmed', 'warn'],
  conflicting: ['Conflicting reports', 'danger'],
};
const SOURCE_TYPE = { filing: 'Regulatory filing', ir: 'Investor relations', press_release: 'Company press release', media: 'Financial media', other: 'Other source' };

function newsCard(n) {
  const [label, kind] = STATUS[n.status] || [n.status, ''];
  const a = n.analysis;
  return h('div', { class: 'news-card' },
    h('div', { class: 'news-title' }, n.url ? extLink(n.url, n.title) : n.title),
    h('div', { class: 'meta', style: { marginTop: '4px' } },
      badge(label, kind), badge(SOURCE_TYPE[n.source_type] || n.source_type),
      n.importance >= 3 ? badge('Material', 'warn') : null,
      n.affectsHoldings?.length ? badge(`Affects: ${n.affectsHoldings.join(', ')}`, 'info') : n.symbols.length ? h('span', {}, n.symbols.join(', ')) : null,
      h('span', {}, n.source_name || n.provider),
      h('span', {}, `Published ${fmt.et(n.published_at)}`),
      n.event_at ? h('span', {}, `Event date ${n.event_at}`) : null,
      n.related?.length ? h('span', {}, `+${n.related.length} similar report(s) grouped`) : null),
    n.summary ? h('p', { class: 'small', style: { marginTop: '6px', color: 'var(--text-2)' } }, n.summary.length > 400 ? n.summary.slice(0, 400) + '…' : n.summary) : null,
    n.reaction ? h('div', { class: 'small', style: { marginTop: '4px' } }, h('strong', {}, 'Observed price move: '), `${fmt.pct(n.reaction.pct)} (${n.reaction.method}). `, h('span', { class: 'muted' }, n.reaction.caveat)) : null,
    a ? h('div', { class: 'news-analysis' },
      h('div', { class: 'small muted' }, a.label),
      h('h5', {}, 'What happened'), h('div', {}, a.whatHappened),
      a.confirmedFacts?.length ? [h('h5', {}, 'Confirmed facts'), h('ul', { class: 'bullets' }, a.confirmedFacts.map((x) => h('li', {}, x)))] : null,
      h('h5', {}, 'Why it could matter (interpretation)'), h('div', {}, a.whyItMatters),
      a.implications?.length ? [h('h5', {}, 'Possible implications'), h('ul', { class: 'bullets' }, a.implications.map((x) => h('li', {}, x)))] : null,
      a.competingExplanations?.length ? [h('h5', {}, 'Competing explanations'), h('ul', { class: 'bullets' }, a.competingExplanations.map((x) => h('li', {}, x)))] : null,
      a.expectationsComparison ? [h('h5', {}, 'Versus expectations'), h('div', {}, a.expectationsComparison)] : null) : null,
    n.related?.length ? h('details', { class: 'more' }, h('summary', {}, 'Other coverage of this story'),
      h('ul', { class: 'bullets small' }, n.related.map((r) => h('li', {}, extLink(r.url, r.title), ` — ${r.source_name || ''}, ${fmt.et(r.published_at)}`)))) : null);
}

export async function renderIntelligence(view, ctx) {
  const { api } = ctx;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const scope = params.get('scope') || 'holdings';
  const [news, events, status] = await Promise.all([api('GET', '/api/news?limit=120'), api('GET', '/api/events'), api('GET', '/api/status')]);
  const filtered = scope === 'holdings' ? news.filter((n) => n.affectsHoldings.length) : scope === 'material' ? news.filter((n) => n.importance >= 3) : news;

  const sourcesConfigured = status.config.configured.finnhub || status.config.configured.secEdgar;
  const tabs = h('div', { class: 'tabs' }, [['holdings', 'My holdings'], ['material', 'Material only'], ['all', 'Everything']].map(([k, l]) =>
    h('button', { class: `tab ${scope === k ? 'active' : ''}`, onclick: () => { location.hash = `#/intelligence?scope=${k}`; } }, l)));

  const refresh = h('button', { class: 'btn small', onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { const r = await api('POST', '/api/refresh', { what: 'news' }); toast(`News: ${r.news.inserted} new, ${r.news.duplicates} duplicates skipped${r.news.errors.length ? `, ${r.news.errors.length} source errors` : ''}`); ctx.rerender(); } catch (err) { toast(err.message, 'error'); }
  } }, 'Check for news now');

  const newsSection = section('News & filings',
    h('div', { class: 'spread' }, tabs, refresh),
    !sourcesConfigured ? notice('warn', 'No news sources are connected yet. Add a Finnhub key (company news) and an SEC contact email (official filings) in .env — see Settings → Data providers. Nothing is shown until real sources are connected.') : null,
    notice('info', 'Items are labelled by source: filings and company releases are primary sources; media reports are shown as reported; rumours are marked unconfirmed. Retrieved text is displayed as data only. A price move next to a headline is an observation, not proof of cause.'),
    filtered.length ? h('div', {}, filtered.map(newsCard)) : empty(scope === 'holdings' ? 'No recent news for your holdings' : 'No news stored', sourcesConfigured ? 'Nothing material has been retrieved from the configured sources in this window.' : 'Connect a news source to begin.'));

  const today = new Date().toISOString().slice(0, 10);
  const eventForm = h('form', { class: 'stack', style: { gap: '8px' } },
    h('div', { class: 'form-grid' },
      field('Date', h('input', { name: 'date', type: 'date', required: true, value: today })),
      field('Event', h('input', { name: 'title', required: true, placeholder: 'e.g. US CPI release, FOMC decision' }))),
    field('Source link (optional)', h('input', { name: 'source_url', type: 'url' })),
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'submit' }, 'Add scheduled event')));
  eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/events', { ...formData(eventForm), type: 'macro' }); toast('Event added'); ctx.rerender(); } catch (err) { toast(err.message, 'error'); }
  });

  const evSection = section('Earnings & scheduled catalysts',
    events.length ? h('div', { class: 'list' }, events.slice(0, 40).map((e) => h('div', { class: 'list-item' },
      h('div', { class: 'spread' }, h('strong', {}, e.type === 'earnings' ? `${e.symbol} earnings` : e.title), h('span', { class: 'num' }, fmt.date(e.date))),
      h('div', { class: 'meta' },
        e.time_hint && e.time_hint !== 'unknown' ? badge(e.time_hint === 'bmo' ? 'Before open' : e.time_hint === 'amc' ? 'After close' : 'During market') : null,
        e.details?.epsEstimate != null ? h('span', {}, `EPS estimate ${e.details.epsEstimate} (provider consensus)`) : null,
        e.type === 'split' ? badge('Review split', 'warn') : null,
        h('span', {}, e.source),
        e.source === 'Entered manually' ? h('button', { class: 'btn small ghost', onclick: async () => { await api('DELETE', `/api/events/${e.id}`); ctx.rerender(); } }, 'Remove') : null)))) :
      h('p', { class: 'muted' }, 'No upcoming events stored. Earnings dates come from your market-data provider once connected.'),
    h('p', { class: 'small muted' }, 'Results are compared with expectations only where the provider supplies consensus estimates. A beat alone is never treated as a buy signal.'),
    h('h4', { class: 'card-title mt' }, 'Add a macro or company event'), eventForm);

  mount(view, h('div', { class: 'grid main-side' }, newsSection, evSection));
}
