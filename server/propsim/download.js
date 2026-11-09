// prop-sim's bounded download (DATA-INVENTORY.md section 2): QQQ and SPY 1-minute bars of the regular session,
// 2018-06-01 to 2022-12-30, month by month through server/hxr/source.js (Alpaca SIP raw; one host, redirects refused).
// A request past 2022-12-30 is refused before it is sent; the store refuses any later bar. Keys are never printed.
import { regularSessionBounds, isTradingDay } from '../calendar.js';
import { FROM, MAX_DATE, assertInBound } from './config.js';
import * as store from './store.js';

const monthsBetween = (from, to) => {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (;;) {
    const a = `${y}-${String(m).padStart(2, '0')}-01`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const s = a < from ? from : a, e = last > to ? to : last;
    if (s > to) break;
    out.push([s, e]);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
};

export async function downloadBars({ db, src, symbols, from = FROM, to = MAX_DATE, clock = () => new Date(), log = () => {} }) {
  assertInBound(from, 'download start'); assertInBound(to, 'download end');
  const out = {};
  for (const sym of symbols) {
    const startedAt = clock().toISOString();
    const have = new Set(store.barDates(db, sym));
    let kept = 0, stored = 0, dropped = 0;
    for (const [a, b] of monthsBetween(from, to)) {
      const dates = [];
      for (let d = a; d <= b; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) if (isTradingDay(d, 'NYSE')) dates.push(d);
      if (dates.length && dates.every((d) => have.has(d))) continue;
      assertInBound(b, 'request end');
      const bars = await src.intradayBars(sym, '1Min', { from: a, to: b });
      const rows = [];
      for (const x of bars) {
        if (x.date > MAX_DATE) throw new Error(`Alpaca returned a bar dated ${x.date}, after the bound`);
        const bnd = regularSessionBounds(x.date);
        if (!bnd || x.ms < new Date(bnd.open).getTime() || x.ms >= new Date(bnd.close).getTime()) { dropped++; continue; }
        rows.push({ date: x.date, minute: x.minutes, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v });
      }
      kept += rows.length;
      stored += store.insertBars(db, sym, rows);
    }
    store.insertDownload(db, { symbol: sym, from, to, startedAt, finishedAt: clock().toISOString(), status: 'complete', summary: { kept, stored, droppedOutsideRegular: dropped } });
    log(`${sym}: 1-minute bars kept ${kept}, newly stored ${stored}`);
    out[sym] = { kept, stored };
  }
  return out;
}
