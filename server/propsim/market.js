// The stand-in market (CAMPAIGN-1.md sections 2 and 3): 1-minute regular-session bars converted to futures points at a
// fixed ratio and to integer ticks, 5-minute bars built from them in windows from 09:30, the levels of each session
// (the previous session's high and low, the previous calendar week's high and low) and the ATR of the last 14 completed
// 5-minute bars. A pure function of the bar rows: no clock, no database.
import { regularSessionBounds } from '../calendar.js';

const MIN = 60000;
export function isoWeekKey(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  const monday = new Date(d.getTime() - day * 86400000);
  return monday.toISOString().slice(0, 10);
}

// rows: [{ date, minute (minutes after midnight New York), o, h, l, c, v }] sorted by date and minute.
export function buildMarket(rows, { ratio, tickPoints = 0.25 }) {
  const toTick = (x) => Math.round((x * ratio) / tickPoints);
  const byDate = new Map();
  for (const r of rows) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  const sessions = [];
  for (const [date, list] of byDate) {
    const b = regularSessionBounds(date);
    if (!b) continue;
    const open = new Date(b.open).getTime(), close = new Date(b.close).getTime();
    const m1 = [];
    for (const r of list) {
      const s = open + (r.minute - 570) * MIN;
      if (s < open || s >= close) continue;
      m1.push({ s, e: s + MIN, minute: r.minute, o: toTick(r.o), h: toTick(r.h), l: toTick(r.l), c: toTick(r.c), v: r.v ?? 0 });
    }
    if (!m1.length) continue;
    const m5 = [];
    for (const x of m1) {
      const k = Math.floor((x.minute - 570) / 5);
      const last = m5.at(-1);
      if (last && last.k === k) { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; last.v += x.v; last.lastMin = x.minute; }
      else m5.push({ k, s: open + k * 5 * MIN, e: Math.min(open + (k + 1) * 5 * MIN, close), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, firstMin: x.minute, lastMin: x.minute });
    }
    sessions.push({ date, open, close, m1, m5, hi: Math.max(...m1.map((x) => x.h)), lo: Math.min(...m1.map((x) => x.l)), lastClose: m1.at(-1).c });
  }
  sessions.sort((a, b) => (a.date < b.date ? -1 : 1));
  // Levels: the previous session's high and low; the previous calendar week's high and low.
  const weekHiLo = new Map();
  for (const s of sessions) { const w = isoWeekKey(s.date); const x = weekHiLo.get(w) || { hi: -Infinity, lo: Infinity }; x.hi = Math.max(x.hi, s.hi); x.lo = Math.min(x.lo, s.lo); weekHiLo.set(w, x); }
  const weeks = [...weekHiLo.keys()].sort();
  sessions.forEach((s, i) => {
    const prev = sessions[i - 1];
    const w = isoWeekKey(s.date), wi = weeks.indexOf(w);
    const pw = wi > 0 ? weekHiLo.get(weeks[wi - 1]) : null;
    s.levels = { PDH: prev ? prev.hi : null, PDL: prev ? prev.lo : null, PWH: pw ? pw.hi : null, PWL: pw ? pw.lo : null };
    s.prevClose = prev ? prev.lastClose : null;
  });
  // ATR at the close of each 5-minute bar: the mean high-low range of the last 14 completed bars, across sessions.
  const ring = [];
  for (const s of sessions) for (const b of s.m5) { ring.push(b.h - b.l); if (ring.length > 14) ring.shift(); b.atr = ring.reduce((x, y) => x + y, 0) / ring.length; }
  return { sessions, index: new Map(sessions.map((s, i) => [s.date, i])), ratio, tickPoints };
}

export const dataHashInput = (rows) => rows.length ? `${rows.length}|${rows[0].date}|${rows.at(-1).date}` : '0';
