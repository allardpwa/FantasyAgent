# CLAUDE.md — fantasy-agent

Agent that manages a real Yahoo Fantasy Football team. Node 20+, ESM, **zero
dependencies**. Keep it that way unless there's a strong reason.

## Rules of engagement

- **`config/rules.json` is the owner's authorisation boundary.** Read it, obey
  it, never edit it to give yourself more room. Suggest changes in chat instead.
- **`dry_run: true` means no writes reach Yahoo.** Don't report a preview as a
  completed move.
- **Never fabricate projections.** Research them or use the labelled fallback.
  See `.claude/skills/fantasy/SKILL.md`.
- **Never commit `state/tokens.json`, `.env`, or the client secret.**
- Trades are owner-only by design.

## Known external constraint (verified 2026-09-07)

Yahoo gates Fantasy Sports API access behind review at
sports.yahoo.com/developer/access/ and currently grants **read-only**. The
`setLineup` / `addDrop` write paths are implemented to Yahoo's documented XML
formats but will fail until write access is approved for the app. Do not
"fix" this by rewriting the write layer - it is an authorisation limit, not a
bug. Advisory mode (research + preview + report) is the working configuration
in the meantime.

## Working on the code

- `node test/lineup.test.mjs` must pass after touching `src/lineup.js`.
- Yahoo's JSON is hostile (index-keyed pseudo-arrays, entity fields split across
  sibling objects). `simplify()` in `src/yahoo.js` normalises it; `deepCollect`
  / `deepGet` in `src/util.js` are the resilient way to pull values out — prefer
  them over fixed paths, which break when Yahoo changes nesting.
- Writes are XML, not JSON, even though reads use `?format=json`. See
  `setLineup` and `addDrop`.
- `setLineup` needs an assignment for **every** rostered player, bench included.

## Running it

See README.md. Normal weekly flow: `brief` → research projections → `lineup
--apply` → waiver claims → report to `data/last-run.md`.
