// Trade-claim guard for Ask Signal Desk answers.
//
// Signal Desk cannot trade and the agent cannot save changes, so a sentence
// saying a trade happened (or is happening) or a record changed "for you" is
// always wrong. Every answer field passes through guardText(); sentences that
// make such a claim are replaced with a notice. This is a backstop: the system
// prompt is the primary control, and the agent loop gives the model one chance
// to rephrase. Exports: REMOVED (the notice), sentenceSpans, findClaims and
// guardText.
//
// The rules read sentence structure rather than lists of trading verbs, so
// verbs they have not seen are caught too: any past, perfect, progressive or
// emphatic verb counts unless it is an analysis, communication or market verb.
// Each sentence is tokenised and split into clauses (at ; : — " - " ✔ ✅ and
// but/though/however). A sentence is a claim when:
// - actor: "I", "we", "Signal Desk" or "the app" + such a verb whose object is
//   the owner's: a ticker, shares, an order or sale, cash, an alert, the thesis
//   or notes, records, an account ("I zeroed out the USD cash", "we've scaled
//   out of VST", "I'm selling the 30 NBIS", "I did record the sale", "I've
//   taken care of the sale", "the sale I processed", "I'll sell them now");
// - lead: a clause opens with such a verb and no subject ("Booked the VRT sale
//   into your transactions", "Done — unloaded 15 MU", "Placing the order now",
//   "Filled: 50 XEQT"), or with a terse result ("Alert removed.", "Changes
//   saved.", "MU bought: 15 shares", "40 SOXL out at 33.75");
// - passive: an owner-scoped noun + was/were/has been/got + any participle
//   ("Your alerts have been wiped"), or + is/are + a finished result ("your
//   CRWV is sold"), or anything saved "to your strategy notes";
// - state: "your USD cash is now 0", "now reads 5,210", "you now hold 0 NBIS",
//   "order's in", "your order is working", "goes out now", "as we speak", "the
//   SOXL order filled", "went through", "sell 100 SOXL, executed".
// Not claims, because the verb or the object is harmless:
// - analysis, communication and market verbs (checked, compared, recalculated,
//   proposed, drafted, fell, crossed…) and participles (valued, weighted,
//   exposed, triggered…);
// - the assistant's own work product ("I updated the scenario", "I added VST
//   to the comparison", "I changed the quantity to 50 shares"), unless it is
//   part of a record ("the typo in your NBIS thesis");
// - market narrative: other subjects ("Insiders unloaded…"), particles (sold
//   off, bought back), agents ("by funds"), market causes ("during the
//   drawdown"), corporate actions ("after the split"), third-party possessives
//   ("its shares"), attributions ("per the Form 4", "per your ledger"),
//   unscoped nouns ("VRT shares were dumped"), idioms ("I'm sold on").
// Exempt only when the exemption governs the claim:
// - negation in the claim's own verb or noun phrase ("I haven't sold", "no
//   order has been placed"), not an interjection ("No problem — …");
// - a conditional earlier in the claim's clause ("If we sold…", "Had the order
//   filled…") or a scenario frame opening it ("In scenario S2 we sold…");
//   "Based on the scenario, I have sold…" is still a claim;
// - the owner as the actor ("the alert you deleted", "by you", "at your
//   broker"; approving is not doing) or the owner's own dated trade ("were sold
//   on 2026-10-15"); a date never exempts a record change ("the 2026-10-15
//   transaction was deleted") or the assistant as actor;
// - reported speech by a third party ("the post claims…"; "that said" is not
//   speech), a retraction of the assistant's own earlier statement ("Earlier I
//   said X — that was wrong"), attributed quotes (a fully quoted sentence is
//   not exempt), and questions.
// Every scan is bounded, so a 20,000-character answer takes a few milliseconds.

export const REMOVED = '[Removed: a statement claiming a trade or record change. Signal Desk cannot trade, and record changes only happen when you press Confirm.]';

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

// Irregular past forms and participles, with their base form.
const IRREGULAR = Object.fromEntries(`sold:sell bought:buy put:put sent:send made:make took:take taken:take got:get gotten:get
  went:go gone:go did:do done:do set:set reset:reset cut:cut hit:hit let:let shut:shut quit:quit bid:bid read:read ran:run
  found:find saw:see seen:see kept:keep left:leave held:hold thought:think told:tell said:say wrote:write written:write
  drew:draw drawn:draw chose:choose chosen:choose dealt:deal had:have spent:spend paid:pay laid:lay meant:mean
  brought:bring caught:catch led:lead lost:lose shot:shoot stuck:stick struck:strike swept:sweep undid:undo undone:undo
  withdrew:withdraw withdrawn:withdraw rewrote:rewrite rewritten:rewrite redid:redo redone:redo rebuilt:rebuild
  built:build broke:break broken:break gave:give given:give rose:rise risen:rise fell:fall fallen:fall sank:sink
  sunk:sink began:begin begun:begin understood:understand heard:hear knew:know known:know spoke:speak spoken:speak
  split:split spread:spread forecast:forecast offset:offset overrode:override overridden:override stood:stand sat:sit
  won:win slid:slide swung:swing resold:resell bet:bet upheld:uphold mistook:mistake mistaken:mistake
  wound:wind unwound:unwind overwrote:overwrite overwritten:overwrite froze:freeze frozen:freeze hid:hide hidden:hide
  forgot:forget forgotten:forget tore:tear torn:tear drove:drive driven:drive overtook:overtake overtaken:overtake
  undertook:undertake undertaken:undertake retook:retake retaken:retake`.split(/\s+/).map((p) => p.split(':')));
// Past forms identical to the base form: at the start of a clause they are
// usually imperatives ("Set an alert at 105 if…").
// Simple past forms that are not participles ("cash went from…" is not "cash moved").
const PAST_ONLY = words('went did ran saw took gave wrote rose fell began knew spoke drew chose broke froze hid forgot tore drove sank swung won overtook undertook retook mistook overrode withdrew undid redid rewrote overwrote stood sat slid');
const BASE_SAME = words('put set reset cut hit let shut quit bid read split spread forecast offset bet');
// Analysis, communication, opinion and market-movement verbs (base forms).
const ALLOW = words(`look check recheck double-check cross-check review compare calculate recalculate compute recompute
  estimate find notice spot catch detect identify discover observe pull retrieve fetch read reread use assume see
  note model simulate project forecast flag highlight mention say tell ask explain mean want think consider draft
  prepare propose suggest recommend outline summarize summarise list show plot chart graph describe quote cite
  reference count verify search scan load analyze analyse examine inspect evaluate assess weigh factor round sort
  group filter translate discuss talk speak write understand gather learn hear receive answer address focus keep leave
  hold wait pause skip ignore decline refuse avoid rerun re-run match map treat interpret misread misspeak misstate
  clarify emphasize emphasise stress warn caution remind point walk tally total annotate label rank screen benchmark
  measure test expect predict guess believe feel wonder doubt hope worry agree disagree relate base give realize
  realise interest concern surprise impress please encourage disappoint convince tempt incline puzzle confuse excite
  rise fall gain climb slide sink jump surge rally plunge tumble cross touch reach end finish slip dip spike soar
  pop gap bounce recover rebound outperform underperform lag beat miss report announce guide peak bottom hover stall
  break lose fire trigger breach drift have need require refresh sync reload`);
// Words ending in -ed / -ing that are not verb forms here.
const NOT_VERB = words(`need indeed speed seed feed proceed exceed succeed bed red shed wed embed hundred sacred kindred
  naked wicked rugged ragged beloved aged thing nothing something anything everything string spring king ring sing
  bring during ceiling morning evening pending outstanding remaining following earnings offering building setting
  settings opening closing funding listing ranking rating pricing ending beginning meaning warning saving savings
  filing filings standing timing lending spending banking feeling understanding according including regarding
  concerning considering excluding notwithstanding interesting upcoming existing missing ongoing matching rising
  falling leading growing holding holdings weighting sizing positioning interesting surprising worrying amazing
  exciting willing`);
