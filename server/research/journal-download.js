// The prospective journal's bounded downloader (PROSPECTIVE-1.md section 4.7; the owner's requirement of
// 2026-11-06). Through HXR's Alpaca client only (server/hxr/source.js: data.alpaca.markets, redirects refused,
// keys never printed): basket A daily bars, splits and cash dividends, from 2026-10-23 forward only. It refuses any
// other symbol and any earlier date before a request is made, and it never calls HXR's full download (which
// re-downloads from 2016). Other corporate-action types (stock dividends, spin-offs, mergers, name changes) are
// returned separately so that the journal pauses on them instead of mis-pricing a position.
export const HANDLED_ACTION_TYPES = ['forward_split', 'reverse_split', 'cash_dividend'];

export class DownloadRefused extends Error {}

export function createJournalDownloader({ source, symbols, forwardFrom }) {
  if (!source) throw new Error('the journal downloader needs an Alpaca source');
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('the journal downloader needs the basket symbols');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(forwardFrom || '')) throw new Error('the journal downloader needs forwardFrom (YYYY-MM-DD)');
  const allowed = new Set(symbols);
  const check = (symbol, from, to) => {
    if (!allowed.has(symbol)) throw new DownloadRefused(`the journal downloads basket A only: ${symbol} is refused`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new DownloadRefused('the journal downloader needs from and to dates');
    if (from < forwardFrom) throw new DownloadRefused(`the journal downloads from ${forwardFrom} forward only: ${from} is refused (no closed-window or earlier bar is downloaded)`);
    if (to < from) throw new DownloadRefused(`to ${to} is before from ${from}`);
  };
  return {
    forwardFrom,
    symbols: [...symbols],
    async dailyBars(symbol, { from, to }) {
      check(symbol, from, to);
      return source.dailyBars(symbol, { from, to });
    },
    // Corporate actions for basket A with an ex-date on or after forwardFrom (the request asks only for that window;
    // rows outside it are dropped locally as well).
    async corporateActions() {
      const rows = await source.corporateActions(symbols, { start: forwardFrom });
      const mine = rows.filter((a) => allowed.has(a.symbol) && a.ex_date && a.ex_date >= forwardFrom);
      return { handled: mine.filter((a) => HANDLED_ACTION_TYPES.includes(a.type)), unhandled: mine.filter((a) => !HANDLED_ACTION_TYPES.includes(a.type)) };
    },
  };
}
