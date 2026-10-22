// Suggested questions for the chat panel, based on the page being viewed and
// the user's actual data (biggest mover today, next earnings, selected holding).
import { computePortfolio } from '../portfolio.js';
import { todayIn, addDays, NY } from '../time.js';

export function suggestQuestions(ctx, { page, symbol } = {}) {
  const p = computePortfolio(ctx.db, { catalog: ctx.catalog });
  const out = [];
  const add = (q) => { if (q && !out.includes(q) && out.length < 6) out.push(q); };
  const sym = symbol ? String(symbol).toUpperCase() : null;
  const held = sym && p.positions.find((x) => x.symbol === sym);
  const today = todayIn(NY);
  const nextEarn = ctx.db.prepare("SELECT symbol, date FROM events WHERE type = 'earnings' AND date >= ? AND date <= ? ORDER BY date").all(today, addDays(today, 30))
    .find((e) => p.positions.some((x) => x.symbol === e.symbol));
  const mover = p.positions.filter((x) => x.dailyPL != null).sort((a, b) => Math.abs(b.dailyPL) - Math.abs(a.dailyPL))[0];

  if (sym) {
    if (held) {
      add(`What changed with ${sym} since yesterday?`);
      add(`What is the strongest argument for holding versus trimming ${sym}?`);
      add(`If I sold 20% of my ${sym} position, how much cash would I free up?`);
      add(`What does ${sym} actually do, and how direct is its AI exposure?`);
    } else {
      add(`What does ${sym} actually do?`);
      add(`What are the main risks for ${sym}?`);
      add(`Is there recent news or a filing for ${sym}?`);
    }
  }
  // The Strategy Lab is a simulation; its questions don't depend on real holdings.
  if (page === 'lab') {
    add('How much simulated capital is at risk right now?');
    add('Why did the latest simulated trade trigger, and what ended it?');
    add('Is the backtest result coming from one stock or a broad pattern?');
    add('What does the pre-registered acceptance outcome say, and how many trades is it based on?');
    add('What changed between strategy versions?');
    return out;
  }
  if (!p.positions.length) {
    add('What do I need to set up before you can analyse my portfolio?');
    add('What does NVDA actually do?');
    add('Which watchlist companies are most directly tied to AI data-center spending?');
    return out;
  }
  if (page === 'overview' || !page) {
    // Neutral wording: one position's sign says nothing about the total, and
    // outside market hours the latest session may not be today's.
    add('How did my portfolio move in the latest session, and what drove it?');
    add('Which positions are most exposed to the same risks?');
    add('Which upcoming events should I pay attention to?');
  }
  if (page === 'positions') {
    add('Which positions are most exposed to the same risks?');
    add('Which holdings have stale or missing data right now?');
    if (mover) add(`What changed with ${mover.symbol} since yesterday?`);
  }
  if (page === 'intelligence') {
    add('What material news affects my holdings this week, and is any of it unconfirmed?');
    if (nextEarn) add(`How could ${nextEarn.symbol}'s earnings on ${nextEarn.date} affect my position?`);
    add('Which upcoming events should I pay attention to?');
  }
  if (page === 'watchlist') {
    add('Which watchlist companies are most directly tied to AI data-center spending?');
    add('Which watchlist names overlap most with what I already own?');
    add('What would justify researching a cooling or power company further?');
  }
  if (page === 'reports') {
    add("Summarise the latest briefing and what has changed since it was written.");
    add('How have my assessments changed this week?');
  }
  if (page === 'settings') {
    add('What data is currently missing or stale, and what would fix it?');
  }
  if (nextEarn) add(`How could ${nextEarn.symbol}'s earnings on ${nextEarn.date} affect my position?`);
  add('Which positions are most exposed to the same risks?');
  return out;
}
