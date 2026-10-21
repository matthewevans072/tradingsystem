import { h, mount, fmt, section, notice, empty, badge, extLink, toast, actionChip, drawer, loading, errorState } from '../lib/ui.js';

const KIND = { premarket: 'Premarket · 9:15', first_hour: 'First hour · 10:30', pre_close: 'Before close', manual: 'On demand' };
const STATUS = { ok: ['Complete', 'ok'], partial: ['Partial data', 'warn'], failed: ['Failed', 'danger'], missed: ['Missed', 'danger'], running: ['Running', 'info'], scheduled: ['Scheduled', ''], pending: ['Due', 'info'] };

function statusBadge(s) {
  const [l, k] = STATUS[s] || [s, ''];
  return badge(l, k);
}

export function renderBriefing(b) {
  const c = b.content;
  if (!c) return h('div', {}, notice(b.status === 'missed' ? 'warn' : 'danger', b.error || 'This briefing has no content.'));
  return h('div', { class: 'report stack', style: { gap: '12px' } },
    c.isDemo ? notice('warn', 'DEMO DATA — not your portfolio.') : null,
    h('div', { class: 'row' }, statusBadge(b.status), h('span', { class: 'muted small' }, `Generated ${fmt.et(c.generatedAt)} · scheduled ${b.scheduled_for ? fmt.et(b.scheduled_for) : 'on demand'}`)),
    c.narrative && !c.narrative.error ? h('div', { class: 'narrative' }, h('div', { class: 'headline' }, c.narrative.headline), h('div', {}, c.narrative.summary),
      c.narrative.watchFor?.length ? h('ul', { class: 'bullets' }, c.narrative.watchFor.map((x) => h('li', {}, x))) : null,
      h('div', { class: 'small muted' }, c.narrative.label)) : null,
    c.narrative?.error ? notice('warn', `AI summary unavailable: ${c.narrative.error}`) : null,
    h('div', { class: 'row small' }, ['USD', 'CAD'].filter((k) => c.portfolioSummary[k]?.marketValue).map((k) => {
      const t = c.portfolioSummary[k];
      return badge(`${k} ${fmt.money(t.marketValue)} · today ${fmt.signedMoney(t.dailyPL)} (${fmt.pct(t.dailyPct)})`);
    })),
    c.sections.map((s) => h('div', {},
      h('h4', {}, s.heading),
      s.note ? h('div', { class: 'small muted' }, s.note) : null,
      s.items.length ? s.items.map((it) => h('div', { class: 'item' },
        h('div', {}, it.action ? [actionChip(it.action), ' '] : null, it.url ? extLink(it.url, it.text) : it.text,
          it.status ? [' ', badge(it.status, it.status === 'confirmed' ? 'ok' : it.status === 'unconfirmed' ? 'warn' : it.status === 'conflicting' ? 'danger' : '')] : null),
        it.source || it.at ? h('div', { class: 'detail' }, [it.source, it.at ? fmt.et(it.at) : null].filter(Boolean).join(' · ')) : null,
        it.detail ? h('div', { class: 'detail' }, it.detail) : null,
        it.reaction ? h('div', { class: 'detail' }, `Observed: ${fmt.pct(it.reaction.pct)} (${it.reaction.method}). ${it.reaction.caveat}`) : null,
        it.analysis ? h('div', { class: 'detail' }, h('em', {}, 'AI interpretation: '), it.analysis.whyItMatters) : null)) : s.note ? null : h('div', { class: 'muted small' }, 'Nothing to report.'))),
    c.dataIssues.length || c.portfolioSummary.limitations?.length ? h('div', {}, h('h4', {}, 'Data limitations'),
      notice('warn', h('ul', {}, [...c.dataIssues, ...(c.portfolioSummary.limitations || [])].map((d) => h('li', {}, d))))) : null,
    b.deliveries?.length ? h('div', {}, h('h4', {}, 'Delivery'), h('div', { class: 'row' }, b.deliveries.map((d) => badge(`${d.channel}: ${d.status}${d.detail ? ' — ' + d.detail : ''}`, d.status === 'sent' ? 'ok' : d.status === 'failed' ? 'danger' : '')))) : null);
}

async function openReport(ctx, id) {
  const d = drawer('Briefing', loading(), { wide: true });
  try {
    const b = await ctx.api('GET', `/api/briefings/${id}`);
    document.querySelector('.drawer-head h2').textContent = b.title || 'Briefing';
    mount(d.body, renderBriefing(b));
  } catch (e) {
    mount(d.body, errorState(e));
  }
}

