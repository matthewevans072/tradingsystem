# ICT Lab: experiment log (append-only)

Entries are headed `## <number> | <date> | <title>` and run until the next heading. Entries are never edited or removed; a correction is a new entry. Text inside code fences or HTML comments is not read by the gate (Part B). The gate (PROTOCOL.md section 10) will look for one `**Code frozen for round 1**` entry naming the current code revision, the pre-registration commit and the data hash; for one `**Run**` entry per recorded run; and, before any validation, for the owner's `**Validation authorized**` row, which only the owner writes.

## 1 | 2026-11-04 | **Part A written: protocol and concepts** (documents only; no code that reads data; no market data downloaded, opened or read)

**The owner's work order (verbatim, under its real date):**

> Build the ICT Lab, Part A only (documents, no code that reads data). A separate, simulation-only sandbox for testing mechanical ICT-inspired hypotheses on QQQ 5-minute bars. QQQ is a labelled stand-in for NQ; nothing here is evidence about futures, and these are not claims that the rules reproduce ICT's teaching or are profitable.
>
> THIS DOES NOT AUTHORIZE: any code that reads market data, any download, any run, any read of the validation or reserved windows, any commit or push, any keys in chat. Write the documents below, then stop and show them to me. No additional review workflow.
>
> STANDING RULES: simulation only; no broker, order, paper-trading or account code; keys only in .env; never commit bars or data; separate from my holdings, cash, HXR, range-trend, sweep-bos and the Strategy Lab; the Strategy Lab MU holdout (2025-01-01 to 2026-06-30) is never read. The previous sweep-bos results stay untouched in their own database; this is a new experiment. No assumptions: every choice you add is labelled HYPOTHESIS with its origin (owner / author / standard convention) and, where it is a number, "proposed, for the owner to confirm". For each remaining mechanical choice propose ONE coherent default, explain it in a sentence, and label its origin. State explicitly which sweep-bos assumptions H1-H15 are retained, changed or dropped. Do not inherit sweep-bos H7 (the extra invalidation rule) without a stated reason.
>
> SCOPE OF ROUND 1: QQQ only (SPY is outside this round; do not add it). Long-only: the $5,000 cash account with whole shares and no leverage cannot short, and a short side would need its own funding and execution model, so short rules are out of scope and not merely "zero borrow cost". Four strategies, each a separate simulation.
>
> WINDOWS: DEVELOPMENT 2018-06-01 to 2022-12-30, the only window any run may read until I say otherwise. VALIDATION 2023-01-03 to 2024-12-31: never downloaded, opened or read until my separate message; each candidate validated once. RESERVED 2025-01-01 to 2026-06-30: never read.
>
> DATA PROVENANCE (document-only at this stage; read no market data): reference sweep-bos data version 1 as recorded in strategy/sweep-bos/EXPERIMENT-LOG.md entry 4 (QQQ and SPY, 2018-06-01 to 2022-12-30, Alpaca SIP raw, daily and 5-minute; full hash e7a619d2824847b8b94930b11ab433d414fabf2ed72afe1763d5b2990482752d). The lab's own QQQ dataset will have its own hash because it is a different subset; the later check (Part B, not now) is a per-symbol, per-bar comparison of the lab's QQQ bars against sweep-bos's QQQ bars over the same dates, with any difference reported. Do not require the two hashes to match.
>
> ROUND 1 SPECS (owner's, 2026-11-04):
> 1. Sweep → BOS → FVG: after a prior regular-session low is swept and price closes back inside that level, require an upward break of structure; enter on the first subsequent retracement to the displacement leg's FVG midpoint; stop beyond the sweep extreme; target 2R.
> 2. Sweep → BOS → order block: the same sweep and structure-break conditions; enter on the first subsequent retracement to the midpoint of the last opposite-colour candle before the displacement that caused the break; stop beyond the sweep extreme; target 2R.
> 3. Inversion FVG: after a sweep, require price to close through an opposing (bearish) FVG, then enter on its first subsequent retest from above; stop beyond the farther of the inverted gap's far edge and the sweep extreme; target 2R.
> 4. Breaker retest: after a sweep, require an opposing (bearish) order block to fail by a close through its far edge, accompanied by an upward structure break; enter on the first subsequent retest of that failed block's midpoint; stop beyond the farther of the block's far edge and the sweep extreme; target 2R.
>
> COMMON SETTINGS: $5,000 starting equity per strategy; planned risk at most 1% of current equity per trade ($50 at the start), a maximum, not an amount every trade must use; actual losses can exceed it through gaps and costs; setups and entries 09:30–11:00 America/New_York, all positions closed by 15:55; one open position; no adding, no averaging down; whole shares, no leverage, no fractional shares; cost model reused from sweep-bos with my numbers; a trade the account cannot fund is skipped and recorded.
>
> SIZING RULE (proposed default; owner to confirm): shares = min(floor(plannedRisk / stopDistance), floor((cash − estimated round-trip costs) / entryPrice)); 0 shares means skipped and recorded as unfunded; when the cash term, not the risk term, sets the size, the trade is flagged cash-capped and its actual planned risk is recorded.
>
> SWING DEFINITION (resolve the ambiguity; proposed default retains sweep-bos H1/H2): a swing high at bar i needs exactly one bar on each side, H[i] > H[i-1] and H[i] > H[i+1], strict (equal highs form no swing); swing lows mirror; the swing is confirmed and usable at the close of bar i+3; swings are session-local. State the left and right bar counts (1 and 1) and the confirmation bar (i+3) as numbers in the concepts table so "three-bar" is never read as three bars per side. If you propose a different count, say why.
>
> STATISTICS (provisional; owner to confirm): the criteria and bar below are proposals, and a passing validation alone does not prove an edge; it only means the candidate was not rejected on data it was not tuned on. Random-direction null for a long-only strategy: define it as a random-entry null that keeps the long drift: for each real trade, a long entry at the same bar index on a randomly chosen development session, the same stop distance, 2R target, time window and time stop, resampled at least 10,000 times with a fixed seed; p is the share of resampled mean-R values at or above the actual mean R. Multiple-testing adjustment covering all planned rounds: fix the denominator at the full budget from the start (proposed: 8 specs per round × 3 rounds = 24, so a candidate needs p < 0.05 / 24 ≈ 0.0021), rather than a denominator that grows as specs are added; round 1 contributes 4 of the 24. Minimum fills (proposed 100). Criteria C1-C6 reused from sweep-bos where they apply, listed with any change.
>
> DECISIONS TO PROPOSE, one default each with origin: (a) sizing as above; (b) strategy 3: which bearish FVGs are eligible (formed before or after the sweep) and their maximum age in bars; (c) strategy 4: the order of the structure break and the close through the block, and the bar limit between them; (d) setup expiry and retest validity for "first subsequent retracement/retest", including when an unfilled limit order is cancelled (the 11:00 cutoff is one choice); (e) exact rules for BOS, displacement, FVG and order-block boundaries, minimum zone size and stop buffer; (f) what "closes back inside the level" means for the sweep bar (close above the prior-session low).
>
> WRITE, in strategy/ict-lab/:
> 1. PROTOCOL.md: purpose; the windows; data provenance as above; the strategy spec format (JSON naming the concepts, entry, stop, target in R, time window, time stop, max trades per day, account settings, cost model); the round-1 specs as the first pre-registered round; the variant budget and the fixed-denominator adjustment; the minimum fills; C1-C6; the candidate rule (passes the criteria and the bar on development; only candidates are ever validated; validation once per candidate); the gate rules (append-only ledger, one spec per launcher call, a repeat needs a stated reason and is marked, a fix is a new spec version with a log entry naming the results seen, a lock row refuses a second instance, the validation window is refused by code until my message is recorded); the report contents (trades, mean R after costs, win rate, drawdown in R, bootstrap, the null, best-5% removal, month concentration, the dollar account, counts of unfunded and cash-capped trades, the funnel of sessions / sweeps / setups / orders / fills with the share lost at each stage, and a flaw section naming the stage that loses most). The words "profitable" and "edge" appear in no report unless a candidate has passed validation, and even then only as "not rejected on validation". Decisions use only bars closed at decision time; no entry ever fills on a bar before its setup is confirmed.
> 2. CONCEPTS.md: one exact mechanical definition per concept, numbered H1 onward with origin and the sweep-bos retained/changed/dropped status: swing high/low (as above, with the numbers), liquidity sweep (prior regular session low; a wick through with a close back inside), break of structure, change of character, displacement, FVG (three-bar gap, exact inequality), IFVG (a bearish FVG a later bar closes fully through; exact close rule; flipped polarity), order block (last opposite-colour bar before the displacement leg), breaker (an order block that fails by a close through its far edge; exact rule). For each: the bars it may use, what it never uses, and which edge or midpoint is the entry.
> 3. EXPERIMENT-LOG.md: append-only, "## N | date | title" entries; entry 1 lists the files with their LF-normalised SHA-256.
>
> FEASIBILITY: before writing, check the four specs against QQQ 5-minute bars with whole shares, no leverage and long-only, and say which, if any, cannot be simulated as written and why. Do not substitute instruments or assume leverage, fractional shares or shorting.
>
> THEN STOP. Return the consolidated documents together with one assumptions table (item, default, origin, one-line reason). Do not commit; I will tell you to commit Part A after I approve it. Part B onward comes as a separate message.

**What was written.** `PROTOCOL.md` (purpose, windows, provenance, the spec format, the four round-1 specs, account and sizing, criteria C1 to C6 with the fixed-denominator adjustment, validation, statistics, gate rules, report contents, the feasibility check, the sweep-bos H1 to H15 disposition, the decisions (a) to (f)) and `CONCEPTS.md` (H1 to H20, each with its definition, the bars it may use, what it never uses, its entry edge or midpoint, its origin and its sweep-bos status; the in-session decision order). SHA-256 of each file's text with line endings normalised to LF:

- `PROTOCOL.md`: 790d2b7265f62a07454c5607830c0add95d1cc7d78f41b1596fb0ca35a90d7e1
- `CONCEPTS.md`: fcf02a0ecde8dae3ffa44b18a7746f0777db3d7677cec078d3064f97208220b4

**Feasibility (checked before writing; reasoning on recorded sweep-bos counts and general price levels, no bar read).** All four specs can be simulated as written on QQQ 5-minute bars, long-only, whole shares, no leverage; none needs a short side, fractional shares or a substituted instrument. Two risks are recorded in PROTOCOL.md section 12: the cash term will size most trades, so the 1% maximum will rarely bind (reported, not hidden); and the 100-fill minimum is at risk, since sweep-bos's most relaxed variant filled 59 times on QQQ in both directions over 1,008 sessions (reports/round-2.md, measured) while this lab takes longs only, with a wider sweep window, no invalidation, a re-arm, and deeper (midpoint) entries; the net effect is unknown before Part D.

**Sweep-bos H1 to H15.** Retained: H1, H2, H4 (low side), H6, H8, H9, H11, H12, H14. Changed: H13 (midpoint, the 10:55 bar, one filled trade with re-arm), H15 (2R target replaces the prior-session-high target). Dropped: H3 (bias), H5 (both-sides bar, moot), H7 (invalidation: the author's rule, not the source's, sweep-bos EXPERIMENT-LOG.md entry 20; it voided 56% of sweeps, reports/round-1.md section 8), H10 (stop B). The table is PROTOCOL.md section 13.

**Data seen by the author:** none of this lab's; the sweep-bos counts and figures already recorded in `strategy/sweep-bos/` (prior exposure disclosed in PROTOCOL.md section 2). **Not authorized and not done:** any code that reads market data, any download, any run, any read of the validation or reserved windows, any commit or push. The documents are uncommitted and await the owner's approval; the Part A commit, when ordered, is recorded in a later entry.

**Correction note inside entry 1 (2026-11-04, on the owner's Part A review; written here rather than as a new entry because nothing is committed, at the owner's instruction).** The owner's review message, verbatim:

> Part A review. Make these four corrections, recompute both hashes, replace them in EXPERIMENT-LOG.md entry 1 (as a correction note inside entry 1, since nothing is committed yet), and show me the diff:
> 1. PROTOCOL.md section 10 rule 8: "the sweep-bos code" → "the ict-lab code (server/ictlab/, strategy/ict-lab/)".
> 2. CONCEPTS.md H13 and PROTOCOL.md spec 4: the upward BOS bar k_bos must also satisfy k_bos > s.
> 3. Write the four spec files strategy/ict-lab/specs/ict-sweep-bos-fvg-0.1.0.json, ict-sweep-bos-ob-0.1.0.json, ict-ifvg-0.1.0.json, ict-breaker-0.1.0.json from PROTOCOL.md sections 4 and 5, and list their LF-normalised SHA-256 in entry 1.
> 4. Add "tradingsystem contex vault/" to .gitignore.
> Decisions: keep session-local structure (H2) for round 1; keep the re-arm (H15). Record both as owner-confirmed in entry 1. Still no commit, no download, no run.

Applied: (1) PROTOCOL.md section 10 rule 8 now reads "The ict-lab code (`server/ictlab/`, `strategy/ict-lab/`) has no uncommitted change"; (2) CONCEPTS.md H13 requires s < k_bos ≤ 17 and PROTOCOL.md spec 4 and decision (c) say the break must come after the sweep bar; (3) the four spec files were written in `specs/` from PROTOCOL.md sections 4 and 5 (the per-spec fields `name`, `concepts`, `setup`, `entry.zone`/`zoneSource`, `stop.anchor`/`anchors` added to the shared block); (4) `tradingsystem contex vault/` added to `.gitignore`. Consequential edits, so the pinned text does not contradict the files: PROTOCOL.md section 4 and section 15 row A now say the spec files exist and are listed here; section 13 row H13, section 14's closing line, CONCEPTS.md H2 and H15 record the owner's confirmations. **Owner-confirmed on 2026-11-04:** session-local structure (CONCEPTS.md H2) for round 1; the re-arm after an unfilled order (CONCEPTS.md H15).

The hashes above (790d2b72… and fcf02a0e…) are superseded. SHA-256 of each file's text with line endings normalised to LF, after the corrections:

- `PROTOCOL.md`: 7feebbc6ea6331de437afe6b9750428394f41f5a80fad16f4f843340c194aced
- `CONCEPTS.md`: 710e3f7ab45fbd9dbea3872b4b5b08dc14d51436537f15223bf7c1c14e4b6ab8
- `specs/ict-sweep-bos-fvg-0.1.0.json`: 999c2d29ba72450f1fd9c03ef1599df09cf76f1d8f03163a9a7b255ed6f6074e
- `specs/ict-sweep-bos-ob-0.1.0.json`: ded5a86fdd6c8beabab3f78d4bf1b7a1e72695bb09052d7964d1d9c7aa6087c7
- `specs/ict-ifvg-0.1.0.json`: 3f6320ec2f92c0c28a78758ce03438708feecc1b8a49cee93b6b6171e3d22f84
- `specs/ict-breaker-0.1.0.json`: 819ce89f120671a4ab397e028ba6aadf9ec48333700e0cd39c9f6e9ae6f9344e

Still not authorized and not done: any commit or push, any download, any run, any code that reads market data. The collision recorded in entry 2 and its resolution in entry 3 concern which text these hashes describe: the corrected files above are the first session's design, which the owner's review addresses.

**Approval note inside entry 1 (2026-11-04, on the owner's approval of the review; written here because nothing was committed yet).** The owner's message, verbatim:

> Approved with two changes before the commit. Delete strategy/ict-lab/superseded/ (its hashes are in entry 3). Rename the spec field rearmAfterUnfilledOrder to rearmAfterRefusedConfirmation in all four spec files and in PROTOCOL.md section 4, recompute the six hashes and update the correction note in entry 1. Then commit in two steps: first Build 7's files (CLAUDE.md, CLAUDE-INVARIANTS.md, JOURNAL.md, PROJECT_SUMMARY.md, PROJECT_HANDOVER.md, README.md, .gitignore) as one commit; then strategy/ict-lab/ alone as the Part A pre-registration commit, and record that commit's hash as EXPERIMENT-LOG.md entry 4. Push both. No download, no run, no code that reads data.

Applied: `superseded/` deleted (the two copies' hashes, 6515748b… and 259d81ca…, stay in entries 2 and 3); the field `rearmAfterUnfilledOrder` renamed `rearmAfterRefusedConfirmation` in PROTOCOL.md section 4's shared block and in the four spec files (the name now says what CONCEPTS.md's decision order says the re-arm does: a later confirmation may be placed after one refused at step (5); the rule is unchanged). CONCEPTS.md is unchanged. The list just above (PROTOCOL.md 7feebbc6…, the specs 999c2d29…, ded5a86f…, 3f6320ec…, 819ce89f…) is superseded. SHA-256 of each file's text with line endings normalised to LF, the values the Part A commit pins:

- `PROTOCOL.md`: 28901369c2a9e021c716613c162d76bc7ed39904b863adb1387337f1104fef12
- `CONCEPTS.md`: 710e3f7ab45fbd9dbea3872b4b5b08dc14d51436537f15223bf7c1c14e4b6ab8 (unchanged)
- `specs/ict-sweep-bos-fvg-0.1.0.json`: 98de4a037e58ca45d56cb8afb2f6f24b9ac8ae575411c627c291f7129bb403f9
- `specs/ict-sweep-bos-ob-0.1.0.json`: 53956d89712e68b944b0d62cf10413568394cbbda603fed73db047f0a41d197c
- `specs/ict-ifvg-0.1.0.json`: 1f64160c147a81fb8cd1168aabc97cf912640a51c7efeabf9088613154c55066
- `specs/ict-breaker-0.1.0.json`: 1f4d40b038fd53d1964a3788a546318b22932957640ad9463fe2bc58d09af65f

The Part A commit's hash is recorded in entry 4. Still not authorized and not done: any download, any run, any code that reads market data.

## 2 | 2026-11-04 | **Part A collision: a parallel session's two documents were overwritten; the current files and their hashes** (documents only; no market data read)

Two sessions received the same Part A work order. Session A (the author of entry 1) wrote `PROTOCOL.md`, `CONCEPTS.md` and this log by 21:08 local time on 2026-11-03 (Atlantic; 2026-11-04 UTC). This session, unaware of it, wrote `CONCEPTS.md` at 21:10 and `PROTOCOL.md` at 21:13 (one wording edit at 21:15), overwriting session A's two documents; they were uncommitted and cannot be recovered from git. Entry 1 is kept unedited as the record of session A's work; its hashes (PROTOCOL.md 790d2b72…, CONCEPTS.md fcf02a0e…) refer to files that no longer exist.

The files now on disk and their LF-normalised SHA-256:

- `PROTOCOL.md`: 6515748b7bda9e0b430cb644b4161f90ba98d3e645fda3226a43cdaaf416c045
- `CONCEPTS.md`: 259d81ca075e6c1ee23a31b12b6d34552a00c5006b71cba6dc4aa3a9acbd0053

What is known of the differences, from entry 1 and the journal's Build 8 entry only: session A's `CONCEPTS.md` ran H1 to H20 and allowed "one filled trade with re-arm" under its H13, and treated sweep-bos H5 as dropped (moot); the current `CONCEPTS.md` runs H1 to H22, keeps one setup per session with no re-arm (H18), and treats sweep-bos H5 as changed. Session A's protocol put the gate in section 10 and the feasibility check in section 12 (entry 1 and the header above say so); the current `PROTOCOL.md` has the gate in section 8, the feasibility check in section 10 and the assumptions table in section 11. Nothing else of session A's content is known to this session. The owner decides which design stands; if session A's versions are wanted for comparison, that session can re-create them from its own context under different file names, and no file in this folder should be overwritten again.

Data seen by the author: none of this lab's; the sweep-bos counts and figures already recorded in `strategy/sweep-bos/`. Not authorized and not done: any code that reads market data, any download, any run, any read of the validation or reserved windows, any commit or push.

## 3 | 2026-11-04 | **Collision resolved: session A's design restored and corrected on the owner's review; the parallel session's files preserved under `superseded/`** (documents only; no market data read)

The owner's Part A review (quoted in the correction note inside entry 1) addresses session A's design: it names "PROTOCOL.md section 10 rule 8" and its wording "the sweep-bos code", "CONCEPTS.md H13" as the breaker, and "keep the re-arm (H15)", none of which exist in the design recorded in entry 2 (gate in section 8; no re-arm). Session A (trading-system-a8) therefore re-created its two documents from its own context, verified them against entry 1's hashes before changing anything (PROTOCOL.md 790d2b72… and CONCEPTS.md fcf02a0e… both matched), applied the owner's four corrections and the consequential edits listed in entry 1's correction note, and wrote them to `PROTOCOL.md` and `CONCEPTS.md`. Before that write, the files recorded in entry 2 were copied unchanged to `superseded/2026-11-04-parallel-session/PROTOCOL.md` (6515748b7bda9e0b430cb644b4161f90ba98d3e645fda3226a43cdaaf416c045) and `CONCEPTS.md` (259d81ca075e6c1ee23a31b12b6d34552a00c5006b71cba6dc4aa3a9acbd0053); the hashes of the copies were recomputed and match entry 2. ListAgents showed the parallel session (trading-system-16) idle; it was messaged not to write into this folder again. Nothing of either design is lost.

The files this lab's pins will cover, with their current LF-normalised SHA-256, are listed in entry 1's correction note: `PROTOCOL.md` 7feebbc6…, `CONCEPTS.md` 710e3f7a…, and the four spec files in `specs/`. The `superseded/` folder is not part of the pre-registration and is never pinned; it can be deleted on the owner's word. Data seen by the author: none of this lab's. Not authorized and not done: any commit or push, any download, any run, any code that reads market data.
