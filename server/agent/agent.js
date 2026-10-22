// Ask Signal Desk: conversation storage and the tool-use loop.
//
// Each question runs a fresh, append-only exchange with the model:
//   [earlier questions + short answers as plain text] + [current question with
//   time/page/scenario context] -> tool calls -> tool results -> submit_answer.
// Earlier turns are passed only as text, so every answer is grounded in data
// fetched for *this* question rather than conversational memory.
import { nowIso } from '../db.js';
import { sessionAt } from '../calendar.js';
import { formatNy } from '../time.js';
import { log } from '../log.js';
import { computePortfolio } from '../portfolio.js';
import { Ledger } from './ledger.js';
import { createToolbox, runTool, toolsForApi, ANSWER_CATEGORIES } from './tools.js';
import { SYSTEM_PROMPT, turnHeader } from './prompt.js';
import { recordUsage, budgetCheck, reserveSpend, BackendError, usableContent } from './backend.js';
import { listProposals, checkUserIntent } from './proposals.js';
import { guardText, findClaims, sentenceSpans } from './guard.js';
import { TRADE_STATUS } from './ledger.js';

export { guardText };

const MAX_RESULT_CHARS = 24000;
const PRIOR_TURNS = 6;

// ---------- conversation storage ----------

export function createConversation(db, title) {
  const t = nowIso();
  const r = db.prepare('INSERT INTO chat_conversations (title, created_at, updated_at) VALUES (?,?,?)').run(String(title || 'New conversation').slice(0, 120), t, t);
  return Number(r.lastInsertRowid);
}