// Trading verbs that are a claim even without an owner-scoped object ("Sold at market.").
const STRONG = words('sell buy purchase execute submit fill liquidate short trade offload unload dump trim exit place resell');
// Trades a dated record can describe ("Your 15 VRT were sold on 2026-10-15").
const TRADE = words('sell buy purchase execute submit fill liquidate short trade offload unload dump trim exit place close open cover reduce rebalance rotate swap transfer deposit withdraw convert settle pay receive acquire fund contribute');
// Results that read as done even with a plain "is": "your CRWV is sold".
const COMPLETE = words(`sell buy purchase execute submit fill liquidate short offload unload dump trim exit place close cover
  rebalance rotate swap transfer deposit withdraw convert settle cancel delete remove wipe clear scrub erase purge book log
  process finalize finalise complete credit debit do go zero merge unwind`);
// Participles that describe the market or a state, not a change made to the records.
const HARMLESS = words(`value price weight concentrate expose hold list report rate affect base denominate quote measure
  expect schedule hit hurt drive drag lift boost pressure squeeze punish reward tie link connect import trigger fire
  cross breach reach touch delay halt suspend dilute show display store keep leave stick freeze cap limit
  diversify own size overweight underweight overbuy oversell upgrade downgrade rerate concern interest surprise
  validate vindicate challenge question test spread pay`);
const UN_HARMLESS = /^un(?:changed|touched|affected|filled|sold|reali[sz]ed|confirmed|settled|recorded|saved|modified|altered|edited|executed|placed|submitted|traded|invested|allocated|hedged|priced|quoted|triggered)$/;

// Nouns: the owner's things, and the assistant's own work product.
const OWNER = words(`alert alerts threshold thresholds thesis theses strategy strategies ledger transaction transactions
  record records holding holdings position positions stake stakes share shares lot lots cash balance balances order orders
  trade trades sale sales purchase purchases buy buys sell sells dividend dividends deposit deposits withdrawal withdrawals
  portfolio proceeds watchlist stop-loss stop-losses entry entries rebalance swap rotation fill fills trim exit units sh
  short shorts journal account accounts tfsa rrsp resp fhsa lira rrif ira`);
const WORK = words(`scenario scenarios simulation simulations what-if table tables chart charts graph graphs plot plots
  comparison comparisons estimate estimates figure figures number numbers calculation calculations math analysis analyses
  breakdown summary summaries projection projections model models count quantity example examples illustration
  assumption assumptions input inputs proposal proposals draft drafts card cards answer answers response reply list lists
  view views column columns row rows line lines benchmark benchmarks weights weighting allocation price prices quote quotes
  rate rates data same total totals overview look sense point points question questions concern concerns caveat caveats
  risk risks issue issues option options case cases pros cons idea ideas suggestion suggestions recommendation
  recommendations mistake mistakes error errors typo report reports briefing briefings assessment assessments peer peers
  metric metrics method approach context details detail statement statements baseline snapshot instruction instructions
  request message messages wording text paragraph section bullet bullets heading explanation sandbox spreadsheet formula steps
  step guide walkthrough`);
// Changes the assistant might claim to have applied: "Changes saved."
const CHANGE = words('change changes edit edits update updates correction corrections adjustment adjustments fix fixes');
// Order-like nouns for "order's in", "the order filled".
const ORDERISH = words('order orders trade trades sale sales purchase purchases buy buys sell sells trim exit bid bids fill fills rebalance swap ticket stop-loss');
// Nouns whose current value can be claimed: "your USD cash is now 0".
const STATE = words('cash balance balances holding holdings position positions stake stakes shares alert alerts threshold basis lot lots');
const NOT_TICKER = words(`I A USD CAD US USA UK EU TFSA RRSP RESP FHSA LIRA RRIF RDSP IRA HSA ETF ETFS AI CEO CFO COO CTO IPO
  EPS GPU GPUS CPU HBM FX PE YTD MTD QTD OK NYSE TSX NASDAQ SEC FDA AM PM ET EST EDT PST PDT GMT UTC LLC INC ADR ATH ATL
  CAGR ROI ROE EBITDA DCF LMT MKT GTC DAY FIFO LIFO ACB NAV MER AUM DRIP ESG CPI GDP FOMC FED BOC BOJ ECB API SELL BUY
  SOLD BOUGHT FILLED DONE NOTE NB FYI TL DR TLDR AND OR THE NOT NO YES ID PDF CSV URL PS VS MOM YOY QOQ RSI MACD SMA EMA
  VWAP DTE OTM ITM ATM IV RE FW AKA ASAP OTC SPAC REIT ALL NEW UP DOWN NOW IS IT TO IN AT ON BY OF FOR STATUS LIVE`);
const PARTICLE = words('up down out off in back over away ahead along around aside forward');
// Words that end a noun phrase.
const PREP = words(`to into from in on at for by with of under over against across per via through about after before
  since during until till toward towards onto within without between among like as so because which that while when
  and or but then using than instead plus versus vs once if unless where whereas who whom whose what how why whether
  nor`);
// Work-product nouns that can also be part of a record ("the price on your alert").
const ATTRIBUTE = words('typo typos error errors mistake mistakes figure figures number numbers price prices quantity count amount date dates wording text paragraph line lines section value values total totals rate');
const DEST = words('to into in from onto within inside under');
const DETERMINER = words('the a an your my our this that these those all some half both each every another more any its their his her');
const AUX = words(`'ve have has had 'd 'm am 're are is 's was were been be being just already now also then successfully
  actually indeed finally quickly immediately officially since all both still really personally manually automatically
  even did do does not never will 'll would could should can might may shall must cannot can't won't wouldn't couldn't
  shouldn't didn't don't doesn't haven't hasn't hadn't isn't aren't wasn't weren't going to gonna`);
