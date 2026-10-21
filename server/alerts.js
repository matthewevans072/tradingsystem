// Continuous-monitoring alerts. Evaluated by the monitor loop after each quote
// refresh (separate from the three scheduled briefings). Each alert has a
// dedupe key so the same condition fires once per day/level, and quiet hours
// suppress outbound delivery (alerts still appear in the app).
import { getSetting, nowIso } from './db.js';
import { deliver } from './delivery.js';
import { zonedParts, todayIn, addDays, NY } from './time.js';

export const ALERT_TYPES = {
  price_above: { label: 'Price at or above', params: ['price'] },
  price_below: { label: 'Price at or below', params: ['price'] },
  pct_move: { label: 'Daily move beyond ±%', params: ['pct'] },
  near_high: { label: 'Within % of the session high observed so far', params: ['pct'] },
  near_low: { label: 'Within % of the session low observed so far', params: ['pct'] },
  volume_spike: { label: 'Volume ≥ multiple of average', params: ['multiple'] },
  earnings_soon: { label: 'Earnings within N days', params: ['days'] },
  news_material: { label: 'Material news or filing', params: [] },
  concentration: { label: 'Position weight above %', params: ['pct'] },
  drawdown: { label: 'Position down more than % from average cost', params: ['pct'] },
};

export const DEFAULT_ALERT_SETTINGS = {
  quietHours: { enabled: true, start: '21:00', end: '07:30' }, // America/New_York
  defaults: { pct_move: 5, near_high: 0.5, near_low: 0.5, volume_spike: 2, earnings_soon: 3, concentration: 25, drawdown: 15, news_material: true },
};

export function alertSettings(db) {
  const s = getSetting(db, 'alerts', DEFAULT_ALERT_SETTINGS);
  return { ...DEFAULT_ALERT_SETTINGS, ...s, defaults: { ...DEFAULT_ALERT_SETTINGS.defaults, ...(s.defaults || {}) } };
}

