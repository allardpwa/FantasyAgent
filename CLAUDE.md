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

## Known external constraint (confirmed 2026-10-05)

Yahoo grants this app **read-only** Fantasy Sports API access. The
app-creation form offers no Read/Write option, and Yahoo states write access is
not available on the platform. This is an authorisation limit, not a bug.

**The agent is therefore advisory**: research projections, compute the optimal
lineup and waiver targets, report them for the owner to enter manually.

- Never pass `--apply`; it cannot succeed. `dry_run: true` blocks it anyway.
- Do not "fix" this by rewriting the write layer, scraping, or driving the
  Yahoo web UI. `setLineup` / `addDrop` stay as-is for the day write access
  appears.
- Report recommendations as recommendations. Never imply a move was made.

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