const NEG_WORD = /^(not|never|no|nothing|none|neither|nor|cannot|without|.*n't)$/;
const MODAL_WORD = /^(will|'ll|would|could|should|can|might|may|shall|must|going|gonna|to|won't|wouldn't|couldn't|shouldn't|can't|cannot)$/;
const BE_PROG = words("'m am 're are is 's was were");
const FINITE = /^(is|are|was|were|'s|'re|would|could|will|might|may|should|can|'ll|'d|leaves|gives|brings|frees|raises|cuts|reduces|lowers|lifts|adds|costs|means|makes|keeps|puts|takes|locks|realizes|realises|triggers|creates|leads|helps|lets|pushes|drops|moves|shifts|changes|turns|limits|boosts|improves|hurts|works|depends|requires|needs|involves|incurs|exposes|removes|eliminates|increases|decreases|trims|halves|doubles|generates|returns|yields|saves|gets|has|does|seems|looks|sounds|remains|stays|becomes|isn't|wouldn't|won't|doesn't)$/;

const lower = (t) => t.toLowerCase();
function stems(w) {
  if (IRREGULAR[w]) return [IRREGULAR[w]];
  const out = [w];
  for (const suf of ['ing', 'ed', 'es', 's', 'd']) {
    if (!w.endsWith(suf) || w.length < suf.length + 3) continue;
    const b = w.slice(0, -suf.length);
    out.push(b, b + 'e');
    if (/([b-df-hj-np-tv-z])\1$/.test(b)) out.push(b.slice(0, -1));
    if (b.endsWith('i')) out.push(b.slice(0, -1) + 'y');
  }
  return out;
}
const PREFIXED = /^(?:auto|re|pre|co|mis|self|double|cross|over|under|bulk|half|hand)-([a-z]+)$/;
const stemIn = (w, set) => stems(w).some((b) => set.has(b)) || (PREFIXED.test(w) && stemIn(PREFIXED.exec(w)[1], set));
const isPast = (w) => (PREFIXED.test(w) && isPast(PREFIXED.exec(w)[1])) || !!IRREGULAR[w] || (/^[a-z][a-z-]*[a-z]ed$/.test(w) && !NOT_VERB.has(w) && (!/eed$/.test(w) || /^(agreed|freed|guaranteed)$/.test(w)));
const isIng = (w) => /^[a-z][a-z-]*ing$/.test(w) && w.length >= 5 && !NOT_VERB.has(w);
const allowed = (w) => stemIn(w, ALLOW);
const isTicker = (t) => /^[A-Z]{2,5}$/.test(t) && !NOT_TICKER.has(t);

// Tokens with their offsets. Contractions are split ("I've" → "I" "'ve").
const TOKEN_RE = /\d+:\d\d\b|[A-Za-z0-9$#][\w$#&'./,%-]*[\w%]|[A-Za-z0-9$%]|[—–;:!?,()✔✅☑•@]|\s-\s|^\s*[-*•>](?=\s)/g;
function tokenize(s) {
  const out = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    const t = m[0].trim(), a = m.index + m[0].indexOf(t);
    const c = /^(.+?)('(?:ve|m|re|d|ll|s))$/i.exec(t);
    if (c && !/n't$/i.test(t)) {
      out.push({ t: c[1], a, b: a + c[1].length });
      out.push({ t: c[2], a: a + c[1].length, b: a + t.length });
    } else out.push({ t, a, b: a + t.length });
  }
  for (const k of out) {
    k.lw = lower(k.t);
    k.punct = !/[A-Za-z0-9$%]/.test(k.t);
  }
  return out;
}
const BOUNDARY = /^([;:—–✔✅☑•*>-]|but|though|although|however|whereas)$/;

// What a word is as a noun: the owner's thing, work product, a ticker, a
// negative ("no", "nothing") or a pronoun.
function nounClass(T, i) {
  const { t, lw } = T[i];
  const prev = T[i - 1]?.lw || '', next = T[i + 1]?.lw || '';
  if (prev === 'to' && /^(buy|sell|trim|exit|short|record|log|save)$/.test(lw)) return null;
  if (/^(price|cost)$/.test(lw) && /^(entry|average|avg|purchase|book|fill|cost)$/.test(prev)) return 'owner';
  if (lw === 'basis') return prev === 'cost' ? 'owner' : 'work';
  if (/^notes?$/.test(lw)) return /^(thesis|strategy|your|my|investment|trade|trading)$/.test(prev) ? 'owner' : null;
  if (/^(history|log)$/.test(lw)) return /^(transaction|transactions|trade|trading|account|order|your|my|dividend)$/.test(prev) ? 'owner' : null;
  if (/^rules?$/.test(lw)) return /^(strategy|your|my)$/.test(prev) ? 'owner' : null;
  if (/^records?$/.test(lw) && /^(high|low|highs|lows|close|quarter|year|revenue|level|date)$/.test(next)) return null;
  if (OWNER.has(lw) || (lw === 'margin' && /^accounts?$/.test(next))) return 'owner';
  if (WORK.has(lw)) return 'work';
  if (isTicker(t)) return 'ticker';
  if (/^(no|nothing|none|neither|zero)$/.test(lw)) return 'neg';
  if (/^(it|them|that|this|those|these|everything|both|all)$/.test(lw)) return 'pron';
  return null;
}

// The nearest owner or work-product noun before index i: what "it" refers to.
function resolve(T, i) {
  for (let k = i - 1; k >= 0 && k >= i - 30; k--) {
    const c = nounClass(T, k);
    if (c === 'owner' || c === 'work') return c;
    if (c === 'ticker') return 'owner';
  }
  return null;
}

// What a verb acts on, read noun phrase by noun phrase after it: 'owner' (the
// owner's things), 'work' (the assistant's own work product, which also wins
// when it is where a ticker went: "added VST to the comparison"), 'neg'
// ("sold nothing"), or null. `back` is where to look for what "it" means.
function objClass(T, from, end, back) {
  let i = from, decided = null, prep = null, nps = 0, plain = false;
  while (i < end && PARTICLE.has(T[i].lw)) i++;
  while (i < end && nps < 5 && i - from < 18) {
    if (T[i].punct) { if (T[i].t === '@') { i++; continue; } break; }
    if (PREP.has(T[i].lw)) {
      prep = T[i].lw; i++;
      // "the steps to record the sale": the object was "the steps".
      if (prep === 'to' && plain && !decided && i < end && !DETERMINER.has(T[i].lw) && !/^[\d$]/.test(T[i].t) && !isTicker(T[i].t)) return null;
      continue;
    }
    if (PARTICLE.has(T[i].lw) && i > from) { prep = T[i].lw; i++; continue; }
    let j = i, head = null, poss = false, neg = false, pron = false;
    for (; j < end && j < from + 18 && !T[j].punct && !PREP.has(T[j].lw) && !(j > i && PARTICLE.has(T[j].lw)); j++) {
      const c = nounClass(T, j);
      if (c === 'neg' && j === i) neg = true;
      if (/^(your|my|our)$/.test(T[j].lw)) poss = true;
      if (c === 'owner' || c === 'work' || c === 'ticker') head = c;
      else if (c === 'pron' && head === null) pron = true;
    }
    nps++;
    if (neg && nps === 1) return 'neg';
    plain = head === null && !pron && DETERMINER.has(T[i].lw);
    if (head === 'work' && ATTRIBUTE.has(T[j - 1].lw) && /^(in|on|of|for)$/.test(T[j]?.lw || '') && /^(your|my)$/.test(T[j + 1]?.lw || '')) {
      let x = j + 2;
      while (x < end && x < j + 6 && !T[x].punct && !PREP.has(T[x].lw) && nounClass(T, x) !== 'owner') x++;
      if (x < end && nounClass(T, x) === 'owner') return 'owner';
    }
    if (head === 'work') {
      if (!decided || DEST.has(prep)) return 'work';
    } else if (head === 'owner' || (head === 'ticker' && poss)) decided = 'owner';
    else if (head === 'ticker') decided = decided || 'weak';
    else if (pron && !decided) {
      const r = resolve(T, back);
      if (r === 'work') return 'work';
      if (r) decided = 'owner';
    }
    i = j;
  }
  return decided ? 'owner' : null;
}

// Work product in a destination after a verb: "… sold in the scenario".
function workDest(T, from, end) {
  for (let i = from; i < end && i < from + 14; i++) {
    if (T[i].punct && T[i].t !== '@') return false;
    if (!DEST.has(T[i].lw)) continue;
    for (let j = i + 1; j < end && j < i + 8 && !T[j].punct && !PREP.has(T[j].lw); j++) if (nounClass(T, j) === 'work') return true;
  }
  return false;
}

const NP_STOP = /^(and|but|so|because|which|when|after|before|since|while|though|although|if|unless|once|until|as|than|or|then|where|who|whereas|nor)$/;
const NP_DET = /^(your|my|our|the|a|an|this|that|these|those|its|their|his|her|all|no|every|each|some|any|both|half|none|nothing|neither)$/;
const THE_OK = words('order orders trade trades sale sales purchase purchases transaction transactions thesis strategy alert alerts proceeds sell buy trim rebalance basis dividend dividends lot lots');
// The noun phrase ending just before index j (skipping has/have/now/not…):
// the subject of "was sold" or "is now 0". Returns its head class, whether it
// is the owner's, negated or someone else's, and its token range.
function subjectBefore(T, j, lo) {
  let k = j - 1, neg = false, modal = false;
  while (k >= lo && ((AUX.has(T[k].lw) && !/^(all|both|to)$/.test(T[k].lw)) || (/^(all|both|each)$/.test(T[k].lw) && AUX.has(T[k + 1].lw)))) {
    if (NEG_WORD.test(T[k].lw)) neg = true;
    if (MODAL_WORD.test(T[k].lw)) modal = true;
    k--;
  }
  if (k >= lo && /^(that|which|who)$/.test(T[k].lw)) k--;
  if (k >= lo && T[k].t === ')') { while (k > lo && T[k].t !== '(') k--; k--; }
  const end = k;
  if (end < lo || DETERMINER.has(T[end].lw)) return null;
  let start = k;
  for (; start >= lo && end - start < 14; start--) {
    const tk = T[start];
    if (tk.t === ')') { while (start > lo && T[start].t !== '(') start--; continue; }
    if (tk.punct && tk.t !== '@' && tk.t !== '(') break;
    if (NP_STOP.test(tk.lw)) break;
    if (tk.lw === 'that' && /^(your|my|the|a|an|it|you|we|i|they|its|all|no|nothing)$/.test(T[start + 1]?.lw || '')) break;
  }
  start++;
  if (start > end) return null;
  // The core ends at the first complement ("of", "to sell", "in your TFSA")
  // or relative clause ("you deleted").
  let core = end;
  for (let i = start + 1; i <= end; i++) {
    if (PREP.has(T[i].lw) || /^(you|i|we|they)$/.test(T[i].lw) || T[i].t === '(') { core = i - 1; break; }
  }
  // Only determiners and quantities reach left of the last determiner ("all
  // of your shares"); anything else is not part of the phrase ("claims your
  // shares", "says the order").
  for (let d = core; d > start; d--) {
    if (!NP_DET.test(T[d].lw)) continue;
    while (d > start && (NP_DET.test(T[d - 1].lw) || /^(of|not|one|\d[\d,.]*)$/.test(T[d - 1].lw))) d--;
    start = d;
    break;
  }
  const c = nounClass(T, core);
  let head = c;
  const coreToks = T.slice(start, core + 1), all = T.slice(start, end + 1);
  if (coreToks.some((t) => NEG_WORD.test(t.lw) || t.lw === 'zero')) neg = true;
  if (head === 'pron') { const r = resolve(T, start); head = r === 'owner' ? 'owner' : null; }
  const third = all.some((t, i) => /^(its|their|his|her)$/.test(t.lw) || (t.t === "'s" && i > 0 && /^[A-Z][a-z]/.test(all[i - 1].t) && all[i - 1].lw !== 'i'));
  const poss = all.some((t) => /^(your|my|our)$/.test(t.lw));
  const det = coreToks.some((t) => /^(the|this|that|these|those)$/.test(t.lw));
  const scoped = head === 'owner' && start === end ? false
    : poss || coreToks.some((t) => t.lw === 'all' || /^\d[\d,.]*$/.test(t.t))
      || (det && (coreToks.some((t) => isTicker(t.t)) || THE_OK.has(T[core].lw)))
      || (/^(a|an)$/.test(coreToks[0]?.lw) && ORDERISH.has(T[core].lw));
  return { head, headWord: T[core].lw, start, end, core, neg, modal, third, scoped: scoped || (c === 'pron' && head === 'owner') };
}

// Hypothetical cues: a conditional anywhere before the claim in its clause,
// or a scenario frame that opens the clause ("In scenario S2 we sold…", not
// "As requested in the scenario, your shares were sold").
const HYPO_WORD = /\b(?:if|suppose|supposing|assum(?:e|es|ed|ing)|imagine|what if|say you|let's say|hypothetical(?:ly)?|for example|for instance|e\.g|were (?:you|we|i|it|they) to)\b/i;
const HYPO_LEAD = /^\W*(?:(?:so|and|then|now|ok|also|here|again)\W+)?(?:(?:in|under|within|for|with) (?:the |this |that |a |your |my |our )?(?:scenario|what-if|simulation|hypothetical|sandbox|model|example|illustration|bear case|bull case|base case|projection|comparison|table|chart|plan|assumption)s?\b|(?:in |under )?scenario S\d|S\d\b)/i;
const INVERTED = /^\W*(?:had|were|should)\s+(?:you|we|i|it|they|the|your|my|this|that|[A-Z]{2,5})\b/i;
const SAID_IDIOM = /\b(?:that said|having said that|that being said|needless to say|all that said)\b/gi;
const REPORTED = /\b(claims?|claimed|claiming|asserts?|asserted|asserting|says?|said|saying|states?|stated|asks?|asked|asking|tells?|told|telling|instructs?|instructed|instructing|wants?|wanted|demands?|demanded|pretends?|pretending|alleges?|alleged|suggests?|suggested|urges?|urged|reports?|reported|insists?|insisted|writes|wrote|according to|instructions?)\b/gi;
const SOURCE_REPORT = /\b(it|they|(?:the|this|that|a|one) (?:\w+\s+)?(?:post|item|article|update|message|text|note|blog|site|headline|source|story|report|tweet|thread|comment|email|forum))\s+(?:\w+\s+){0,2}?(claims?|asserts?|says?|asks?|tells?|instructs?|wants?|demands?|urges?|alleges?|suggests?)\b/i;
const ATTRIBUTION = /\b(according to|per (?:the|its|a|their|his|her)\b|per your (?:ledger|records?|statement|history|transactions?|transaction history|log|import|data)\b|per \d|13f|form 4|filings?|press release|reported by)\b|\b(?:statement|records?|ledger|history|log|import|filing|confirmation)\s+(?:also\s+)?(?:shows?|says|lists|indicates|reflects|confirms)\b/i;
const PAST_DATE = /\b(?:\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?\b|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|in (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|in 20\d\d|last (?:week|month|quarter|year|monday|tuesday|wednesday|thursday|friday)|earlier this (?:week|month|quarter|year)|previously|back in)\b/i;
const REQUEST = /\b(?:as (?:you )?(?:requested|asked|instructed|wanted)|like you (?:asked|wanted|said)|per your (?:request|instructions?|message|ask)|as instructed|at your request|for you|on your behalf|you asked for)\b/i;
const USER_RE = /\bby you\b|\byourself\b|\byour own\b|\b(?:at|with|through|via|in|from|by) your (?:broker|brokerage)\b|\byour broker(?:age)?(?:'s)? (?:statement|confirmation|platform|app|account)\b|\byour (?:import|statement|csv)\b/i;
const USER_SPEECH = words('ask request tell say want instruct mention write type order demand note suggest expect need hope plan think decide prefer like approve authorize authorise okay ok greenlight sign');
const OWN_SPEECH = /\b(?:I|we)\s+(?:\w+\s+){0,2}?(?:said|claimed|wrote|told you|stated|mentioned|reported|noted|indicated|implied)\b/i;
const RETRACT = /\b(?:that|this|it) (?:was|is) (?:wrong|incorrect|a mistake|an error|false|inaccurate|untrue|not (?:true|right|correct|accurate))\b|\bI was wrong\b|\bI misspoke\b|\bmy mistake\b/i;
const CORPORATE = /\b(?:the|a|stock|reverse|\d+-for-\d+|\d+:\d+)\s+(?:split|spin-?off|merger|consolidation|reorgani[sz]ation)\b|\b(?:drip|dividend reinvestment)\b/i;
const MARKET_CAUSE = /^\s*(?:\S+\s+){0,4}?(?:in value|(?:during|in|amid|after|with|on|by) (?:the |this |that |last |a )?(?:\w+ )?(?:drawdown|sell-?off|crash|rally|correction|decline|slump|downturn|rout|dip|run-?up|squeeze|market|sector|move|drop|surge))\b/i;
const PROGRESS = /\b(?:now|right now|as we speak|right away|immediately|at this moment|currently|in progress|momentarily|this minute)\b/i;
const QUESTION = /^\W*(?:is|are|was|were|has|have|had|did|do|does|will|would|could|should|can|what|which|when|where|why|how|who)\b[^]*\?\s*$/i;
const LEAD_INTERJ = /(?:done|ok(?:ay)?|sure(?: thing)?|great|perfect|alright|all (?:set|done)|good news|success|confirmed|yes|yep|update|heads up|fyi|got it|no problem|no worries|consider it done|as (?:you )?(?:requested|asked|instructed)|per your (?:request|instructions?))\b[\s!,.:;—–-]*/iy;
const TICKER_VERBS = words('sell buy purchase short cover trim liquidate offload unload dump fill execute exit');
const TERSE_END = words('executed filled done completed complete placed submitted sent booked logged recorded saved confirmed');
const ORDER_STATE = words('in working live resting pending out open active queued underway');

// Quoted spans that are attributed: something precedes them in the sentence.
// A sentence that is nothing but a quote is not exempt.
function attributedQuotes(s) {
  const out = [];
  const first = s.search(/[^\s([{-]/);
  for (const re of [/"[^"\n]{1,300}"/g, /(?:^|[\s(])'([^'\n]{3,300})'(?=[\s.,;:!?)]|$)/g]) {
    let m;
    while ((m = re.exec(s))) {
      const start = m.index + (m[0].startsWith("'") || m[0].startsWith('"') ? 0 : 1);
      if (first >= 0 && first < start) out.push([start, m.index + m[0].length]);
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

// "you deleted", "you've recorded": the user did it (not "you asked").
function userDid(T, lo, hi) {
  for (let i = lo; i < hi - 1; i++) {
    if (T[i].lw !== 'you') continue;
    let j = i + 1;
    while (j < hi && /^('ve|have|had|'d|already|just|previously|also|then|recently|originally|first|manually|yourself|since)$/.test(T[j].lw)) j++;
    if (j < hi && isPast(T[j].lw) && !stemIn(T[j].lw, USER_SPEECH)) return true;
  }
  return false;
}

// The verb after a subject, past its auxiliaries: "'ve already sold" (past),
// "'m selling" (prog), "did record" (emph). Flags negation and modality.
function verbAfter(T, j, end) {
  let neg = false, modal = false, be = false, doo = false, dd = false, perfect = false;
  for (; j < end; j++) {
    const w = T[j].lw, nx = T[j + 1]?.lw;
    if (/^(went|gone|go|going)$/.test(w) && nx === 'ahead') {
      if (T[j + 2]?.lw === 'and') { j += 2; continue; }
      return { j, kind: 'past', neg, modal: modal && w !== 'going', ahead: true };
    }
    if (w === 'did' || w === 'do' || w === 'does') {
      if (DETERMINER.has(nx) || /^(it|them|that|this|everything|so)$/.test(nx || '')) return { j, kind: 'past', neg, modal };
      doo = true; continue;
    }
    if (w === 'had' && (DETERMINER.has(nx) || nx === 'no')) return { j, kind: 'past', neg, modal };
    if (w === 'about' && nx === 'to') { modal = true; j++; continue; }
    // "I'm in the process of selling", "we're in the middle of placing"
    if (be && w === 'in' && T[j + 1]?.lw === 'the' && /^(process|middle)$/.test(T[j + 2]?.lw || '') && T[j + 3]?.lw === 'of') { j += 3; continue; }
    if (!AUX.has(w) && !/^[a-z]+ly$/.test(w)) break;
    if (NEG_WORD.test(w)) neg = true;
    if (MODAL_WORD.test(w)) modal = true;
    if (w === "'d") dd = true;
    if (dd && w === 'have') modal = true;
    if (BE_PROG.has(w) || w === 'been' || w === 'being') be = true;
    if (/^('ve|have|has|had)$/.test(w)) perfect = true;
  }
  if (j >= end || T[j].punct) return null;
  const w = T[j].lw;
  let kind = null;
  if (be) kind = isIng(w) ? 'prog' : null;
  else if (perfect && /^[a-z]{3,}en$/.test(w) && !/^(often|even|open|seven|eleven|token|citizen|garden|golden|sudden|between)$/.test(w)) kind = 'past';
  else if (doo) kind = /^[a-z]+$/.test(w) && !PREP.has(w) && !DETERMINER.has(w) ? 'emph' : null;
  else if (isPast(w)) kind = 'past';
  return kind && { j, kind, neg, modal };
}

function sentenceClaims(s) {
  const T = tokenize(s);
  const n = T.length;
  if (!n || QUESTION.test(s)) return null;
  const cl = [], lo = [], hi = [];
  let c = -1;
  for (let i = 0; i < n; i++) {
    if (i === 0 || BOUNDARY.test(T[i].lw)) { c++; lo[c] = i; }
    cl[i] = c; hi[c] = i + 1;
  }
  const memo = (f) => { const m = new Map(); return (k) => { if (!m.has(k)) m.set(k, f(k)); return m.get(k); }; };
  const text = (k) => s.slice(T[lo[k]].a, T[hi[k] - 1].b);
  const hypoAt = memo((k) => {
    const t = text(k), at = T[lo[k]].a;
    if (INVERTED.test(t) || HYPO_LEAD.test(t)) return at;
    const m = HYPO_WORD.exec(t);
    return m ? at + m.index : Infinity;
  });
  const userIn = memo((k) => USER_RE.test(text(k)) || userDid(T, lo[k], hi[k]));
  const requestIn = memo((k) => REQUEST.test(text(k)));
  const dateIn = memo((k) => PAST_DATE.test(text(k)));
  const quotes = attributedQuotes(s);
  const said = s.replace(SAID_IDIOM, (m) => ' '.repeat(m.length));
  let reportedAt = Infinity;
  for (const m of said.matchAll(REPORTED)) {
    const lead = said.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(i|we|you|your|my)\b(?:\W+\w+){0,2}\W*$/i.test(lead)) continue;
    reportedAt = m.index; break;
  }
  const src = SOURCE_REPORT.exec(s);
  const srcAt = src ? src.index : Infinity;
  const attributed = ATTRIBUTION.test(s);
  const progress = PROGRESS.test(s), dated = PAST_DATE.test(s);
  const corporate = CORPORATE.exec(s), corporateAt = corporate ? corporate.index : Infinity;
  let commaSubjAt = -1;
  for (const m of s.matchAll(/,\s*(?:your|the|you|it|this|that|my|these|those|we|i|its|they|[A-Z]{2,5})\b/g)) commaSubjAt = m.index;
  let retract = null;
  const os = OWN_SPEECH.exec(s), rt = RETRACT.exec(s);
  if (os && rt && rt.index > os.index) retract = [os.index, rt.index];

  const at = (i) => T[i].a;
  const quoted = (i) => quotes.some(([a, b]) => at(i) >= a && at(i) < b);
  const hypo = (i) => hypoAt(cl[i]) <= at(i);
  const retracted = (i) => retract && at(i) > retract[0] && at(i) < retract[1];
  // Exemptions shared by the rules where no actor is named.
  const exemptPlain = (i) => quoted(i) || hypo(i) || retracted(i) || reportedAt < at(i) || srcAt < at(i) || attributed || userIn(cl[i]);

  // A verb at j with no exemption: does it act on the owner's things?
  const actsOnOwner = (j, back) => {
    const w = T[j].lw, nx = T[j + 1]?.lw || '';
    // "finished buying the 25 VFV": the gerund is the action.
    if (stemIn(w, words('finish')) && isIng(nx) && !allowed(nx)) return actsOnOwner(j + 1, back);
    // "had the CRWV position closed out", "got your order filled"
    if (stemIn(w, words('have get'))) {
      for (let x = j + 1; x < hi[cl[j]] && x < j + 7 && !T[x].punct && !PREP.has(T[x].lw); x++) {
        if (x > j + 1 && isPast(T[x].lw) && !allowed(T[x].lw) && !stemIn(T[x].lw, HARMLESS)) return objClass(T, j + 1, x, back) === 'owner';
      }
    }
    // "pulled the trigger on the sale"
    if (stemIn(w, words('pull')) && nx === 'the' && T[j + 2]?.lw === 'trigger') return objClass(T, j + 3, hi[cl[j]], back) !== 'work';
    // "realized the gain by selling 40 shares", "used it to buy XEQT": the trade is the means.
    for (let x = j + 1; x < hi[cl[j]] - 1 && x < j + 10; x++) {
      if (T[x].punct) break;
      const means = (T[x].lw === 'by' && isIng(T[x + 1].lw)) || (T[x].lw === 'to' && stemIn(w, words('use spend put')) && !isPast(T[x + 1].lw));
      if (means && stemIn(T[x + 1].lw, STRONG) && objClass(T, j + 1, x, back) !== 'work' && objClass(T, x + 2, hi[cl[j]], back) !== 'work') return true;
    }
    if (allowed(w) && !(stemIn(w, words('go')) && nx === 'ahead') && !(stemIn(w, words('write')) && /^(off|over)$/.test(nx))) return false;
    if (stemIn(w, words('sell buy short')) && (/^(off|short)$/.test(nx) || (nx === 'out' && T[j + 2]?.lw !== 'of'))) return false;
    if (stemIn(w, words('sell')) && /^(you|yourself|it|them|myself|us)$/.test(nx) && T[j + 2]?.lw === 'short') return false;
    if (stemIn(w, words('go')) && /^(over|through|back|into)$/.test(nx)) return false;
    const cls = objClass(T, j + 1, hi[cl[j]], back);
    if (cls === 'owner') return true;
    return cls === null && (stemIn(w, STRONG) || requestIn(cl[j]));
  };

  // 1. The assistant or the app as the actor, and verbs coordinated with it.
  for (let k = 0; k < n; k++) {
    let subjEnd = 0, app = false;
    if (/^(i|we)$/.test(T[k].lw)) subjEnd = k + 1;
    else if ((T[k].lw === 'signal' && T[k + 1]?.lw === 'desk') || (T[k].lw === 'the' && /^(app|assistant)$/.test(T[k + 1]?.lw))) { subjEnd = k + 2; app = true; }
    else continue;
    let v = verbAfter(T, subjEnd, hi[cl[k]]);
    if (v === null && /^('ll|will)$/.test(T[subjEnd]?.lw || '') && progress) {
      let j = subjEnd + 1;
      while (j < hi[cl[k]] && /^(just|now|go|ahead|and|immediately)$/.test(T[j].lw)) j++;
      if (j < hi[cl[k]] && stemIn(T[j].lw, STRONG) && !isPast(T[j].lw) && !isIng(T[j].lw)) v = { j, kind: 'now', neg: false, modal: false };
    }
    if (!v || v.neg || v.modal) continue;
    if (quoted(k) || hypo(k) || retracted(k) || srcAt < at(k)) continue;
    if (app && (reportedAt < at(k) || dated)) continue;
    const w = T[v.j].lw;
    const relNoun = k > 1 && /^(that|which)$/.test(T[k - 1].lw) ? k - 2 : k - 1;
    const ownerBefore = () => T.slice(Math.max(lo[cl[k]], relNoun - 20), relNoun).some((t, i, a) => /^(your|my)$/.test(t.lw) && a.slice(i + 1, i + 5).some((u) => OWNER.has(u.lw)));
    const rel = v.kind !== 'emph' && relNoun >= 0 && !allowed(w) && objClass(T, relNoun, relNoun + 1, relNoun) !== 'work'
      && (['owner', 'ticker'].includes(nounClass(T, relNoun))
        || (/^[a-z]+$/.test(T[relNoun].lw) && !PREP.has(T[relNoun].lw) && !AUX.has(T[relNoun].lw) && !DETERMINER.has(T[relNoun].lw) && !nounClass(T, relNoun) && !isPast(T[relNoun].lw) && !isIng(T[relNoun].lw) && ownerBefore()));
    if (rel && objClass(T, v.j + 1, hi[cl[k]], k) !== 'work') return 'actor';
    if (actsOnOwner(v.j, k)) return 'actor';
    // "… and sold 10 NBIS", "… and then bought 5 VRT"
    for (let x = v.j + 1; x < hi[cl[k]] - 1 && x < v.j + 30; x++) {
      if (!/^(and|then)$/.test(T[x].lw)) continue;
      const y = T[x + 1]?.lw === 'then' ? x + 2 : x + 1;
      if (y < n && isPast(T[y].lw) && actsOnOwner(y, y)) return 'actor';
    }
  }

  for (let k = 0; k <= c; k++) {
    // Clause start: past an interjection ("Done —", "As requested,").
    let p = lo[k];
    while (p < hi[k] && T[p].punct) p++;
    for (let g = 0; g < 3 && p < hi[k]; g++) {
      LEAD_INTERJ.lastIndex = at(p);
      const m = LEAD_INTERJ.exec(s);
      if (!m || !m[0]) break;
      const endAt = at(p) + m[0].length;
      while (p < hi[k] && at(p) < endAt) p++;
    }
    while (p < hi[k] && /^(just|successfully|already|now|also|then|finally|so|ok|and)$/.test(T[p].lw)) p++;
    if (p >= hi[k]) continue;
    if (quoted(p) || hypo(p) || (k > 0 && (reportedAt < at(p) || srcAt < at(p))) || retracted(p)) continue;
    const v = T[p], w = v.lw, nx = T[p + 1];

    // 2. Subjectless lead verbs: "Booked the sale…", "Placing the order now".
    if (isPast(w) && !v.t.includes('-') && !(BASE_SAME.has(w) && !requestIn(k))) {
      const adjectival = nx && !nx.punct && !DETERMINER.has(nx.lw) && !/^[\d$]/.test(nx.t) && !isTicker(nx.t) && !PARTICLE.has(nx.lw)
        && !PREP.has(nx.lw) && !/^(it|them|you|everything|out)$/.test(nx.lw) && !stemIn(w, STRONG);
      const adverbial = nx && PREP.has(nx.lw) && commaSubjAt > nx.a;
      // "sized by target weight", "Hit by the selloff, …": a participle, not an action.
      const passiveLead = (nx?.lw === 'by' && !/^(me|us|signal)$/.test(T[p + 2]?.lw || '')) || (stemIn(w, HARMLESS) && !stemIn(w, TRADE));
      if (!adjectival && !adverbial && !passiveLead) {
        if (nx && BOUNDARY.test(nx.lw) && lo[k + 1] === p + 1) {
          const cls = objClass(T, lo[k + 1] + 1, hi[k + 1], p);
          if (!allowed(w) && (cls === 'owner' || (cls === null && stemIn(w, STRONG)))) return 'lead';
        } else if (actsOnOwner(p, p)) return 'lead';
        else if (k > 0 && T[lo[k]].t === ':' && !allowed(w) && !stemIn(w, HARMLESS) && !UN_HARMLESS.test(w) && !userIn(k) && !attributed
          && T.slice(Math.max(lo[k - 1], lo[k] - 8), lo[k]).some((t, i) => OWNER.has(t.lw) || CHANGE.has(t.lw) || isTicker(t.t))) return 'lead';
        for (let x = p + 1; x < hi[k] - 1 && x < p + 30; x++) {
          if (/^(and|then)$/.test(T[x].lw) && isPast(T[x + 1].lw) && actsOnOwner(x + 1, x + 1)) return 'lead';
        }
      }
    }
    if (isIng(w) && !allowed(w) && progress && !hasFinite(T, p + 1, hi[k])) {
      const cls = objClass(T, p + 1, hi[k], p);
      if (cls === 'owner' || (cls === null && stemIn(w, STRONG))) return 'lead';
    }

    // 3. Terse noun + participle: "Order placed.", "Alert removed.", "Trade
    //    ticket submitted:", "dividend for xeqt logged ✔".
    for (let q = p, owner = false; q < hi[k] && q < p + 7; q++) {
      const t = T[q];
      if (t.punct || NEG_WORD.test(t.lw) || AUX.has(t.lw)) break;
      if (CHANGE.has(t.lw) || ORDERISH.has(t.lw) || nounClass(T, q) === 'owner') { owner = true; continue; }
      if (PREP.has(t.lw) && !(owner && /^(for|of|on|in)$/.test(t.lw))) break;
      const done = /^(done|complete|completed|through)$/.test(t.lw) || (isPast(t.lw) && !PAST_ONLY.has(t.lw) && !allowed(t.lw) && !stemIn(t.lw, HARMLESS));
      if (!done) { if (isPast(t.lw) || isIng(t.lw)) break; continue; }
      const after = T[q + 1];
      const tail = !after || after.punct || /^(at|for|and|successfully|to|from|on|with|via|today|just|now|in)$/.test(after.lw) || /^[\d$]/.test(after.t);
      if (owner && tail && !workDest(T, q + 1, hi[k]) && !userIn(k) && !attributed) return 'lead';
      break;
    }

    // 4. A ticker as the subject: "MU bought: 15 shares", "10 NBIS sold at 101.50".
    let q = p;
    const qty = /^\d[\d,.]*$/.test(T[q].t);
    if (qty) q++;
    const tk = T[q];
    if (tk && (isTicker(tk.t) || (s === s.toLowerCase() && /^[a-z]{2,5}$/.test(tk.t) && !DETERMINER.has(tk.lw) && !PREP.has(tk.lw) && !AUX.has(tk.lw) && !/^(it|they|we|i|you|he|she|who|what|stock)$/.test(tk.lw)))) {
      let r = q + 1;
      if (/^(shares?|sh|units)$/.test(T[r]?.lw || '')) r++;
      const vb = T[r], nn = T[r + 1];
      if (vb && /^(out|in)$/.test(vb.lw) && (qty || /^(shares?|sh|units)$/.test(T[r - 1].lw)) && (nn?.t === '@' || nn?.lw === 'at') && /^[\d$]/.test(T[r + 2]?.t || '')) return 'lead';
      // "… sold at 101.50", "… at market", "… for you"; not "… sold at a loss".
      const n2 = T[r + 2]?.lw || '', n3 = T[r + 3]?.lw || '';
      const priced = nn && (nn.t === ':' || nn.t === '@' || /^[\d$]/.test(nn.t) || (nn.lw === 'for' && /^(you|[\d$])/.test(n2))
        || (nn.lw === 'at' && (/^[\d$]/.test(n2) || /^(market|limit)$/.test(n2) || (n2 === 'the' && /^(open|close|bid|ask|market)$/.test(n3)))));
      if (vb && isPast(vb.lw) && stemIn(vb.lw, TICKER_VERBS) && !/^(off|out|short|back)$/.test(nn?.lw || '')
        && (qty || priced || (isTicker(tk.t) && (!nn || (nn.punct && nn.t !== '-')))) && !userIn(k) && !attributed) return 'lead';
    }
  }

  // A fill in parentheses: "NBIS in your TFSA: 0 (sold at 101.40)".
  for (let j = 0; j < n - 3; j++) {
    if (T[j].t !== '(' || !isPast(T[j + 1].lw) || !stemIn(T[j + 1].lw, STRONG) || allowed(T[j + 1].lw)) continue;
    if ((T[j + 2].t === '@' || T[j + 2].lw === 'at') && /^[\d$]/.test(T[j + 3].t) && !dateIn(cl[j]) && !userIn(cl[j]) && !attributed && !exemptPlain(j)) return 'lead';
  }

  // 5. Something of the owner's was changed or traded: "Your alerts have been
  //    wiped", "your CRWV is sold" (a plain "is" only with a finished result).
  for (let j = 0; j < n; j++) {
    const aw = T[j].lw;
    if (!/^(was|were|is|are|'s|'re|been|got|gets|get|being)$/.test(aw)) continue;
    let k = j + 1, neg = false, eventive = /^(was|were|been|got|gets|get|being)$/.test(aw);
    for (; k < hi[cl[j]]; k++) {
      const x = T[k].lw;
      if (!/^(now|just|already|successfully|also|all|fully|officially|finally|partially|completely|entirely|never|not|still|since|recently|automatically|manually|then|both|each|been|being)$/.test(x) && !/^[a-z]+ly$/.test(x) && !/n't$/.test(x)) break;
      if (NEG_WORD.test(x)) neg = true;
      if (/^(now|just|already|successfully|officially|finally|automatically|manually|been|being)$/.test(x)) eventive = true;
    }
    const pp = T[k];
    if (!pp || neg) continue;
    const pw = pp.lw;
    if (!isPast(pw) && !/^(done|complete)$/.test(pw)) continue;
    if ((allowed(pw) || stemIn(pw, HARMLESS) || UN_HARMLESS.test(pw)) && !/^(down|off)$/.test(T[k + 1]?.lw || '')) continue;
    if (pw === 'split' && /^\s*(?:\w+\s+)?\d+(?:-for-|:|\s+for\s+)\d/.test(s.slice(pp.b))) continue;
    if (!eventive && !(pw === 'set' && T[k + 1]?.lw === 'up') && !stemIn(pw, COMPLETE)) continue;
    const subj = subjectBefore(T, j, lo[cl[j]]);
    if (!subj || subj.neg || subj.modal || subj.third) continue;
    const change = CHANGE.has(subj.headWord) && /^(your|my|the|all|these|those)$/.test(T[subj.start].lw);
    if ((!['owner', 'ticker'].includes(subj.head) || !subj.scoped) && !change && !(eventive && intoRecords(T, k + 1, hi[cl[j]]))) continue;
    if (MARKET_CAUSE.test(s.slice(pp.b, T[hi[cl[j]] - 1].b))) continue;
    if (stemIn(pw, words('sell buy short')) && /^(off|out|short|back)$/.test(T[k + 1]?.lw || '')) continue;
    if (agentAfter(T, k + 1, hi[cl[j]]) || exemptPlain(subj.start) || workDest(T, k + 1, hi[cl[j]])) continue;
    if (corporateAt < at(subj.start)) continue;
    if (stemIn(pw, TRADE) && dateIn(cl[j]) && !requestIn(cl[j])) continue;
    return 'passive';
  }

  // 6. States and events only a trade or an edit would produce.
  for (let j = 0; j < n; j++) {
    const w = T[j].lw, nx = T[j + 1]?.lw || '';
    // "Your new MU alert is in place", "… is live" (a new alert, or "now")
    if (/^(active|live|enabled|armed|in)$/.test(w) && /^(is|are|'s|'re)$/.test(T[j - 1]?.lw || '') && (w !== 'in' || nx === 'place')) {
      const subj = subjectBefore(T, j - 1, lo[cl[j]]);
      if (subj && !subj.neg && !subj.modal && !subj.third && /^alerts?$/.test(subj.headWord) && T.slice(subj.start, subj.core).some((t) => t.lw === 'new') && !exemptPlain(subj.start)) return 'state';
    }
    // "Order's in", "your sell order is working", "goes out now"
    const inProgress = isIng(w) && !allowed(w) && /^('s|is|are|now|still|currently)$/.test(T[j - 1]?.lw || '') && !/^(for|on)$/.test(nx);
    if (ORDER_STATE.has(w) || inProgress) {
      const goes = w === 'out' && /^(goes|go|going|heads|went|gone)$/.test(T[j - 1]?.lw || '');
      let b = j - 1;
      if (!goes) {
        while (b >= 0 && /^(now|already|still|currently|just)$/.test(T[b].lw)) b--;
        if (!/^('s|is|are)$/.test(T[b]?.lw || '')) continue;
        const nn = T[j + 1];
        if (!inProgress && nn && !nn.punct && !/^(for|at|and|now|with|today|already|as|on)$/.test(nn.lw) && !/^[\d$]/.test(nn.t) && !(w === 'in' && nn.lw === 'progress')) continue;
      }
      const subj = subjectBefore(T, goes ? j - 1 : j, lo[cl[j]]);
      if (!subj || subj.neg || subj.modal || subj.third || !ORDERISH.has(subj.headWord)) continue;
      if (T.slice(subj.start, j).some((t) => /^(proposed|proposal|draft|suggested|hypothetical|example)$/.test(t.lw))) continue;
      if (!exemptPlain(subj.start)) return 'state';
    }
    // "The 10 NBIS sale is now in your ledger."
    if (/^(now|already|officially)$/.test(w) && /^(is|are|'s|'re)$/.test(T[j - 1]?.lw || '') && /^(in|on)$/.test(nx) && /^(your|my|the)$/.test(T[j + 2]?.lw || '')
      && /^(ledger|records|history|transactions|log|journal|holdings|portfolio|notes|strategy|thesis|alerts)$/.test(T[j + 3]?.lw || T[j + 4]?.lw || '')) {
      const subj = subjectBefore(T, j - 1, lo[cl[j]]);
      if (subj && !subj.neg && !subj.modal && !subj.third && ['owner', 'ticker'].includes(subj.head) && subj.scoped && !exemptPlain(subj.start)) return 'state';
    }
    // "your USD cash is now 0", "now reads 5,210", "you now hold 0 NBIS"
    if (w === 'now') {
      const pv = T[j - 1]?.lw || '';
      let from;
      if (/^(is|are|'s|'re)$/.test(pv) && (isIng(nx) || isPast(nx)) && !allowed(nx) && !stemIn(nx, HARMLESS) && /^(in|into|at|on)$/.test(T[j + 2]?.lw || '')) {
        const subj = subjectBefore(T, j - 1, lo[cl[j]]);
        if (subj && !subj.neg && !subj.modal && !subj.third && subj.head === 'owner' && STATE.has(subj.headWord) && !exemptPlain(subj.start)) return 'state';
        continue;
      }
      if (/^(is|are|'s|'re)$/.test(pv)) from = j + 1;
      else if (/^(reads|shows|holds|sits|stands|equals|totals|hold|own|have)$/.test(nx) || (/^[a-z]{3,}[^s]s$/.test(nx) && (!allowed(nx) || stemIn(nx, words('fire trigger'))) && nx !== 'trades')) from = j + 2 + (T[j + 2]?.lw === 'at' ? 1 : 0);
      else continue;
      const val = T.slice(from, from + 4);
      if (val.some((t) => /%/.test(t.t) || /^(worth|valued|up|down|higher|lower|weighted|percent|underwater)$/.test(t.lw))) continue;
      if (!val.some((t) => /\d/.test(t.t) || /^(zero|nothing|empty|closed|gone|active|live|enabled|on|flat|none|no)$/.test(t.lw))) continue;
      if (pv === 'you' && /^(hold|own|have)$/.test(nx)) {
        if (!exemptPlain(j - 1)) return 'state';
        continue;
      }
      const subj = subjectBefore(T, /^(is|are|'s|'re)$/.test(pv) ? j - 1 : j, lo[cl[j]]);
      if (!subj || subj.neg || subj.modal || subj.third || subj.head !== 'owner' || !STATE.has(subj.headWord) || !subj.scoped) continue;
      if (!exemptPlain(subj.start)) return 'state';
    }
    // "… as we speak"
    if (w === 'as' && nx === 'we' && T[j + 2]?.lw === 'speak') {
      const a = Math.max(lo[cl[j]], j - 30), toks = T.slice(a, j);
      if (toks.some((t, i) => ['owner', 'ticker'].includes(nounClass(T, a + i))) && !toks.some((t) => NEG_WORD.test(t.lw)) && !hypo(j) && !quoted(j)) return 'state';
    }
    // "the SOXL order filled", "your sale went through", "the sale was successful"
    const through = /^(went|gone)$/.test(w) && nx === 'through';
    const success = /^(successful|final|through)$/.test(w) && /^(was|is|were|are|'s)$/.test(T[j - 1]?.lw || '');
    if (through || success || (isPast(w) && !allowed(w) && !stemIn(w, HARMLESS) && !/^(was|were|is|are|'s|'re|been|be|being|got|get)$/.test(T[j - 1]?.lw || ''))) {
      const subj = subjectBefore(T, j, lo[cl[j]]);
      if (!subj || subj.neg || subj.modal || subj.third || !ORDERISH.has(subj.headWord) || !subj.scoped) continue;
      if (!exemptPlain(subj.start)) return 'state';
    }
    // Terse "sell 100 SOXL, executed."
    if (T[j].t === ',' && TERSE_END.has(nx)) {
      const after = T[j + 2];
      if (after && !after.punct && !/^[\d$]/.test(after.t) && !/^(at|today|successfully|in|on|for)$/.test(after.lw)) continue;
      const toks = T.slice(Math.max(lo[cl[j]], j - 30), j);
      if (toks.some((t) => isTicker(t.t) || ORDERISH.has(t.lw) || /^(sh|shares)$/.test(t.lw))
        && !toks.some((t) => NEG_WORD.test(t.lw) || /^(proposed|proposal|draft|would|if|could|scenario|hypothetical)$/.test(t.lw)) && !exemptPlain(j)) return 'terse';
    }
  }
  return null;
}

// A finite verb after a gerund makes it the subject ("Selling half leaves
// you…", "selling 20 at market raises about…"), not an action in progress.
function hasFinite(T, from, to) {
  for (let i = from; i < to; i++) {
    const t = T[i];
    if (FINITE.test(t.lw)) return true;
    const prev = T[i - 1], next = T[i + 1];
    if (/^[a-z]{3,}[^s]s$/.test(t.t) && !/(ss|us|is)$/.test(t.lw) && !OWNER.has(t.lw) && !WORK.has(t.lw) && prev && !prev.punct
      && !DETERMINER.has(prev.lw) && !/^\d/.test(prev.t) && next && (DETERMINER.has(next.lw) || /^[\d$]/.test(next.t) || /^(about|roughly|around|you|it|them|up|down)$/.test(next.lw))) return true;
  }
  return false;
}

// "… saved to your strategy notes", "… added into your ledger"
function intoRecords(T, from, end) {
  for (let x = from; x < end && x < from + 8; x++) {
    if (T[x].punct) return false;
    if (/^(to|into|in|onto)$/.test(T[x].lw) && /^(your|my)$/.test(T[x + 1]?.lw || '')) {
      for (let y = x + 2; y < end && y < x + 6 && !T[y].punct && !PREP.has(T[y].lw); y++) {
        if (/^(notes|strategy|ledger|records|history|transactions|holdings|alerts|journal|log|portfolio|watchlist)$/.test(T[y].lw)) return true;
      }
    }
  }
  return false;
}

// "by funds", "by the rally": someone else did it ("by 5 shares", "by me" are not agents).
function agentAfter(T, from, end) {
  for (let x = from; x < end && x < from + 7; x++) {
    if (T[x].punct) return false;
    if (T[x].lw !== 'by') continue;
    const nx = T[x + 1];
    if (!nx || /^(me|us|myself|ourselves|signal|half|about|roughly|around|nearly|another)$/.test(nx.lw)) return false;
    if (nx.lw === 'the' && /^(app|assistant)$/.test(T[x + 2]?.lw || '')) return false;
    if (T.slice(x + 1, x + 4).some((t) => /[\d$%]/.test(t.t))) return false;
    return true;
  }
  return false;
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
