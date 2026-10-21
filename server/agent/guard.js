// Trade-claim guard for Ask Signal Desk answers.
//
// Signal Desk cannot trade and the agent cannot save changes, so a sentence
// saying a trade happened or a record changed "for you" is always wrong. Every
// answer field passes through guardText(); sentences that make such a claim are
// replaced with a notice. This is a backstop: the system prompt is the primary
// control, and the agent loop gives the model one chance to rephrase.
//
// A sentence is a claim when it says the assistant/app did it ("I've sold…",
// "Signal Desk placed…"), when something of the owner's is said to have been
// traded or changed ("Your VRT has been sold", "Your order went through",
// "Your USD cash is now 0", "Your alert is now active"), or when it opens with
// a terse confirmation ("Done — sold 10 NBIS", "10 NBIS sold at 101.50",
// "Order placed."). Honest look-alikes are exempt:
// - negations and modals on the claim ("no order has been placed", "I can't sell");
// - hypotheticals introduced earlier in the sentence ("If you sold…", "In scenario S2…");
// - reported speech ("the post claims your shares were sold");
// - quotes attributed earlier in the sentence (a fully quoted sentence is not exempt);
// - dated descriptions of the owner's own records ("you sold 10 VRT on 2026-10-15");
// - market narrative about other people's trading: particles (sold off/short/out,
//   bought back), an agent ("by insiders", not "by 5 shares"), attributions
//   ("per the Form 4", "according to 13F filings"), third-party possessives
//   ("its shares", "Nebius's cash balance"), and nouns without the owner's scope
//   ("Tech shares have been sold for five sessions");
// - descriptions of the assistant's own analysis ("I updated the scenario").

export const REMOVED = '[Removed: a statement claiming a trade or record change. Signal Desk cannot trade, and record changes only happen when you press Confirm.]';

const TRADE_VERBS = 'bought|sold|purchased|placed|executed|submitted|filled|cancell?ed|traded|liquidated|trimmed|exited|shorted|rebalanced|transferred|converted|closed out|closed|topped up|topped it up|picked up|resold|wired|deposited|withdrew';
const RECORD_VERBS = 'saved|recorded|updated|changed|applied|set up|set|added|removed|deleted|entered|logged|modified|adjusted|created|edited|moved|rewrote|rewritten|replaced|revised|cleared|credited|took care of|handled';
const AUX = "have|has|had|just|already|now|also|then|successfully|actually|indeed|went ahead and|gone ahead and|did|not|never|cannot|can't|didn't|haven't|hasn't|hadn't|will|won't|would|could|should|can|might|may|shall|must|am|been";
const ACTOR_RE = new RegExp(`\\b(I|we|Signal Desk|the app)\\b((?:\\s*'(?:ve|d|ll|m)\\b|\\s+(?:${AUX})\\b)*)\\s+(${TRADE_VERBS}|${RECORD_VERBS})\\b`, 'gi');