export function inQuietHours(settings, now = new Date()) {
  const q = settings.quietHours;
  if (!q?.enabled) return false;
  const m = zonedParts(now, NY).minutes;
  const toMin = (s) => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; };
  const a = toMin(q.start), b = toMin(q.end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

function candidateAlerts(ctx, portfolio, now) {
  const { db } = ctx;
  const st = alertSettings(db);
  const d = st.defaults;
  const today = todayIn(NY, now);
  const out = [];
  const rules = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1').all();
  for (const p of portfolio.positions) {
    const q = p.quote;
    const fresh = q && q.price != null && q.freshness === 'fresh';
    const tag = `${p.symbol}`;
    if (fresh && q.changePct != null && d.pct_move && Math.abs(q.changePct) >= d.pct_move) {
      const lvl = Math.floor(Math.abs(q.changePct) / d.pct_move);
      out.push({ key: `pct_move:${p.instrument_id}:${today}:${lvl}`, severity: Math.abs(q.changePct) >= 2 * d.pct_move ? 'high' : 'warn', instrument_id: p.instrument_id,
        title: `${tag} ${q.changePct > 0 ? 'up' : 'down'} ${Math.abs(q.changePct).toFixed(1)}% today`,
        message: `Last ${q.price} ${p.currency} vs previous close ${q.prevClose} (${q.provider}, ${q.timeliness}).`, asOf: q.quoteTime });
    }
    if (fresh && q.session === 'regular' && q.high != null && q.low != null) {
      if (d.near_high && q.price >= q.high * (1 - d.near_high / 100)) {
        out.push({ key: `near_high:${p.instrument_id}:${today}`, severity: 'info', instrument_id: p.instrument_id,
          title: `${tag} near today's high so far (${q.high})`,
          message: `Price ${q.price} is within ${d.near_high}% of the highest price observed so far this session. This is not a prediction that the session high is in.`, asOf: q.quoteTime });
      }
      if (d.near_low && q.price <= q.low * (1 + d.near_low / 100)) {
        out.push({ key: `near_low:${p.instrument_id}:${today}`, severity: 'warn', instrument_id: p.instrument_id,
          title: `${tag} near today's low so far (${q.low})`,
          message: `Price ${q.price} is within ${d.near_low}% of the lowest price observed so far this session. This is not a prediction that the session low is in.`, asOf: q.quoteTime });
      }
    }
    if (fresh && d.volume_spike && q.volume != null && q.avgVolume) {
      if (q.volume >= d.volume_spike * q.avgVolume) {
        out.push({ key: `volume:${p.instrument_id}:${today}`, severity: 'info', instrument_id: p.instrument_id,
          title: `${tag} volume ${(q.volume / q.avgVolume).toFixed(1)}× average`,
          message: `Volume so far ${Math.round(q.volume).toLocaleString()} vs average ${Math.round(q.avgVolume).toLocaleString()} (${q.provider}).`, asOf: q.quoteTime });
      }
    }
    const w = p.weightPct ?? p.weightInCurrencyPct;
    if (d.concentration && w != null && w > d.concentration) {
      out.push({ key: `concentration:${p.instrument_id}:${today}`, severity: 'warn', instrument_id: p.instrument_id,
        title: `${tag} is ${w}% of the portfolio`, message: `Above your ${d.concentration}% concentration threshold.`, asOf: q?.quoteTime });
    }
    if (d.drawdown && p.unrealizedPct != null && p.unrealizedPct <= -d.drawdown) {
      out.push({ key: `drawdown:${p.instrument_id}:${Math.floor(-p.unrealizedPct / d.drawdown)}`, severity: 'warn', instrument_id: p.instrument_id,
        title: `${tag} down ${Math.abs(p.unrealizedPct)}% from average cost`, message: `Threshold ${d.drawdown}%. Review the position's invalidation level rather than waiting to get back to entry.`, asOf: q?.quoteTime });
    }
  }
  if (d.earnings_soon) {
    const held = new Set(portfolio.positions.map((p) => p.symbol));
    for (const e of db.prepare("SELECT * FROM events WHERE type = 'earnings' AND date >= ? AND date <= ?").all(today, addDays(today, d.earnings_soon))) {
      if (!held.has(e.symbol)) continue;
      out.push({ key: `earnings:${e.symbol}:${e.date}`, severity: 'info', title: `${e.symbol} reports earnings ${e.date}${e.time_hint && e.time_hint !== 'unknown' ? ' (' + e.time_hint.toUpperCase() + ')' : ''}`,
        message: `Source: ${e.source}. Results can gap the price overnight.`, asOf: e.fetched_at });
    }
  }
  if (d.news_material) {
    const held = new Set(portfolio.positions.map((p) => p.symbol));
    for (const n of db.prepare('SELECT * FROM news WHERE importance >= 3 AND fetched_at >= ?').all(new Date(now - 6 * 3600000).toISOString())) {
      const syms = JSON.parse(n.symbols_json).filter((s) => held.has(s));
      if (!syms.length) continue;
      out.push({ key: `news:${n.cluster_key || n.dedupe_key}`, severity: 'warn', title: `${syms.join(', ')}: ${n.title}`.slice(0, 200),
        message: `${n.source_name || n.provider} · ${n.status}${n.url ? ' · ' + n.url : ''}`, asOf: n.published_at });
    }
  }
  // User-defined price rules.
  for (const r of rules) {
    const p = portfolio.positions.find((x) => x.instrument_id === r.instrument_id);
    const q = p?.quote;
    if (!q || q.freshness !== 'fresh') continue;
    const prm = JSON.parse(r.params_json);
    if (r.type === 'price_above' && q.price >= prm.price) out.push({ key: `rule:${r.id}:${today}`, severity: 'warn', instrument_id: r.instrument_id, title: `${p.symbol} at/above ${prm.price}`, message: `Last ${q.price} (${q.provider}).`, asOf: q.quoteTime });
    if (r.type === 'price_below' && q.price <= prm.price) out.push({ key: `rule:${r.id}:${today}`, severity: 'warn', instrument_id: r.instrument_id, title: `${p.symbol} at/below ${prm.price}`, message: `Last ${q.price} (${q.provider}).`, asOf: q.quoteTime });
  }
  return out;
}

export async function evaluateAlerts(ctx, portfolio, { now = new Date() } = {}) {
  const { db } = ctx;
  const st = alertSettings(db);
  const quiet = inQuietHours(st, now);
  const fired = [];
  for (const a of candidateAlerts(ctx, portfolio, now)) {
    const r = db.prepare(`INSERT INTO alerts (instrument_id, dedupe_key, triggered_at, severity, title, message, data_as_of, delivery_status)
                          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
      .run(a.instrument_id ?? null, a.key, nowIso(), a.severity, a.title, a.message, a.asOf ?? null, quiet ? 'quiet_hours' : 'pending');
    if (!r.changes) continue;
    const id = Number(r.lastInsertRowid);
    fired.push({ id, ...a });
    if (quiet) continue;
    const results = await deliver(ctx, { refType: 'alert', refId: id, title: `Signal Desk: ${a.title}`, text: `${a.title}\n\n${a.message}\n\nData as of ${a.asOf || 'n/a'}`, priority: a.severity === 'high' ? 4 : 3 });
    const external = results.filter((x) => x.channel !== 'in_app');
    const status = !external.length ? 'in_app_only' : external.every((x) => x.status === 'sent') ? 'sent' : external.some((x) => x.status === 'failed') ? 'failed' : 'not_configured';
    db.prepare('UPDATE alerts SET delivery_status = ? WHERE id = ?').run(status, id);
  }
  return fired;
}
