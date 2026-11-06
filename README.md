# Signal Desk

Personal portfolio tracking and investment research desk: holdings in USD and CAD, news and filings, an AI-infrastructure watchlist, rule-based position assessments, three daily market briefings, and **Ask Signal Desk**, a read-only chat agent grounded in your own records. Runs locally on Windows (or macOS/Linux), binds to `127.0.0.1`, and has **no trading capability**.

**New here? Read [START-HERE.md](START-HERE.md).** Development notes are in [CLAUDE.md](CLAUDE.md) (the assistant protocol), [CLAUDE-INVARIANTS.md](CLAUDE-INVARIANTS.md) (what every change must preserve) and [JOURNAL.md](JOURNAL.md) (the development journal; PROJECT_SUMMARY.md and PROJECT_HANDOVER.md are derived from it).

- Start: double-click `Start-Signal-Desk.bat` (or `npm start`)
- Test: `npm test`
- Briefing now: `npm run briefing -- premarket`
- Backup now: `npm run backup`
- Prospective journal 1 (a simulation, updated by hand after the close): `npm run pj:update`, then `npm run pj:status` (START-HERE.md section 15)
- event-swing (a simulation; needs `SEC_CONTACT_EMAIL` in `.env`): `npm run es:check` (START-HERE.md section 16)

Stack: Node.js 22+ (built-in `node:sqlite`, `node:http`), vanilla JS front end, no build step. One runtime dependency: `@anthropic-ai/sdk`, used by Ask Signal Desk and the optional briefing analyst. Both need your own `ANTHROPIC_API_KEY` (billed per token; see START-HERE.md).