const PASSIVE_AUX = "(?:(?:has|have|had|been|was|were|is|are|now|already|successfully|just|also|not|never|got|be|will|would|could|being|hasn't|haven't|wasn't|weren't|isn't|aren't)\\s+)+";
const PASSIVE_PRED = 'placed|executed|filled|submitted|sent|completed|complete|done|finali[sz]ed|settled|processed|cancell?ed|sold|bought|purchased|liquidated|trimmed|closed out|closed|reduced|exited|updated|changed|saved|recorded|set up|set|adjusted|modified|added|removed|deleted|logged|created|confirmed|active|gone|moved|credited|deposited|transferred';
const PASSIVE_RE = new RegExp(`((?:[\\w$'.,%&-]+\\s+){0,5}?)\\b(orders?|trades?|sales?|purchases?|transactions?|records?|holdings?|portfolio|cash(?:\\s+balances?)?|balances?|alerts?|positions?|shares|stakes?|thesis|strategy|notes?|proceeds)((?:\\s+(?:of|for|to sell|to buy|at|on|in|below|above|under|over|from)\\s+[^.!?,;\\n]{1,40}?)?)\\s+(${PASSIVE_AUX})(${PASSIVE_PRED})\\b`, 'gi');
// A ticker as the subject: "Your VRT has been sold", "All 15 VRT were sold".
const TICKER_RE = new RegExp(`((?:[\\w$'.,%&-]+\\s+){0,3}?)\\b([A-Z]{2,5})(?:\\s+(?:shares?|position|stake|holding))?\\s+(${PASSIVE_AUX})(sold|bought|purchased|liquidated|trimmed|closed out|closed|exited|gone)\\b`, 'g');
const INTERJECTION = '(?:done|ok|okay|all set|great|sure|confirmed|success|perfect|trade complete|order complete|sale complete|order placed|trade executed)';
const LEAD_RE = new RegExp(`^\\W*(?:${INTERJECTION}\\b\\W*)?(?:(?:just|successfully|already|now)\\s+)?(sold|bought|purchased|placed|executed|submitted|liquidated|trimmed|shorted|filled)\\b(?!-)(?!\\s+(?:off|out|short|back)\\b)`, 'i');
// Subjectless record changes: "Deleted your NBIS alert", "Converted your USD cash…".
const LEAD_RECORD_RE = new RegExp(`^\\W*(?:${INTERJECTION}\\b\\W*)?(deleted|removed|added|created|saved|updated|set|changed|logged|recorded|moved|converted|cleared|credited)\\s+(?:your|the)\\b`, 'i');
const LEAD_TICKER_RE = new RegExp(`^\\W*(?:${INTERJECTION}\\b\\W*)?(?:all\\s+)?(?:\\d[\\d,.]*\\s+)?([A-Za-z]{1,5})\\s+(?:shares?\\s+)?(sold|bought|purchased)\\b(?!-)\\s*(?::|@|at\\b|for\\b|\\d)`, 'i');
const LEAD_NOUN_RE = new RegExp(`^\\W*(?:${INTERJECTION}\\b\\W*)?(?:(?:your|the)\\s+)?(?:(?:sell|buy|limit|market|stop)\\s+)?(?:order|trade|sale|purchase|buy|sell|fill)s?\\s+(?:(?:is|was|has been)\\s+)?(?:now\\s+)?(placed|executed|filled|submitted|sent|completed|complete|done|confirmed|in)\\b(?=\\s*(?:[.!:;,\u2014-]|$|at\\b|for\\b|\\d|and\\b|successfully\\b))`, 'i');
const BEHALF_RE = /\b(sold|bought|purchased|placed|executed|submitted|liquidated|trimmed)\b(?:[^!?\n.]|\.(?=\d)){0,60}?\b(for you|on your behalf)\b/gi;
const WENT_THROUGH_RE = /\b(your|my|the)\b[^.!?\n]{0,30}?\b(order|trade|sale|purchase|sell|buy)s?\b[^.!?\n]{0,40}?\b(went through|has gone through|was successful|succeeded|got filled|is complete|is done)\b/gi;
const ALERT_RE = /\b(your|my|the)\b[^.!?\n]{0,40}?\balerts?\b[^.!?\n]{0,40}?\b(is|are|has been|have been)\s+(?:now\s+)?(active|live|set up|set|in place|enabled|created|added|on)\b(?!\s+to\b)/gi;
const CASH_NOW_RE = /\b(your|my)\b[^.!?\n]{0,30}?\b(cash|balance)\b[^.!?\n]{0,30}?\b(is|are)\s+now\b/gi;