export function listConversations(db) {
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS questions
                     FROM chat_conversations c ORDER BY c.updated_at DESC LIMIT 100`).all();
}

export function getConversation(db, id) {
  const c = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id);
  if (!c) return null;
  const messages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(id).map(messageOut);
  return { ...c, messages, proposals: listProposals(db, id) };
}

export function deleteConversation(db, id) {
  db.prepare('DELETE FROM chat_proposals WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
  return db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id).changes > 0;
}

// One question at a time per conversation (a second tab or a double submit
// would otherwise interleave two tool loops on the same history).
export function isConversationBusy(ctx, id) {
  return !!ctx.chatBusy?.has(Number(id));
}

function messageOut(m) {
  return {
    id: m.id, role: m.role, text: m.text, status: m.status, error: m.error, model: m.model, createdAt: m.created_at,
    answer: m.answer_json ? JSON.parse(m.answer_json) : null,
    ledger: m.ledger_json ? JSON.parse(m.ledger_json) : [],
    tools: m.tools_json ? JSON.parse(m.tools_json) : [],
    scenarios: m.scenarios_json ? JSON.parse(m.scenarios_json) : [],
    pageContext: m.page_context_json ? JSON.parse(m.page_context_json) : null,
    usage: m.usage_json ? JSON.parse(m.usage_json) : null,
  };
}

// ---------- output guards ----------
// The trade-claim guard lives in guard.js; validateAnswer applies it to every
// answer field.

// Follow-up suggestions are sent as the user's own words when clicked, so one
// phrased as an instruction ("Record that I sold 10 VRT at 98") would satisfy
// the proposal intent check without the user having said it. Drop those.
// A hyphenated word ("Short-term", "Sell-side", "Add-on") is not an instruction.
const ACTION_START = /^\W*(?:please\s+)?(?:record|log|add|set|update|change|remove|delete|save|enter|create|put|mark|note|sell|buy|trim|purchase|short|place|execute|exit|liquidate|confirm|apply|cancel)\b(?!-)|\b(?:for me|on my behalf)\b/i;
const CHANGE_TYPES = ['add_transaction', 'set_cash', 'add_price_alert', 'update_alert_threshold', 'set_strategy', 'remove_price_alert'];
export function unsafeFollowUp(text) {
  const f = String(text || '');
  // Each sentence is checked on its own, since a model may quote just one
  // ("What is my cash now? Log my sale of 100 NBIS at 1.00 in TFSA today.").
  // Unsafe if one starts like an instruction or would pass as an explicit
  // request ("Can you record that I sold 10 VRT at 129.50?").
  const parts = [f, ...f.split(/(?<=[.!?])\s+|\n+/)].map((s) => s.trim()).filter(Boolean);
  return parts.some((s) => ACTION_START.test(s) || CHANGE_TYPES.some((changeType) => checkUserIntent(f, s, { changeType, details: {} }) === null));
}

const MUST_CITE = ['portfolio_record', 'external_fact', 'reported_claim', 'calculation'];
const isReported = (item) => !!item && ((item.kind === 'news' && item.note !== 'confirmed') || item.kind === 'archived_report');
const isArchived = (item) => item?.kind === 'archived_report';
// stale / unknown / missing quote or history, or a quote that can no longer update (no provider).
function staleState(item) {
  if (item?.kind !== 'market_data') return null;
  if (['stale', 'unknown', 'missing'].includes(item.freshness)) return item.freshness;
  return item.updating === false ? 'not_updating' : null;
}
const mentions = (text, sym) => !!sym && new RegExp(`(^|[^A-Za-z0-9])${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(text);
// A model-written gap about an instrument's data: it says the data is out of
// date, or it is about the instrument's quote, price or market data.
const STALE_WORDS = /\bstale\b|out[- ]of[- ]date|\boutdated\b|\bdelayed\b|\bas of\b|\bnot (?:been )?(?:updated|refreshed)\b|n['’]t (?:been )?(?:updated|refreshed)\b|\bundated\b|\btimestamp|\b(?:minutes?|hours?|days?) (?:old|ago|behind)\b|\bquotes?\b|\bprices?\b(?! targets?)|\bpricing\b|\b(?:market|price|quote|trading) data\b/i;
// Statements about prices, holdings or the market rather than about the app
// ("the Positions page lists everything you hold", "your portfolio is stored
// locally" and "the model declined to answer" are about the app).
const MARKET_TALK = /\b(?:fell|rose|(?<!\b(?:was|were|been|be|is|are|gets?|got) )dropped|gained|rallied|slumped|surged|plunged|jumped|climbed|declined(?! to\b)|tumbled|soared|sank|sell-?off|main drag|drag(?:ged|ging)|outperform\w*|underperform\w*|overweight|underweight|(?<!\b(?:everything|anything|what|whatever|all|which|that) )you (?:hold|own)|you(?:['’]re| are) (?:\w+ )?(?:up|down|long|short|concentrated|exposed)|your (?:\w+ ){0,2}(?:portfolio|positions?|holdings?|stakes?|cash|exposure|allocation) (?:is|are|was|were|has|have|looks?|seems?|remains?|leans?)(?! (?:(?:only|never|not|always|also) )?(?:stored|saved|kept|entered|shown|listed|computed|calculated|recorded|loaded|backed|exported|imported|encrypted|sent|edited|read|held locally|local)\b)|(?:market|stocks?|shares|index|sector) (?:is|are|was|were) (?:up|down|higher|lower|flat))\b/i;
// Clarifying questions, refusals and what the app cannot do state no facts.
const NOT_A_FACT = /\b(?:cannot|can['’]?t|can not|unable to|no brokerage|(?:is|are) not (?:tracked|supported|covered|available|stored))\b/i;
const statements = (text) => text.split(/(?<=[.!?])\s+|\n+/).filter((s) => !/\?\W*$/.test(s))
  .flatMap((s) => s.split(/;\s+|,?\s+(?:but|while|although|though|whereas|so|because|since)\s+|,\s+and\s+/i)).filter((c) => !NOT_A_FACT.test(c)).join('\n');
// Numbered steps ("1. Open Positions", "Step 2: …") are not figures.
const STEP_NUMBER = /(?:^|[\n.!?:;]\s*)\d{1,2}[.)]\s|\bstep \d+\b/gi;

// Company names an answer may use instead of a ticker ("Vertiv" for VRT): the
// stored or catalog name without its legal suffix ("Capital One Financial"),
// and its first word when that is distinctive ("Marvell"). An ordinary first
// word takes the next with it ("Capital One", "First Quantum", "Bank of
// Montreal"); a fund family never stands alone ("iShares"); and a name that
// another instrument's name contains ("Vanguard S&P 500" in "Vanguard S&P 500
// Index ETF") is not used.
const NAME_SUFFIX = /\s+(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc|n\.?v|s\.?a|ag|se|llc|l\.?p|holdings?|group|trust|etf|fund|index|portfolio|shares|class [a-z])\.?$/i;
const COMMON_WORD = /^(?:first|american|canadian|global|general|national|united|international|royal|bank|advanced|applied|digital|western|eastern|northern|southern|new|trade|open|capital|best|core|select|total|true|home|great|north|south|east|west|central|pacific|atlantic|energy|power|public|park|life|health|data|cash|market|check|block|target|simple|smart|real|prime|premier|golden|gold|silver|blue|green|red|black|white|sun|star|air|sky|live|liberty|summit|alpha|all|one|world|cross|key|main|peak|union|federal|state|city|standard|universal|super|ultra|daily|direct|service|intuitive|constellation|taiwan|china|japan|india|texas)$/i;
const FUND_FAMILY = /^(?:ishares|vanguard|proshares|invesco|direxion|vaneck|spdr|schwab|fidelity|bmo|horizons|harvest|hamilton|evolve|purpose|wisdomtree|ark|franklin|jpmorgan|dimensional|cibc|td|rbc|mackenzie)$/i;
function cleanName(n) {
  let s = String(n || '').replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/^the\s+/i, '').replace(/\s+/g, ' ').trim();
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(NAME_SUFFIX, '').trim(); }
  return s;
}
function companyNames(ctx, sym) {
  if (!sym) return [];
  const named = [
    ...ctx.db.prepare('SELECT symbol, name, exchange FROM instruments').all().flatMap((i) => [[i.symbol, i.name], [i.symbol, ctx.catalog?.lookup(i.symbol, i.exchange)?.name]]),
    ...(ctx.catalog?.all() || []).map((e) => [e.symbol, e.name]),
  ].filter(([, n]) => n);
  const others = named.filter(([s]) => s !== sym).map(([, n]) => n);
  const own = named.filter(([s]) => s === sym).flatMap(([, n]) => {
    const full = cleanName(n);
    const w = full.split(' ');
    if (w.length < 2 || FUND_FAMILY.test(w[0])) return [full];
    return [full, COMMON_WORD.test(w[0]) ? w.slice(0, w[1] === 'of' ? 3 : 2).join(' ') : w[0]];
  });
  return [...new Set(own)].filter((x) => x.length > 2 && x !== sym && !others.some((o) => mentions(o, x)));
}

// ---------- trade statements must match trade records ----------
// A statement about a specific trade or order may state its status only
// through a record that carries it (ledger.js TRADE_STATUS, set by the tools
// that read the record, never by the model). There are no BROKER-CONFIRMED
// records, and the guard (guard.js) still removes every claim that the
// assistant or the app traded.
//
// A sentence describes a specific trade when it has an anchor:
// - a past trade verb (bought, sold, purchased, trimmed, shorted, liquidated,
//   exited, offloaded, unloaded, dumped, acquired) with a ticker or quantity
//   after it ("sold 10 VRT", "bought 20% of NBIS", "sold 10 shares"), whose
//   actor is the owner ("you"), the assistant or app, an account, the
//   simulated account, strategy or backtest, nobody ("Simulated fill: bought
//   120 NVDA", "Oct 3: sold 10 NBIS"), or a passive on the owner's shares or a
//   stated quantity ("your VRT was sold", "10 VRT were sold"). Other actors
//   and bare passives are market or company narrative ("Insiders sold 10,000
//   shares", "CRWV was dumped across the sector"), as are "sold off", "bought
//   back" and "bought up";
// - a trade noun bound to a ticker: "sale / purchase / order / trade / fill /
//   buy of|for 10 VRT", "the VRT sale", or a ledger-style "SELL 10 VRT"; a
//   plural ("orders for 15 MU") only with a scope ("your", "simulated",
//   "proposed", "pending"…). Not a third party's ("its sale", "Vertiv's order
//   backlog", "a sale of 10,000 NBIS by a director"), a rating or signal ("a
//   VRT buy rating") or a number without shares or a ticker ("a purchase of
//   100 MW").
// Not anchors: questions, quoted text ("Say 'record that I sold 10 VRT'"),
// anything after a condition ("If you sold…", "Suppose…") or after someone
// else's words ("The post claims your VRT was sold"), and an anchor under a
// negation ("you never sold", "no sale of 10 VRT") or a modal ("would have
// sold"). A trade noun in advice or a plan ("a sale of 10 VRT would…",
// "you'd enter BUY 12 NVDA at your broker") states a status only with a
// status word.
//
// Status words, per sentence: PROPOSED ("proposed", "proposal", "pending /
// awaiting your confirmation"; not an offer, "I can prepare a proposal", nor a
// proposal already confirmed, which is now a USER-REPORTED record), SIMULATED
// ("simulated", "backtest", "hypothetical", "scenario", "on paper", "paper
// account", "Strategy Lab", "what-if", "forward test"), USER-REPORTED (the
// owner as actor, "you sold 10 VRT", unless it is reported speech, "you said
// you sold…", or after a hypothetical frame, "in scenario S1 you sold…", which
// reads as SIMULATED; and, when the sentence has no other status word, the
// owner's records: "your VRT sale", "SELL 10 VRT", "recorded", "in your
// records"). A status word under a negation ("no proposal", "not simulated")
// states nothing; a sentence saying the trade did not happen or is not
// recorded ("no record of…", "hasn't happened", "nothing was sold") states no
// USER-REPORTED trade.
//
// Checks. The short answer is checked against every trade record retrieved
// this turn; a detail against the records it cites:
// (1) each stated status needs a record of that status for the same ticker
//     (and, for USER-REPORTED and PROPOSED, the same side: a sale needs a SELL
//     record; a purchase a BUY or BASELINE one). A SIMULATED record without a
//     ticker (a backtest run, a multi-leg scenario) covers any ticker;
// (2) a detail describing a trade with no status word must cite at least one
//     trade record, unless it says the trade did not happen or is not recorded;
// (3) wording that a broker confirmed, filled or executed a trade
//     ("broker-confirmed", "filled at your broker", "your broker confirmed")
//     is removed in every answer field, unless negated or conditional in its
//     clause ("nothing here is broker-confirmed", "once your broker confirms").
// A failing detail is replaced by a data-gap notice; a failing sentence of the
// short answer (or, for (3), of another field) by the notice in brackets.
// Measured on the 551 sentences of tests/fixtures/guard-corpus.json that pass
// the guard: 68 trigger these checks, every one a statement about a specific
// recorded, proposed or simulated trade; none is market or third-party
// narrative. That corpus was used to tune these rules, so it is not a measure
// of how they generalise.
export const TRADE_REMOVED = 'A statement about a trade was removed because no record backs it.';
export const BROKER_REMOVED = 'A statement saying a broker confirmed or filled a trade was removed: Signal Desk has no broker connection, so no record is broker-confirmed.';

const { PROPOSED, SIMULATED, USER_REPORTED } = TRADE_STATUS;
const TRADE_TOKEN = /\d{1,2}:\d{2}|\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\$?\d+(?:\.\d+)?%?|[A-Za-z][A-Za-z0-9'’&.-]*[A-Za-z0-9]|[A-Za-z]|[,;:()?!—–"]|\s-\s/g;
const tradeTokens = (s) => [...s.matchAll(TRADE_TOKEN)].map((m) => { const w = m[0].trim(); return { w, lw: w.toLowerCase().replace(/’/g, "'"), at: m.index }; });
const BOUNDARY_TOKEN = /^(?:[,;:()?!—–"]|-)$/;
const baseWord = (lw) => lw.replace(/'(?:ve|d|re|ll|s|m)$/, '');
const tset = (s) => new Set(s.split(/\s+/).filter(Boolean));
const PAST_TRADE_VERB = tset('bought sold purchased trimmed shorted liquidated exited offloaded unloaded dumped acquired');
const SELL_SIDE = tset('sold trimmed shorted liquidated exited offloaded unloaded dumped sale sell sells');
const BUY_SIDE = tset('bought purchased acquired purchase purchases buy buys');
const TRADE_NOUN_OF = tset('sale purchase buy sell trade order fill trades orders fills purchases buys sells');
const TRADE_NOUN_AFTER_TICKER = tset('sale purchase trade order fill trades');
// A trade noun in advice or a plan ("a sale of 10 VRT would…", "place an order for…") states no status by itself.
const ADVICE_CLAUSE = /\b(?:would|could|might|may|should|will|can|shall|(?:want|wants|plan|plans|going|need|needs|have|has) to)\b|['’](?:d|ll)\b|^\W*(?:place|consider|enter|submit|set|put|make|try|use|open|avoid|skip|cancel)\b/i;
const NOT_TRADE_AFTER = tset('rating ratings recommendation recommendations signal signals side zone point points case backlog backlogs book books growth intake flow flows volume volumes pipeline program programme alert alerts setup setups rule rules price prices target targets window plan plans idea ideas thesis value values data history size sizes level levels agreement agreements contract contracts deal deals');
const TRADES_AS_VERB = tset('at around near above below higher lower up down flat sideways hands between in on with');
const OBJECT_STOP = tset('at for on in near around above below with after before because to from through via by when and but or so as while since into during between than which that who where if once until last this yesterday today');
const QTY_WORD = /^(?:all|half|another|both|everything|rest|remaining|entire|whole|most|part|third|quarter|portion)$/;
const NUMBER = /^\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?$|^\$?\d+(?:\.\d+)?%?$/;
const SHARES_WORD = /^(?:shares?|units?|contracts?)$/;
const ACTOR_AUX = tset("have has had 've 'd just already also then recently previously actually did originally initially later first finally both all each earlier ultimately partly today yesterday successfully");
const ACTOR_MODAL = tset("would could should might may must will 'll can shall to gonna");
const PASSIVE_AUX = tset('was were been being got get is are be');
const ACCOUNT_WORD = tset('account accounts portfolio book tfsa rrsp resp fhsa rrif lira margin');
const SIM_ACTOR = tset('strategy backtest engine lab simulation sim system rules');
const ASSISTANT_ACTOR = tset('i we desk app assistant');
const SIM_NP = /^(?:simulated|simulation|paper|hypothetical|demo|lab|sim|test|mock|backtest|backtested|scenario)$/;
const THIRD_PARTY = /^(?:its|their|his|her|they|it|he|she|insiders?|insider|funds?|ceo|cfo|coo|directors?|executives?|investors?|traders?|institutions?|institutional|company|companies|firm|someone|somebody|people|whales?|analysts?|shareholders?|holders?|management|founders?|chair\w*|officers?|ark|berkshire|nobody)$/;
const isNegation = (lw) => /^(?:no|not|never|none|nothing|neither|nor|without|cannot)$/.test(lw) || /n't$/.test(lw);
const NOT_TICKER = tset(`AM PM ET EST EDT UTC GMT USD CAD US USA UK EU TFSA RRSP RESP FHSA LIRA RRIF RDSP IRA HSA CELI REER CRI FERR ETF ETFS AI CEO CFO COO CTO
  IPO EPS GPU GPUS CPU API FX BOC NYSE NASDAQ TSX TSXV ARCA CBOE OTC ADR OK NO ID PL PNL ATR SMA EMA RSI MACD YTD QTD MTD YOY QOQ TTM NAV MER DRIP ACB SEC
  CSV PDF AUM GAAP LLC INC LTD PLC CORP BUY SELL BASELINE DEPOSIT WITHDRAWAL DIVIDEND FEE FEES PROPOSED SIMULATED USER REPORTED BROKER CONFIRMED NOTE OR AND
  THE IN ON AT TO OF BY IS IT AN AS BE DO IF MY UP SO WE ME HE VS MW GW KW TWH MWH FY HOLD TRIM WAIT ADD DEMO SYNTHETIC NOT ALL RR TV IR PR ESG ROI ROE FCF
  EBITDA CAGR DCF PE EV CAPEX OPEX HBM DRAM NAND LLM LLMS HPC DC KPI`);
const TICKER_SHAPE = /^[A-Z]{2,5}(?:\.[A-Z]{1,2})?$/;
// Before the anchor, in its sentence: a condition makes it hypothetical; a
// scenario frame makes the owner's "you sold" a simulated statement.
const CONDITION = /\b(?:if|suppose|supposing|assum(?:e|ing)|imagine|whether|unless|were you to|had you|should you|in case|what if)\b/i;
const HYPO_FRAME = /\b(?:in|under|for|with|within) (?:the |this |that |a |an |your |my |our )?(?:(?!real\b|actual\b)[\w-]+ ){0,2}?(?:scenarios?|simulations?|backtests?|back-tests?|hypotheticals?|what-ifs?|examples?|illustrations?|sketch(?:es)?|projections?|models?|sandbox|paper (?:accounts?|portfolios?|trading|books?)|strategy lab|lab|sim)\b|\bon paper\b|\bscenario S\d+\b/i;
// Someone else's words before the anchor ("The post claims your VRT was sold").
const REPORTED_BY_OTHER = /\b(?:it|they|he|she|someone|somebody|(?:the|this|that|a|an|one|your)\s+(?:[\w-]+\s+)?(?:post|item|article|update|message|text|note|blog|site|website|headline|source|story|report|tweet|thread|comment|email|e-mail|forum|alert|payload|newsletter|video|screenshot|filing|analyst|rumou?r|advisor|adviser|friend|broker))\s+(?:\w+\s+){0,2}?(?:claims?|claimed|asserts?|asserted|alleges?|alleged|says?|said|states?|stated|asks?|asked|tells?|told|instructs?|instructed|wants?|wanted|demands?|demanded|suggests?|suggested|urges?|urged|insists?|insisted|writes|wrote)\b/i;
// Quoted text is material or an example, not a statement ("Say 'record that I sold 10 VRT'").
const QUOTED_TEXT = /"[^"]{3,}"|«[^»]{3,}»|(?<![\w'])'(?=\S)(?:[^']|\b'\b)*?[^\s']'(?![\w'])/g;
// A plural trade noun is a specific trade only with a scope ("your orders for 15 MU", "the simulated trades in NVDA").
const PLURAL_SCOPE = /^(?:your|my|simulated|proposed|hypothetical|paper|backtest|backtested|sim|pending)$/;
const OWNER_SPEECH = /\byou\s+(?:\w+\s+)?(?:said|told me|mentioned|wrote|reported|stated|noted|indicated|claimed|say|says)\b/i;
const PROPOSED_WORDS = /\bproposed\b|\bproposals?\b|\bpending (?:your )?(?:confirmation|approval)\b|\b(?:awaits|awaiting|needs|requires) (?:your )?(?:confirm|confirmation|approval)\b/i;
// Not a proposal awaiting confirmation: a negation, an offer ("I can prepare a
// proposal"), or a proposal already confirmed, which is now a USER-REPORTED record.
const NOT_PROPOSED = /\b(?:no|not|never|nothing|without)\s+(?:\w+\s+){0,2}?(?:proposed|proposals?)\b|n['’]t\s+(?:\w+\s+){0,2}?(?:proposed|proposals?)\b|(?:\b(?:can|could|would|will|may|might|shall|to)|['’]ll)\s+(?:\w+\s+){0,2}?(?:proposals?)\b|\b(?:confirmed|accepted|approved)\s+(?:\w+\s+)?proposals?\b|\bproposals?\s+(?:that\s+)?you\s+(?:confirmed|accepted|approved)\b/i;
const SIM_WORDS = /\bsimulat\w*|\bback-?test\w*|\bhypothetical\w*|\bscenarios?\b|\bwhat-if\b|\bforward[- ]test\w*|\bpaper (?:account|trade|trades|trading|portfolio|book)\b|\bon paper\b|\bstrategy lab\b|\blab account\b/i;
const NOT_SIM = /\b(?:no|not|never|nothing|isn['’]t|wasn['’]t|aren['’]t|weren['’]t)\s+(?:a |an |the |any )?(?:simulat|back-?test|hypothetical|scenario|paper)/i;
const RECORD_WORDS = /\brecorded\b|\bin your (?:records|ledger|transactions|transaction history|history)\b|\byour (?:records|ledger|transaction history) (?:shows?|lists?|has|have|includes?)\b|\b(?:according to|per) your (?:records|ledger|transactions)\b|\bon record\b/i;
const ABSENCE = /\b(?:no|not|never|nothing|none|without)\s+(?:[\w'’-]+\s+){0,3}?(?:record(?:ed|s)?|entered|logged|stored|saved|in your (?:records|ledger|transactions|history))\b|n['’]t\s+(?:[\w'’-]+\s+){0,3}?(?:record(?:ed|s)?|entered|logged|stored|saved|in your (?:records|ledger|transactions|history))\b|\bmissing from\b|\bnot found\b|\bno (?:such )?(?:trade|transaction|sale|purchase|order)s?\b|\b(?:has|have|had|did|was|were)(?:n['’]t| not)\s+(?:yet\s+|actually\s+|really\s+)?(?:happen(?:ed)?|gone through|go through|fill(?:ed)?|execut(?:e|ed)|take place|taken place|been (?:placed|filled|executed|made))\b|\bnothing (?:was|has been|got) (?:sold|bought|traded|placed|filled|executed|recorded)\b/i;
const BROKER_WORDS = /\bbroker[- ]?confirm\w*|\b(?:confirmed|verified|filled|executed|settled)\s+(?:by|with|at|through|via)\s+(?:your\s+|the\s+)?broker(?:age)?\b|\b(?:your|the)\s+broker(?:age)?(?:['’]s)?\s+(?:(?:has|have|had|just|already)\s+)*(?:confirmed|filled|executed|settled|verified)\b|\bconfirm(?:ation|ed) from (?:your |the )?broker(?:age)?\b/i;
const CLAUSE_SPLIT = /[,;:()—–]|\s-\s/;

// Wording that a broker confirmed or filled a trade, outside a negated or
// conditional clause.
function brokerClaim(sentence) {
  if (/\?\s*$/.test(sentence)) return false;
  return sentence.split(CLAUSE_SPLIT).some((c) => BROKER_WORDS.test(c)
    && !tradeTokens(c).some((t) => isNegation(t.lw)) && !/\b(?:if|once|when|whenever|after|until|unless|before|whether)\b/i.test(c));
}

// The anchors of a sentence: { actor ('owner' | 'sim' | 'neutral'), syms, side,
// ownerish (the owner's own record form), advice (a plan or advice clause) }.
function tradeAnchors(sentence, { isTicker, symbolsNamed }) {
  const quoted = [...sentence.matchAll(QUOTED_TEXT)].map((m) => [m.index, m.index + m[0].length]);
  const T = tradeTokens(sentence).filter((t) => !quoted.some(([a, b]) => t.at >= a && t.at < b));
  const out = [];
  const tick = (t) => (t && isTicker(t.w) ? t.w : null);
  const clauseStart = (i) => { let j = i - 1; while (j >= 0 && !BOUNDARY_TOKEN.test(T[j].w)) j--; return j + 1; };
  const clauseEnd = (i) => { let j = i + 1; while (j < T.length && !BOUNDARY_TOKEN.test(T[j].w)) j++; return j; };
  // Anchors after a condition are hypothetical; "you" after a scenario frame is simulated.
  const condAt = sentence.search(CONDITION);
  const framed = (i) => HYPO_FRAME.test(sentence.slice(0, T[i].at));
  const reportedBefore = (i) => REPORTED_BY_OTHER.test(sentence.slice(0, T[i].at));
  // A ticker or quantity right after position i ("10 VRT", "20% of NBIS", "10 shares").
  const object = (i, max, sharesOnly = false) => {
    const syms = [], seen = [];
    let qty = false;
    for (let j = i + 1; j < T.length && j <= i + max; j++) {
      const t = T[j];
      if (BOUNDARY_TOKEN.test(t.w) || OBJECT_STOP.has(t.lw)) break;
      seen.push(t.w);
      if (tick(t)) syms.push(t.w);
      else if (sharesOnly ? SHARES_WORD.test(t.lw) : NUMBER.test(t.w) || QTY_WORD.test(t.lw)) qty = true;
    }
    if (!syms.length) syms.push(...symbolsNamed(seen.join(' ')));
    return { syms, qty };
  };
  const negatedBefore = (i, n = 3) => T.slice(Math.max(clauseStart(i), i - n), i).some((t) => isNegation(t.lw));
  const thirdParty = (i, n = 3) => T.slice(Math.max(clauseStart(i), i - n), i).some((t) => THIRD_PARTY.test(t.lw) || (/['’]s$/.test(t.lw) && !/^(?:your|you|it)['’]s$/.test(t.lw)));
  const ownedBefore = (i, n = 3) => T.slice(Math.max(clauseStart(i), i - n), i).some((t) => t.lw === 'your' || t.lw === 'my');
  const byOther = (from) => { const e = clauseEnd(from); for (let j = from; j < e - 1; j++) if (T[j].lw === 'by' && !/^(?:you|yourself)$/.test(T[j + 1].lw)) return true; return false; };
  const sideOf = (lw) => (SELL_SIDE.has(lw) ? 'SELL' : BUY_SIDE.has(lw) ? 'BUY' : null);
  const advice = (i) => ADVICE_CLAUSE.test(T.slice(clauseStart(i), clauseEnd(i)).map((t) => t.w).join(' '));
  for (let i = 0; i < T.length; i++) {
    const { w, lw } = T[i];
    if (condAt >= 0 && T[i].at > condAt) break;
    if (reportedBefore(i)) break;
    // Past trade verb.
    if (PAST_TRADE_VERB.has(lw)) {
      if (/^(?:off|back|up)$/.test(T[i + 1]?.lw || '')) continue;
      const cs = clauseStart(i);
      let j = i - 1, stop = false;
      for (; j >= cs; j--) {
        const x = T[j].lw;
        if (isNegation(x) || ACTOR_MODAL.has(x)) { stop = true; break; }
        if (!ACTOR_AUX.has(x)) break;
      }
      if (stop) continue;
      const obj = object(i, 7);
      const subj = j >= cs ? T[j] : null;
      if (subj && /['’](?:d|ll)$/.test(subj.lw)) continue; // "you'd have sold", "we'll have bought"
      const b = subj ? baseWord(subj.lw) : null;
      let actor = null, syms = obj.syms, ownerish = false;
      if (!subj) { actor = 'neutral'; ownerish = true; }
      else if (b === 'you') {
        actor = OWNER_SPEECH.test(sentence) ? 'neutral' : framed(i) ? 'sim' : 'owner';
      } else if (ASSISTANT_ACTOR.has(b)) { actor = framed(i) ? 'sim' : 'neutral'; ownerish = actor === 'neutral'; }
      else if (ACCOUNT_WORD.has(b)) {
        const np = T.slice(cs, j);
        if (np.some((t) => THIRD_PARTY.test(t.lw))) continue;
        if (np.some((t) => SIM_NP.test(t.lw))) actor = 'sim';
        else { actor = 'neutral'; ownerish = true; }
      } else if (SIM_ACTOR.has(b)) actor = 'sim';
      else if (PASSIVE_AUX.has(b)) {
        const np = T.slice(cs, j);
        if (byOther(i) || np.some((t) => isNegation(t.lw) || THIRD_PARTY.test(t.lw) || (/['’]s$/.test(t.lw) && !/^your['’]s$/.test(t.lw)))) continue;
        const npSyms = np.filter((t) => tick(t)).map((t) => t.w);
        const npQty = np.some((t) => NUMBER.test(t.w) || QTY_WORD.test(t.lw));
        // Only the owner's shares or a stated quantity ("your VRT", "10 VRT were sold"); a bare
        // "CRWV was dumped" or "a large block of SPY was bought" is market narrative.
        if (!npQty && !obj.qty && !np.some((t) => t.lw === 'your' || t.lw === 'my')) continue;
        if (!npSyms.length && !npQty && !obj.syms.length && !obj.qty) continue;
        syms = [...new Set([...npSyms, ...obj.syms])];
        actor = np.some((t) => SIM_NP.test(t.lw)) ? 'sim' : 'neutral';
        ownerish = actor === 'neutral';
        out.push({ actor, syms, side: sideOf(lw), ownerish });
        continue;
      } else continue;
      if (!obj.syms.length && !obj.qty) continue;
      out.push({ actor, syms, side: sideOf(lw), ownerish });
      continue;
    }
    // Ledger-style "SELL 10 VRT" / "BUY 15 MU".
    if (w === 'SELL' || w === 'BUY') {
      const obj = object(i, 5);
      if (obj.syms.length || obj.qty) out.push({ actor: 'neutral', syms: obj.syms, side: w, ownerish: true, advice: ADVICE_CLAUSE.test(sentence) || /\blook like\b/i.test(sentence) });
      continue;
    }
    if (!TRADE_NOUN_OF.has(lw) && !TRADE_NOUN_AFTER_TICKER.has(lw)) continue;
    // "the sale of 10 VRT", "an order for 15 MU", "a buy of 15 MU".
    const plural = /s$/.test(lw);
    if (plural && !T.slice(Math.max(clauseStart(i), i - 3), i).some((t) => PLURAL_SCOPE.test(t.lw))) continue;
    if (TRADE_NOUN_OF.has(lw) && /^(?:of|for)$/.test(T[i + 1]?.lw || '')) {
      const obj = object(i + 1, 6);
      const shares = object(i + 1, 6, true).qty;
      if ((obj.syms.length || shares) && !negatedBefore(i) && !thirdParty(i) && !byOther(i + 1)) {
        out.push({ actor: 'neutral', syms: obj.syms, side: sideOf(lw), ownerish: ownedBefore(i), advice: advice(i) });
        continue;
      }
    }
    // "the VRT sale", "your NBIS purchase", "two simulated NVDA trades".
    const prev = T[i - 1];
    if (TRADE_NOUN_AFTER_TICKER.has(lw) && prev && tick(prev) && !/['’]s$/.test(prev.w)) {
      const next = T[i + 1]?.lw || '';
      if (NOT_TRADE_AFTER.has(next) || (lw === 'trades' && TRADES_AS_VERB.has(next))) continue;
      if (negatedBefore(i - 1) || thirdParty(i - 1) || byOther(i)) continue;
      out.push({ actor: 'neutral', syms: [prev.w], side: sideOf(lw), ownerish: ownedBefore(i - 1), advice: advice(i) });
    }
  }
  return out;
}

// What a sentence states about trades: the claims it makes ({ statuses, anchor },
// backed by a record of any of those statuses) and whether, with no claim, it
// still needs a trade record (rule 2). null when it describes no trade.
export function tradeClaims(sentence, ctx) {
  const s = String(sentence || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  if (!s.trim() || /\?\s*$/.test(s) || /^\s*\[/.test(s)) return null;
  const anchors = tradeAnchors(s, ctx);
  if (!anchors.length) return null;
  const worded = [PROPOSED_WORDS.test(s) && !NOT_PROPOSED.test(s) && PROPOSED, SIM_WORDS.test(s) && !NOT_SIM.test(s) && SIMULATED].filter(Boolean);
  const absent = ABSENCE.test(s);
  // A claim is backed by a record of any of its statuses.
  const claims = [];
  for (const a of anchors) {
    if (a.actor === 'owner') claims.push({ statuses: [USER_REPORTED], anchor: a });
    else if (a.actor === 'sim') claims.push({ statuses: [SIMULATED], anchor: a });
    else if (worded.length) claims.push({ statuses: worded, anchor: a });
    else if (!absent && !a.advice && (a.ownerish || RECORD_WORDS.test(s))) claims.push({ statuses: [USER_REPORTED], anchor: a });
  }
  // A status word with no anchor of its own ("You sold 10 VRT; I've proposed recording it.").
  const general = worded.filter((st) => !claims.some((c) => c.statuses.includes(st)));
  if (general.length) claims.push({ statuses: general, anchor: null });
  return { claims, needsRecord: !claims.length && !absent && anchors.some((a) => !a.advice) };
}

// Is the claim backed by one of these records? Same status, same ticker (a
// SIMULATED record without one covers any) and, for USER-REPORTED and
// PROPOSED, a compatible side.
function backedBy(claim, items) {
  return claim.statuses.some((status) => {
    const pool = items.filter((i) => i?.tradeStatus === status);
    if (!pool.length) return false;
    const a = claim.anchor;
    if (!a) return true;
    const wide = status === SIMULATED;
    const symOk = (i, s) => i.symbol === s || (i.symbols || []).includes(s) || (wide && !i.symbol && !(i.symbols || []).length);
    const sideOk = (i) => wide || !a.side || !i.side || i.side === a.side || (a.side === 'BUY' && i.side === 'BASELINE');
    return a.syms.length ? a.syms.every((s) => pool.some((i) => symOk(i, s) && sideOk(i))) : pool.some(sideOk);
  });
}

// null when the sentence may stay; else why it goes ('broker' or 'record').
function tradeProblem(sentence, items, ctx, { detail = false } = {}) {
  if (brokerClaim(sentence)) return 'broker';
  const c = tradeClaims(sentence, ctx);
  if (!c) return null;
  if (c.claims.some((x) => !backedBy(x, items))) return 'record';
  if (detail && c.needsRecord && !items.some((i) => i?.tradeStatus)) return 'record';
  return null;
}

// Replace the sentences of `text` that `problem` rejects with their notice.
function dropSentences(text, problem, found) {
  if (!text) return text;
  let out = '', last = 0;
  for (const [a, b] of sentenceSpans(text)) {
    const seg = text.slice(a, b);
    const why = problem(seg);
    if (!why) continue;
    found.push({ text: seg.trim(), reason: why });
    out += text.slice(last, a) + seg.match(/^\s*/)[0] + `[${why === 'broker' ? BROKER_REMOVED : TRADE_REMOVED}]` + (seg.endsWith('\n') ? '\n' : '');
    last = b;
  }
  return last ? out + text.slice(last) : text;
}

// `held` (tickers held) and `names` (ticker -> company names) come from the
// records; without them only tickers are matched. `unbacked` lists the
// statements about trades removed because no record of their status backs them
// (reason 'record') or because they say a broker confirmed a trade ('broker').
export function validateAnswer(raw, ledger, { toolsRun = null, held = [], names = () => [] } = {}) {
  const named = (text, sym) => mentions(text, sym) || names(sym).some((n) => mentions(text, n));
  const issues = [];
  const notes = [];
  const removed = [];
  const unbacked = [];
  const str = (x) => (x == null ? null : String(x).trim() || null);
  const guard = (t) => {
    const g = guardText(t);
    if (g.flagged) removed.push(...g.removed);
    return g.text;
  };
  // Trade statements are checked against the trade records (tradeClaims above):
  // the short answer against all of this turn's, a detail against those it cites.
  const known = new Set([...ledger.items.flatMap((i) => [i.symbol, ...(i.symbols || [])]), ...held].filter(Boolean));
  const tctx = {
    isTicker: (w) => known.has(w) || (TICKER_SHAPE.test(w) && !NOT_TICKER.has(w)),
    symbolsNamed: (text) => [...known].filter((sym) => names(sym).some((n) => mentions(text, n))),
  };
  const turnRecords = ledger.items.filter((i) => i.tradeStatus);
  const checkTrades = (t) => dropSentences(t, (s) => tradeProblem(s, turnRecords, tctx), unbacked);
  const checkBroker = (t) => dropSentences(t, (s) => (brokerClaim(s) ? 'broker' : null), unbacked);
  const a = {
    short_answer: checkTrades(guard(String(raw?.short_answer || '').trim())),
    details: [],
    horizon: str(raw?.horizon) && checkBroker(guard(str(raw.horizon))),
    what_would_change_it: str(raw?.what_would_change_it) && checkBroker(guard(str(raw.what_would_change_it))),
    alternatives: (Array.isArray(raw?.alternatives) ? raw.alternatives : []).slice(0, 5).filter((x) => x && typeof x === 'object')
      .map((alt) => ({ option: checkBroker(guard(String(alt.option || ''))), case_for: checkBroker(guard(String(alt.case_for || ''))), case_against: checkBroker(guard(String(alt.case_against || ''))) })),
    affected_symbols: (Array.isArray(raw?.affected_symbols) ? raw.affected_symbols : []).map((s) => String(s).toUpperCase().slice(0, 15)).slice(0, 20),
    follow_up_questions: [],
    confidence: ['low', 'moderate', 'high', 'not_applicable'].includes(raw?.confidence) ? raw.confidence : 'not_applicable',
  };
  for (const f of (Array.isArray(raw?.follow_up_questions) ? raw.follow_up_questions : []).slice(0, 3).map((x) => String(x).slice(0, 200))) {
    if (findClaims(f).length || unsafeFollowUp(f)) { notes.push('A suggested follow-up phrased as an instruction was dropped.'); continue; }
    a.follow_up_questions.push(f);
  }
  const ledgerSymbols = new Set(ledger.items.map((i) => i.symbol).filter(Boolean));
  for (const d of (Array.isArray(raw?.details) ? raw.details : []).slice(0, 25)) {
    if (!d || typeof d !== 'object') continue;
    let category = ANSWER_CATEGORIES.includes(d.category) ? d.category : 'interpretation';
    const refs = (Array.isArray(d.refs) ? d.refs : []).map(String).filter((r) => {
      if (ledger.has(r)) return true;
      issues.push(`Unknown reference ${r} removed`);
      return false;
    });
    const text = guard(String(d.text || ''));
    // A detail about a trade whose records do not back it is replaced by a notice.
    const why = sentenceSpans(text).map(([s0, e0]) => tradeProblem(text.slice(s0, e0), refs.map((r) => ledger.get(r)), tctx, { detail: true })).filter(Boolean);
    if (why.length) {
      const reason = why.includes('broker') ? 'broker' : 'record';
      unbacked.push({ text: text.trim(), reason });
      a.details.push({ category: 'data_gap', text: reason === 'broker' ? BROKER_REMOVED : TRADE_REMOVED, refs: [], tradeStatuses: [], tradeStatementRemoved: reason });
      continue;
    }
    // Trade statuses come from the cited records, never from the model.
    const out = { category, text, refs, tradeStatuses: ledger.tradeStatuses(refs) };
    // A media report, rumour or archived briefing is not a verified fact, even
    // when it is cited next to a confirmed source.
    const reported = refs.filter((r) => isReported(ledger.get(r)));
    if (category === 'external_fact' && reported.length) {
      out.category = category = 'reported_claim';
      out.relabelled = 'external_fact';
      notes.push(`A point citing ${reported.length < refs.length ? 'a media report or archived briefing alongside other sources' : 'only media reports or archived briefings'} was relabelled "reported" (${reported.join(', ')}).`);
    } else if (['portfolio_record', 'calculation'].includes(category) && refs.length && refs.every((r) => isArchived(ledger.get(r)))) {
      out.relabelled = category;
      out.category = category = 'reported_claim';
      notes.push(`A point taken only from an archived briefing was relabelled "reported" (${refs.join(', ')}); archived briefings are snapshots, not current records.`);
    }
    if (MUST_CITE.includes(category) && !refs.length) out.uncited = true;
    // A point about one ticker whose sources all concern other tickers.
    const named = [...new Set((text.match(/\b[A-Z]{2,5}\b/g) || []).filter((x) => ledgerSymbols.has(x)))];
    const refSyms = refs.map((r) => ledger.get(r)?.symbol);
    if (named.length === 1 && refs.length && refSyms.every(Boolean) && !refSyms.includes(named[0])) {
      out.refMismatch = true;
      issues.push(`A point about ${named[0]} cites ${refs.join(', ')}, which concern ${[...new Set(refSyms)].join(', ')}.`);
    }
    a.details.push(out);
  }
  // Stale, undated or no-longer-updating market data the answer relies on (cited,
  // or the ticker or company is mentioned anywhere) gets an explicit gap note,
  // unless the model's own gap cites it, or names the instrument and says its
  // data is out of date or is about its quote, price or market data.
  const allText = [a.short_answer, a.horizon, a.what_would_change_it, ...a.details.map((d) => d.text), ...a.alternatives.flatMap((x) => [x.option, x.case_for, x.case_against])].filter(Boolean).join('\n');
  const cited = new Set(a.details.flatMap((d) => d.refs));
  const gaps = a.details.filter((d) => d.category === 'data_gap');
  const notUpdating = [];
  for (const item of ledger.items) {
    const state = staleState(item);
    if (!state || !(cited.has(item.ref) || named(allText, item.symbol))) continue;
    if (state === 'not_updating') { notUpdating.push(item); continue; }
    if (gaps.some((d) => d.refs.includes(item.ref) || (named(d.text, item.symbol) && STALE_WORDS.test(d.text)))) continue;
    a.details.push({ category: 'data_gap', refs: [item.ref], tradeStatuses: ledger.tradeStatuses([item.ref]), auto: true, text: `Possibly out of date: ${item.label} is ${state === 'stale' ? 'stale' : 'missing a reliable timestamp'}${item.asOf ? ` (as of ${formatNy(item.asOf)})` : ''}.` });
  }
  if (notUpdating.length && !gaps.some((d) => /not (being )?(updated|refreshed)|no (market[- ]data )?provider|can(no|')t (be )?(update|refresh)/i.test(d.text))) {
    const latest = notUpdating.map((i) => i.asOf).filter(Boolean).sort().at(-1);
    a.details.push({ category: 'data_gap', refs: notUpdating.slice(0, 6).map((i) => i.ref), tradeStatuses: [], auto: true, text: `Prices are not being updated: no market-data provider is configured, so the quotes used are the last ones stored${latest ? ` (latest ${formatNy(latest)})` : ''}.` });
  }
  if (removed.length) issues.push('A statement claiming a trade or record change was removed.');
  if (unbacked.some((u) => u.reason === 'record')) issues.push(TRADE_REMOVED);
  if (unbacked.some((u) => u.reason === 'broker')) issues.push(BROKER_REMOVED);
  const uncited = a.details.filter((d) => d.uncited).length;
  if (uncited) issues.push(`${uncited} factual point(s) had no supporting reference and are marked uncited.`);
  if (!a.short_answer) issues.push('The model returned no short answer.');
  // Nothing retrieved: only an answer about using the app (no numbers, records,
  // advice, or statements about holdings or market moves) is exempt.
  const facts = statements(allText);
  if (toolsRun === 0 && (/\d/.test(allText.replace(STEP_NUMBER, ' ')) || a.details.some((d) => MUST_CITE.includes(d.category)) || a.alternatives.length || a.horizon || a.what_would_change_it
    || a.affected_symbols.length || held.some((s) => named(facts, s)) || MARKET_TALK.test(facts))) {
    issues.push('No records were retrieved for this answer, so it may rest on earlier answers rather than current data.');
  }
  return { answer: { ...a, executionClaimRemoved: removed.length > 0, tradeStatementRemoved: unbacked.length > 0, notes }, issues, removed, unbacked };
}

// ---------- tool results ----------

// Fit a tool result into the size limit by shortening its longest lists (and
// then long strings) while keeping valid JSON, refs on the items kept, and a
// note of what was cut. Chronological lists keep their newest end.
export function fitResult(result, max = MAX_RESULT_CHARS) {
  let s = JSON.stringify(result ?? null);
  if (s.length <= max) return s;
  const copy = JSON.parse(s);
  const cuts = new Map();
  const ascending = (arr) => {
    const k = ['date', 'ts', 'tradeDate', 'trade_date'].find((x) => arr[0]?.[x] && arr.at(-1)?.[x]);
    return k ? String(arr[0][k]) < String(arr.at(-1)[k]) : false;
  };
  for (let pass = 0; pass < 40 && s.length > max; pass++) {
    let best = null;
    const walk = (node, path) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        if (node.length > 1) {
          const len = JSON.stringify(node).length;
          if (!best || len > best.len) best = { node, path, len };
        }
        node.forEach((x, i) => walk(x, `${path}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    };
    walk(copy, '');
    if (!best) break;
    const arr = best.node;
    const keep = Math.max(1, Math.floor(arr.length / 2));
    if (!cuts.has(best.path)) cuts.set(best.path, { list: best.path.replace(/\[\d+\]/g, '[]') || 'result', total: arr.length });
    const kept = ascending(arr) ? arr.slice(-keep) : arr.slice(0, keep);
    arr.length = 0;
    arr.push(...kept);
    cuts.get(best.path).kept = keep;
    s = JSON.stringify(copy);
  }
  if (s.length > max) {
    const clip = (node) => {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && v.length > 300) node[k] = `${v.slice(0, 300)}…`;
        else clip(v);
      }
    };
    clip(copy);
  }
  const note = `Result shortened to fit (${[...cuts.values()].map((c) => `${c.list}: ${c.kept} of ${c.total} kept`).join('; ') || 'long text clipped'}). Ask a narrower question for the rest.`;
  const wrapped = copy && typeof copy === 'object' && !Array.isArray(copy) ? { truncated: note, ...copy } : { truncated: note, items: copy };
  s = JSON.stringify(wrapped);
  return s.length <= max ? s : JSON.stringify({ truncated: 'Result too large to return. Ask a narrower question (one ticker, a shorter window).', ref: result?.ref ?? null });
}

// ---------- the turn ----------

function priorMessages(db, conversationId) {
  const rows = db.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`).all(conversationId, PRIOR_TURNS * 2).reverse();
  const msgs = [];
  for (const r of rows) {
    if (r.role === 'user') msgs.push({ role: 'user', content: r.text });
    else if (r.status !== 'unavailable') {
      const a = r.answer_json ? JSON.parse(r.answer_json) : null;
      const text = a ? [a.short_answer, ...a.details.slice(0, 8).map((d) => `(${d.category}) ${d.text}`)].join('\n') : (r.error ? `[Previous answer failed: ${r.error}]` : '');
      msgs.push({ role: 'assistant', content: `${text}\n[Earlier answer from ${r.created_at}; data in it may be outdated.]` });
    }
  }
  // The API needs strictly alternating roles starting with user.
  const merged = [];
  for (const m of msgs) {
    if (merged.length && merged.at(-1).role === m.role) merged.at(-1).content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  if (merged.length && merged.at(-1).role === 'user') merged.pop(); // unanswered question
  return merged;
}

function priorScenarios(db, conversationId) {
  return db.prepare("SELECT scenarios_json FROM chat_messages WHERE conversation_id = ? AND role = 'assistant' AND scenarios_json IS NOT NULL ORDER BY id")
    .all(conversationId).flatMap((r) => JSON.parse(r.scenarios_json));
}

export async function runChatTurn(ctx, { conversationId, userText, pageContext = null, backend, onEvent = () => {}, now = new Date(), signal = null }) {
  const conv = ctx.db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(conversationId);
  if (!conv) throw new Error('Conversation not found');
  const question = String(userText || '').trim().slice(0, 4000);
  if (!question) throw new Error('Ask a question');
  ctx.chatBusy ||= new Set();
  if (ctx.chatBusy.has(conversationId)) throw new Error('This conversation is still answering the previous question.');
  ctx.chatBusy.add(conversationId);
  try {
    return await answerQuestion(ctx, { conv, conversationId, question, pageContext, backend, onEvent, now, signal });
  } finally {
    ctx.chatBusy.delete(conversationId);
  }
}

const ABORTED = 'Stopped: the browser disconnected before the answer was finished.';

async function answerQuestion(ctx, { conv, conversationId, question, pageContext, backend, onEvent, now, signal }) {
  const db = ctx.db;
  const prior = priorMessages(db, conversationId);
  const scenariosBefore = priorScenarios(db, conversationId);
  db.prepare('INSERT INTO chat_messages (conversation_id, role, text, page_context_json, created_at) VALUES (?,?,?,?,?)')
    .run(conversationId, 'user', question, pageContext ? JSON.stringify(pageContext) : null, nowIso());
  if (prior.length === 0 && conv.title === 'New conversation') db.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').run(question.slice(0, 80), conversationId);
  db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId);

  const save = (fields) => {
    const r = db.prepare(`INSERT INTO chat_messages (conversation_id, role, text, answer_json, ledger_json, tools_json, scenarios_json, status, error, model, usage_json, created_at)
                          VALUES (?, 'assistant', ?,?,?,?,?,?,?,?,?,?)`).run(conversationId, fields.text ?? null, fields.answer ? JSON.stringify(fields.answer) : null,
      JSON.stringify(fields.ledger || []), JSON.stringify(fields.tools || []), fields.scenarios?.length ? JSON.stringify(fields.scenarios) : null,
      fields.status, fields.error ?? null, fields.model ?? null, fields.usage ? JSON.stringify(fields.usage) : null, nowIso());
    const id = Number(r.lastInsertRowid);
    if (fields.proposals?.length) db.prepare(`UPDATE chat_proposals SET message_id = ? WHERE id IN (${fields.proposals.map(() => '?').join(',')})`).run(id, ...fields.proposals);
    return messageOut(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  };

  if (!backend?.available) {
    return save({ status: 'unavailable', error: backend?.reason || 'No model backend configured', text: null });
  }
  const cc = backend.config || {};
  const firstCheck = budgetCheck(ctx.cfg, cc);
  if (!firstCheck.ok) return save({ status: 'unavailable', error: firstCheck.reason });

  const ledger = new Ledger();
  const turn = { conversationId, userText: question, now, scenarios: [], priorScenarioCount: scenariosBefore.length, proposals: [] };
  const handlers = createToolbox(ctx, { ledger, turn });
  const tools = toolsForApi();
  const header = turnHeader({ now: formatNy(now.toISOString()), session: sessionAt(now).session, pageContext, scenarios: scenariosBefore, workspace: ctx.mode });
  const messages = [...prior, { role: 'user', content: `${header}\n\nQuestion: ${question}` }];
  const toolLog = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0, calls: 0, unpriced: false, models: [] };
  const maxRounds = cc.maxToolRounds ?? 8;
  const servedBy = () => usage.models.join(', ') || backend.model;
  const account = (resp) => {
    const rec = recordUsage(ctx, resp, backend.model, cc.priceOverride);
    for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) usage[k] += rec.tokens[k] || 0;
    usage.cost_usd += rec.cost || 0;
    if (rec.unpriced) usage.unpriced = true;
    for (const m of rec.models) if (m && !usage.models.includes(m)) usage.models.push(m);
  };
  let checked = null; // validated final answer
  let unstructured = null;
  let empty = false;
  let nudged = false;
  let rephraseAsked = false;
  let stopNote = null;
  let known = null; // held tickers and company names, for validateAnswer
  const nameCache = new Map();
  const records = () => (known ||= { held: computePortfolio(db, { now, catalog: ctx.catalog }).positions.map((p) => p.symbol),
    names: (sym) => (nameCache.has(sym) ? nameCache.get(sym) : nameCache.set(sym, companyNames(ctx, sym)).get(sym)) });
  // Run one tool call; returns its tool_result block.
  const runCall = async (call) => {
    if (signal?.aborted) throw new BackendError('aborted', ABORTED);
    onEvent({ type: 'tool_start', tool: call.name, input: call.input });
    const refsBefore = new Set(ledger.items.map((i) => i.ref));
    const r = await runTool(handlers, call.name, call.input);
    toolLog.push({ tool: call.name, input: call.input, ok: r.ok, ms: r.ms, error: r.ok ? null : r.error });
    onEvent({ type: 'tool_end', tool: call.name, ok: r.ok, error: r.ok ? null : r.error, ms: r.ms });
    const body = r.ok ? fitResult(r.result) : `Error: ${r.error}`;
    // Refs registered by this call that were cut from what the model sees are forgotten.
    const unseen = ledger.items.filter((i) => !refsBefore.has(i.ref) && !new RegExp(`"${i.ref}"`).test(body)).map((i) => i.ref);
    if (unseen.length) ledger.remove(unseen);
    return { type: 'tool_result', tool_use_id: call.id, content: body, ...(r.ok ? {} : { is_error: true }) };
  };

  try {
    for (let round = 0; round <= maxRounds; round++) {
      if (signal?.aborted) throw new BackendError('aborted', ABORTED);
      if (round > 0) {
        const b = budgetCheck(ctx.cfg, cc);
        if (!b.ok) { stopNote = `Stopped before finishing: ${b.reason}`; break; }
      }
      onEvent({ type: 'thinking', round });
      const hold = reserveSpend(ctx.cfg);
      let resp;
      try {
        resp = await backend.create({ system: SYSTEM_PROMPT, tools, messages, signal });
      } catch (e) {
        if (e?.partial) { usage.calls += 1; account(e.partial); }
        throw e;
      } finally {
        hold.release();
      }
      usage.calls += 1;
      account(resp);
      if (resp.stop_reason === 'refusal') throw new BackendError('refusal', 'The model declined to answer this question.');
      if (resp.stop_reason === 'max_tokens') throw new BackendError('truncated', 'The model response was cut off before finishing.');
      const content = usableContent(resp.content);
      messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no content)' }] });
      const calls = content.filter((b) => b.type === 'tool_use');
      const submits = calls.filter((b) => b.name === 'submit_answer');
      // submit_answer on its own (or, in the last round, alongside other calls).
      if (submits.length && (calls.length === 1 || round === maxRounds)) {
        // Checked against what the model had seen when it wrote the answer.
        const v = validateAnswer(submits.at(-1).input, ledger, { toolsRun: toolLog.length, ...records() });
        // One chance to rephrase sentences that read as a trade or record-change
        // claim, or that describe a trade no record of that status backs.
        if ((v.removed.length || v.unbacked.length) && !rephraseAsked && round < maxRounds) {
          rephraseAsked = { claims: v.removed.length > 0, trades: v.unbacked.length > 0 };
          const parts = [];
          if (v.removed.length) parts.push(`These sentences read as saying a trade was made or a record was changed, which Signal Desk cannot do: ${v.removed.map((x) => JSON.stringify(x)).join(' ')} Rephrase them so they cannot be read that way (for example "No order has been placed" or "The post claims…").`);
          if (v.unbacked.length) parts.push(`These statements about trades are not backed by a record with the status they state: ${v.unbacked.map((x) => JSON.stringify(x.text)).join(' ')} Describe a specific trade only from its record and cite that record's own ref, with its status word: a transaction from get_transactions or get_position is USER-REPORTED (the owner's record: "you recorded…", "your records show…"), a propose_record_change result is PROPOSED ("proposed, not saved until you confirm"), a simulate_trade(s) or get_strategy_* result is SIMULATED ("hypothetical", "simulated"). What the owner told you in chat is not a record ("you said you sold…"). No record is ever confirmed or filled by a broker. Otherwise leave the statement out.`);
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: submits.at(-1).id, is_error: true,
            content: `Not delivered. ${parts.join(' ')} Then call submit_answer again with the full answer.` }] });
          continue;
        }
        // Last round: the other calls (read-only tools or proposals) still run,
        // so a proposal the answer mentions exists, but the answer never saw
        // their results.
        // A browser that disconnects meanwhile stops the remaining calls, but the
        // answer already checked is still saved.
        const late = calls.filter((c) => c.name !== 'submit_answer');
        if (late.length) {
          const refsBefore = new Set(ledger.items.map((i) => i.ref));
          const logged = toolLog.length;
          const ran = [];
          for (const call of late) {
            if (signal?.aborted) break;
            await runCall(call);
            ran.push(call);
          }
          const skipped = late.slice(ran.length);
          ledger.remove(ledger.items.filter((i) => !refsBefore.has(i.ref)).map((i) => i.ref));
          if (ran.length) v.answer.notes.push(`The answer was written before these requests ran, so it does not reflect their results: ${ran.map((c) => c.name).join(', ')}.`);
          if (skipped.length) v.answer.notes.push(`The browser disconnected before these requests sent with the answer ran: ${skipped.map((c) => c.name).join(', ')}.`);
          if (toolLog.slice(logged).some((t) => t.tool === 'propose_record_change' && !t.ok)) v.issues.push('A record change sent with the answer was refused or failed, so there may be nothing to confirm.');
          if (skipped.some((c) => c.name === 'propose_record_change')) v.issues.push('A record change sent with the answer was not prepared because the browser disconnected, so there is nothing to confirm.');
        }
        checked = v;
        break;
      }
      if (!calls.length) {
        const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        // A plain-text reply: ask once for the structured answer, which carries the sources.
        if (!nudged && round < maxRounds) {
          nudged = true;
          messages.push({ role: 'user', content: toolLog.length
            ? 'Please deliver that answer by calling submit_answer, citing the reference ids from the tool results.'
            : 'Please retrieve the records you need with the tools first, then call submit_answer citing their reference ids.' });
          continue;
        }
        if (text) unstructured = text;
        else empty = true;
        break;
      }
      if (round === maxRounds) break;
      const results = [];
      for (const call of calls) {
        if (call.name === 'submit_answer') {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'submit_answer must be called on its own, after you have read the results of your other tool calls. Call it again by itself.' });
          continue;
        }
        results.push(await runCall(call));
      }
      // All tool results go back in one user message.
      if (round === maxRounds - 1) results.push({ type: 'text', text: 'Tool budget nearly used: call submit_answer on its own now with what you have, noting any gaps.' });
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    log.warn('chat', `turn failed: ${e.message}`);
    const error = signal?.aborted ? ABORTED : e instanceof BackendError ? e.message : `Something went wrong: ${e.message}`;
    return save({ status: 'error', error, ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: servedBy(), usage: usageOut(usage), proposals: turn.proposals });
  }

  let answer, issues;
  try {
    if (checked) ({ answer, issues } = checked);
    else if (unstructured) {
      ({ answer, issues } = validateAnswer({ short_answer: unstructured.slice(0, 1500), details: [] }, ledger, { toolsRun: toolLog.length, ...records() }));
      issues.push('The model answered without the structured format, so sources could not be attached.');
    } else {
      answer = null;
      issues = [stopNote || (empty ? 'The model returned an empty reply. Try asking again.' : 'The model used its full tool budget without answering.')];
    }
    if (answer) {
      const { held } = records();
      // Only tickers actually held get a link to their position.
      answer.held_symbols = answer.affected_symbols.filter((s) => held.includes(s));
      answer.portfolio_symbols = [...new Set(held)];
      if (rephraseAsked?.claims && !answer.executionClaimRemoved) answer.notes.push('The first draft contained a sentence that read as a trade or record-change claim; the model rephrased it.');
      if (rephraseAsked?.trades && !answer.tradeStatementRemoved) answer.notes.push('The first draft described a trade without a record of the status it stated; the model rephrased it.');
    }
  } catch (e) {
    log.warn('chat', `answer check failed: ${e.message}`);
    answer = null;
    issues = ['The answer could not be checked, so it is not shown. Try asking again.'];
  }
  if (answer && stopNote) issues.push(stopNote);
  const failedTools = toolLog.filter((t) => !t.ok);
  const status = !answer ? 'error' : issues.length || failedTools.length ? 'partial' : 'ok';
  return save({
    status, text: answer?.short_answer || null,
    answer: answer ? { ...answer, issues, failedTools: failedTools.map((t) => ({ tool: t.tool, error: t.error })) } : null,
    error: answer ? null : issues.join(' '),
    ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: servedBy(),
    usage: usageOut(usage),
    proposals: turn.proposals,
  });
}

function usageOut(u) {
  return { ...u, cost_usd: Math.round(u.cost_usd * 10000) / 10000, estimated: !u.unpriced };
}