export async function renderReports(view, ctx) {
  const { api } = ctx;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = params.get('q') || '';
  const kind = params.get('kind') || '';
  const [list, status] = await Promise.all([api('GET', `/api/briefings?q=${encodeURIComponent(q)}&kind=${kind}`), api('GET', '/api/status')]);
  const sch = status.scheduler;

  const search = h('form', { class: 'row', style: { flex: 1 } },
    h('input', { name: 'q', value: q, placeholder: 'Search briefings (ticker, word, date)…', style: { maxWidth: '360px' } }),
    h('select', { name: 'kind', style: { maxWidth: '200px' } }, [['', 'All types'], ...Object.entries(KIND)].map(([v, l]) => h('option', { value: v, selected: v === kind ? true : null }, l))),
    h('button', { class: 'btn', type: 'submit' }, 'Search'));
  search.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(search);
    location.hash = `#/reports?q=${encodeURIComponent(f.get('q'))}&kind=${f.get('kind')}`;
  });

  const runBtn = (k, label) => {
    const b = h('button', { class: 'btn small' }, label);
    b.addEventListener('click', async () => {
      b.disabled = true; mount(b, 'Generating…');
      try {
        const r = await api('POST', '/api/briefings/run', { kind: k });
        toast(`Briefing ${r.status}`); openReport(ctx, r.id); ctx.rerender();
      } catch (e) { toast(e.message, 'error'); b.disabled = false; mount(b, label); }
    });
    return b;
  };

  const schedule = section('Schedule',
    sch?.enabled ? h('div', { class: 'stack', style: { gap: '10px' } },
      h('p', { class: 'small' }, 'Briefings run at 9:15 a.m., 10:30 a.m. and one hour before the regular close (3:00 p.m., or noon on 1:00 p.m. early-close days), New York time, on NYSE trading days only.'),
      h('div', { class: 'list' }, sch.slots.map((s) => h('div', { class: 'list-item spread' },
        h('div', {}, h('strong', {}, s.label), h('div', { class: 'small muted' }, `${fmt.date(s.date)} · ${fmt.et(s.at, { date: false })}${s.earlyClose ? ' (early close)' : ''}`)),
        h('div', { class: 'row' }, statusBadge(s.status), s.id ? h('button', { class: 'btn small ghost', onclick: () => openReport(ctx, s.id) }, 'Open') : null)))),
      sch.resumes?.length ? notice('warn', `Computer sleep/wake detected: ${sch.resumes.map((r) => `${fmt.et(r.at)} after ${r.gapMinutes} min`).join('; ')}. Slots missed by more than ${sch.graceMinutes} minutes are marked missed, not sent late.`) : null,
      h('div', { class: 'small muted' }, `Scheduler last checked ${fmt.ago(sch.lastTick)}. Retries up to ${sch.maxAttempts} times within ${sch.graceMinutes} minutes of each slot.`),
      notice('info', 'Signal Desk runs on your computer: scheduled briefings and alerts only happen while it is running, awake and online. Existing ChatGPT scheduled tasks are separate and are not affected.')) :
      notice('warn', sch?.reason || 'Scheduler is off.'),
    h('div', { class: 'row mt' }, runBtn('premarket', 'Run premarket now'), runBtn('first_hour', 'Run first-hour now'), runBtn('pre_close', 'Run before-close now'), runBtn('manual', 'On-demand briefing')),
    h('p', { class: 'small muted' }, 'On-demand runs are saved to the archive but are not emailed, and they never replace a scheduled slot.'));

  const rows = list.length ? h('div', { class: 'list' }, list.map((b) => h('div', { class: 'list-item', style: { cursor: 'pointer' }, onclick: () => openReport(ctx, b.id) },
    h('div', { class: 'spread' }, h('strong', {}, b.title), h('div', { class: 'row' }, b.is_demo ? badge('Demo', 'warn') : null, statusBadge(b.status))),
    h('div', { class: 'meta' }, h('span', {}, KIND[b.kind] || b.kind), h('span', {}, b.generated_at ? `Generated ${fmt.et(b.generated_at)}` : `Scheduled ${fmt.et(b.scheduled_for)}`), b.attempts > 1 ? h('span', {}, `${b.attempts} attempts`) : null),
    b.error ? h('div', { class: 'small neg' }, b.error) : null))) :
    empty(q ? 'No briefings match your search' : 'No briefings yet', q ? null : 'Scheduled briefings appear here once Signal Desk has run through a trading day. You can also run one now.');

  mount(view, h('div', { class: 'grid main-side' },
    section('Briefing archive', h('div', { class: 'spread' }, search), h('div', { class: 'mt' }, rows)),
    schedule));

  const id = params.get('id');
  if (id) openReport(ctx, Number(id));
}