const NEG = /\b(no|not|never|none|nothing|neither|nor|without|cannot|can't|didn't|don't|doesn't|won't|haven't|hasn't|isn't|aren't|wasn't|weren't|unable to)\b/i;
const NEG_MODAL = /\b(not|never|cannot|can't|didn't|haven't|hasn't|hadn't|won't|will|would|could|should|can|might|may|shall|must|am)\b|'(ll|d|m)\b|n't\b/i;
const HYPO = /\b(if|suppose|supposing|assuming|assume|hypothetical(?:ly)?|scenarios?|were to|what if|imagine|for example|for instance|example)\b|\bS\d+\b/i;
const REPORTED = /\b(claims?|claimed|claiming|asserts?|asserted|asserting|says?|said|saying|states?|stated|asks?|asked|asking|tells?|told|telling|instructs?|instructed|instructing|wants?|wanted|demands?|demanded|pretends?|pretending|alleges?|alleged|suggests?|suggested|urges?|urged|reports?|reported|insists?|insisted|writes|wrote|according to|instructions?)\b/i;
const OWN_REPORT = /\b(I|we|you)\s+(?:\w+\s+){0,2}?(claims?|claimed|says?|said|asks?|asked|tells?|told|wants?|wanted|reports?|reported|instructed|wrote)\b/i;
const SOURCE_REPORT = /\b(it|they|(?:the|this|that|a|one) (?:\w+\s+)?(?:post|item|article|update|message|text|note|blog|site|headline|source|story|report|tweet|thread|comment))\s+(?:\w+\s+){0,2}?(claims?|asserts?|says?|asks?|tells?|instructs?|wants?|demands?|urges?|alleges?|suggests?)\b/i;
const ATTRIBUTION = /\b(according to|per (?:the|its|a|their|his|her)\b|per \d|13f|form 4|filings?|press release|reported by)\b/i;
const THIRD_PARTY = /\b(its|their|his|her|[A-Z][\w&.-]*'s)\b/;
const PARTICLE_AFTER = /^[\s-]*(off|out|short|back|up|down|heavily|aggressively|hard|lower|higher|sharply)\b/i;
const AGENT_AFTER = /^\s+(?:[\w,]+\s+){0,4}?by\s+(?!\d|you\b|me\b|us\b|signal desk|the app)[a-z]/i;
const DATED = /\b(\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|in (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|in 20\d\d|yesterday|last (?:week|month|quarter|year)|earlier this (?:week|month|year)|previously)\b|\bby you\b|\byou\s+(?:entered|recorded|added|updated|saved|changed|set|made)\b/i;
const PERFECT = /\b(has|have)\s+(?:\w+\s+)?been\b|\b(now|just|successfully|already)\b/i;
const COMPLETED_PRED = /^(placed|executed|filled|submitted|sent|processed|cancell?ed|complete|completed|done|finali[sz]ed|settled|sold|bought|purchased|trimmed|liquidated|closed out|closed|exited|confirmed|gone)$/i;
const RECORD_PRED = /^(recorded|saved|updated|set|set up|added|created|logged|changed|adjusted|modified|removed|deleted|active|gone|moved|credited|deposited|transferred)$/i;
const ORDER_NOUN = /^(orders?|trades?|sales?|purchases?|transactions?)$/i;
const THE_OK_NOUN = /^(orders?|trades?|sales?|purchases?|transactions?|thesis|strategy|alerts?|proceeds)$/i;
const WORK_PRODUCT = /^\s*(?:\S+\s+){0,5}?(scenarios?|simulations?|calculations?|estimates?|analysis|comparison|figures|numbers|proposals?|proposed|pending|draft|suggest\w*|hypothetical|answer|assumptions?|breakdown|table|chart|context|details|summary|caveats?|question|benchmarks?|bucket|group|category|perspective|same|prices?|quotes?|rates?|inputs?|method|basis|filters?|fees?|approach|weights?|sizes?|briefings?|reports?|assessments?|my (?:view|assessment|answer|estimate|take|opinion|recommendation))\b/i;

// What the verb acts on, read word by word: the owner's records ("your price
// alert", "the cash balance") make it a claim; the assistant's own work ("the
// scenario", "the same price") does not.
const RECORD_NOUN = /^(alerts?|thesis|strategy|cash|balances?|holdings?|records?|transactions?|positions?|orders?|trades?|shares|watchlist|notes?|portfolio|stakes?)$/i;
function workProduct(after) {
  const words = after.trim().split(/\s+/).slice(0, 7).map((w) => w.replace(/[^\w'-]/g, ''));
  for (let i = 0; i < words.length; i++) {
    if (RECORD_NOUN.test(words[i])) return false;
    if (WORK_PRODUCT.test(words[i]) && !RECORD_NOUN.test(words[i + 1] || '')) return true;
  }
  return WORK_PRODUCT.test(after) && !words.some((w) => RECORD_NOUN.test(w));
}

// Quoted spans that are attributed: something precedes them in the sentence.
// A sentence that is nothing but a quote is not exempt.
function attributedQuotes(s) {
  const out = [];
  for (const re of [/"[^"\n]{1,300}"/g, /(?:^|[\s(])'([^'\n]{3,300})'(?=[\s.,;:!?)]|$)/g]) {
    let m;
    while ((m = re.exec(s))) {
      const start = m.index + (m[0].startsWith("'") || m[0].startsWith('"') ? 0 : 1);
      if (s.slice(0, start).replace(/[\s([{-]/g, '')) out.push([start, m.index + m[0].length]);
    }
  }
  return out;
}

export function sentenceSpans(text) {
  const spans = [];
  const re = /[.!?]+(?=\s|$)|\n/g;
  let start = 0, m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    spans.push([start, end]);
    start = end;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans;
}

// Whether the noun phrase is the owner's: "your/my …", "all (of your) …", a
// quantity, or "the/this/that" with a ticker or an order-like noun.
function ownerScope(lead, noun, original) {
  if (/\b(your|my)\b/i.test(lead)) return true;
  if (/\ball\b/i.test(lead) || /\b\d[\d,.]*\b/.test(lead)) return true;
  if (/\b(the|this|that|these|those)\b/i.test(lead) && (THE_OK_NOUN.test(noun) || /\b[A-Z]{2,5}\b/.test(original))) return true;
  if (/\b(a|an)\b/i.test(lead) && ORDER_NOUN.test(noun)) return true;
  return false;
}

// The clause a hypothetical cue must be in: text after the last "but",
// "however", ";" or dash ("If you'd rather keep it that's fine, but all 20 MU
// have been sold" is still a claim).
function lastClause(prefix) {
  const cut = Math.max(...[/\b(but|however|although|though|yet)\b/gi, /[;—]|\s-\s/g].flatMap((re) => [...prefix.matchAll(re)].map((m) => m.index + m[0].length)), 0);
  return prefix.slice(cut);
}

// Clause starts where a terse confirmation can begin: the sentence start and
// after a colon, semicolon or dash ("Here's what I did: sold 10 NBIS…").
function clauseStarts(s) {
  const out = [0];
  for (const m of s.matchAll(/[:;—]\s*|\s-\s/g)) out.push(m.index + m[0].length);
  return out;
}

function sentenceClaims(s) {
  const quotes = attributedQuotes(s);
  const quoted = (i) => quotes.some(([a, b]) => i >= a && i < b);
  const before = (i) => s.slice(0, i);
  const hypoBefore = (i) => HYPO.test(lastClause(before(i)));
  const reportedBefore = (i) => (REPORTED.test(before(i)) && !OWN_REPORT.test(before(i))) || SOURCE_REPORT.test(before(i));
  const narrative = (end, pred) => (/^(sold|bought|shorted|sell|buy)$/i.test(pred) && PARTICLE_AFTER.test(s.slice(end, end + 30))) || AGENT_AFTER.test(s.slice(end, end + 60));
  let m;

  // 1. The assistant or the app as the actor.
  ACTOR_RE.lastIndex = 0;
  while ((m = ACTOR_RE.exec(s))) {
    const [, subject, aux, verb] = m;
    const verbEnd = m.index + m[0].length;
    const app = /^(signal desk|the app)$/i.test(subject);
    if (quoted(m.index) || hypoBefore(m.index) || NEG_MODAL.test(aux) || SOURCE_REPORT.test(before(m.index))) continue;
    if (app && (reportedBefore(m.index) || DATED.test(s))) continue;
    if (workProduct(s.slice(verbEnd, verbEnd + 80))) continue;
    if (/^(sold|bought|shorted)$/i.test(verb) && PARTICLE_AFTER.test(s.slice(verbEnd, verbEnd + 30))) continue;
    return 'actor';
  }

  // 2. Something of the owner's has been traded or changed (passive).
  const passive = (re, kind) => {
    re.lastIndex = 0;
    let p;
    while ((p = re.exec(s))) {
      const lead = p[1] || '';
      const noun = p[2];
      const aux = kind === 'ticker' ? p[3] : p[4];
      const pred = kind === 'ticker' ? p[4] : p[5];
      const complement = kind === 'ticker' ? '' : p[3] || '';
      const start = p.index;
      const nounAt = start + lead.length;
      const end = start + p[0].length;
      const window = s.slice(Math.max(0, start - 30), nounAt);
      if (quoted(start) || hypoBefore(nounAt) || reportedBefore(nounAt)) continue;
      if (NEG.test(window) || NEG_MODAL.test(aux)) continue;
      if (THIRD_PARTY.test(lead + complement) || ATTRIBUTION.test(s) || DATED.test(s) || narrative(end, pred)) continue;
      if (!ownerScope(lead, noun, s.slice(start, end))) continue;
      if (PERFECT.test(aux)) return kind;
      if (COMPLETED_PRED.test(pred) && (kind === 'ticker' || ORDER_NOUN.test(noun) || /^(positions?|shares|stakes?|holdings?|proceeds)$/i.test(noun))) return kind;
      if (RECORD_PRED.test(pred) && !ORDER_NOUN.test(noun) && !/^(set|active)$/i.test(pred)) return kind;
      if (ORDER_NOUN.test(noun) && /^(recorded|saved|logged|added|created)$/i.test(pred)) return kind;
    }
    return null;
  };
  const pk = passive(PASSIVE_RE, 'passive') || passive(TICKER_RE, 'ticker');
  if (pk) return pk;

  // 3. Terse confirmations at the start of the sentence or of a clause.
  if (!DATED.test(s)) {
    for (const at of clauseStarts(s)) {
      const c = s.slice(at);
      if (quoted(at + c.search(/\S/)) || (at > 0 && (hypoBefore(at) || reportedBefore(at)))) continue;
      if (LEAD_RE.test(c) || LEAD_NOUN_RE.test(c) || LEAD_RECORD_RE.test(c)) return 'lead';
      const t = LEAD_TICKER_RE.exec(c);
      if (t && /^[A-Z]{1,5}$/.test(t[1]) && !/^(I|A)$/.test(t[1])) return 'lead';
    }
  }

  // 4. "… for you", "went through", alerts now active, cash now X.
  for (const [re, kind] of [[BEHALF_RE, 'behalf'], [WENT_THROUGH_RE, 'through'], [ALERT_RE, 'alert'], [CASH_NOW_RE, 'cash']]) {
    re.lastIndex = 0;
    let x;
    while ((x = re.exec(s))) {
      const pre = s.slice(Math.max(0, x.index - 30), x.index) + x[0];
      if (quoted(x.index) || hypoBefore(x.index) || reportedBefore(x.index)) continue;
      if (NEG.test(pre) || /\b(would|could|will|might|should)\b/i.test(x[0]) || DATED.test(s) || THIRD_PARTY.test(x[0]) || ATTRIBUTION.test(s)) continue;
      return kind;
    }
  }
  return null;
}

// Sentences of `text` that read as claims of a trade or record change.
export function findClaims(text) {
  if (text == null || text === '') return [];
  const original = String(text);
  const norm = original.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  const out = [];
  for (const [a, b] of sentenceSpans(norm)) {
    const kind = sentenceClaims(norm.slice(a, b));
    if (kind) out.push({ start: a, end: b, sentence: original.slice(a, b).trim(), kind });
  }
  return out;
}

export function guardText(text) {
  const claims = findClaims(text);
  if (!claims.length) return { text, flagged: false, removed: [] };
  const original = String(text);
  let out = '', last = 0;
  for (const c of claims) {
    const seg = original.slice(c.start, c.end);
    out += original.slice(last, c.start) + seg.match(/^\s*/)[0] + REMOVED + (seg.endsWith('\n') ? '\n' : '');
    last = c.end;
  }
  return { text: out + original.slice(last), flagged: true, removed: claims.map((c) => c.sentence) };
}
