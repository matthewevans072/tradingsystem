# Signal Desk

Personal portfolio tracking and investment research desk: holdings in USD and CAD, news and filings, an AI-infrastructure watchlist, rule-based position assessments, and three daily market briefings. Runs locally on Windows (or macOS/Linux), binds to `127.0.0.1`, and has **no trading capability**.

**New here? Read [START-HERE.md](START-HERE.md).** Development notes are in [CLAUDE.md](CLAUDE.md).

- Start: double-click `Start-Signal-Desk.bat` (or `npm start`)
- Test: `npm test`
- Briefing now: `npm run briefing -- premarket`
- Backup now: `npm run backup`

Stack: Node.js 22+ (built-in `node:sqlite`, `node:http`), vanilla JS front end, no build step. One runtime dependency: `@anthropic-ai/sdk` for the optional AI analyst.
