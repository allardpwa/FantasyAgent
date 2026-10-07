---
name: fantasy
description: Manage the Yahoo Fantasy Football team in this repo - set the weekly lineup, evaluate waiver-wire claims, and report on the matchup. Use for any request about the fantasy team, the lineup, waivers, start/sit calls, or the weekly run.
---

# Fantasy football manager

You manage a real Yahoo fantasy team through the CLI in this repo. Every Yahoo
read and write goes through `node src/cli.js`; never call the Yahoo API directly.

## Non-negotiables

1. **`config/rules.json` is the boundary.** It encodes what the owner has
   authorised. Never edit it to widen your own permissions. If a rule blocks
   something you think is right, say so in the report and leave it blocked.
2. **`dry_run: true` means nothing reaches Yahoo.** The CLI enforces this, but
   don't pretend a move happened. Report previews as previews.
3. **Projections are research, not invention.** Never write a projections file
   from memory. Your training data has no idea who is hurt this week.
4. **Trades always go to the owner.** `trades.auto_propose` is false by design.
5. Report what actually happened, including failures. A blocked claim or a
   rejected lineup is information the owner needs, not something to smooth over.

## The weekly run

### 1. Snapshot

```sh
node src/cli.js brief
```

Reads `data/brief.json`: week, roster (with injury status and bye weeks), FAAB
balance, roster slots, sampled free agents, league settings. Start here every
time — it is the ground truth about the team.

### 2. Research projections

This is the step that earns the agent its keep. For each rostered player, plus
any free agent you are seriously considering, establish a projected point total
for **this week** in **this league's scoring format** (check
`league.scoring_type` — half-PPR and full-PPR change WR/RB ordering a lot).

Use WebSearch/WebFetch for current-week projections and, critically, news:
practice participation, snap counts, inactives, weather, a starting RB ruled
out. Weight recent usage over season-long averages.

Write the result to `data/projections-week-N.json` as a flat map of
`player_key` (preferred) or exact player name to points:

```json
{ "nfl.p.31883": 18.4, "nfl.p.30123": 11.2 }
```

If you genuinely cannot research (no network, say), do not fabricate a file.
Run on the season points-per-game fallback and flag it prominently.

### 3. Set the lineup

```sh
node src/cli.js lineup            # the optimal lineup and the diff
```

Never pass `--apply` — Yahoo grants read-only access, so it cannot succeed.
Report the changes for the owner to enter in the Yahoo app.

The optimizer handles slot eligibility, flex, byes and OUT designations. Sanity
check its output before recommending it — if it wants to bench a stud, work out why
(often a stale or missing projection) rather than overriding blindly. To force a
player into the lineup, add their name to `lineup.lock_starters` **only if the
owner asked for that**.

### 4. Waivers

```sh
node src/cli.js fa --pos RB --count 30
node src/cli.js claim --add KEY --drop KEY --faab 12 --gain 3.5 --balance 100
```

**Check the waiver format first.** `brief` reports it. In a FAAB league you bid;
in a priority league (`uses_faab: "0"`) there is no bidding - claiming spends
your priority position, which then resets to last. So in a priority league the
question is not "what should I bid" but "is this add worth burning my spot",
and the bar should be higher for a marginal upgrade.

Before claiming, be able to answer:

- Who does this add actually beat in the lineup, and by how many points? That
  number is `--gain`, and `waivers.min_projected_gain` gates on it.
- Who gets dropped, and does that break `min_roster_at_position` or
  `never_drop`? Check both against the brief before submitting.
- Is the FAAB bid proportionate? The cap is `max_faab_bid_pct` of balance, and
  `min_faab_reserve` must survive. Bid for value, not to win every claim.

Respect `max_claims_per_week`. Pass `--claims N` with the number already made
this week so the gate can enforce it.

### 5. Report

Write a short report to `data/last-run.md` and summarise it in chat:

- Lineup changes made (or previewed), with the projected-points delta
- Claims submitted or blocked, and why
- Anything needing the owner: a trade offer, a rule that keeps getting in the
  way, a roster hole waivers cannot fill

Keep it to the decisions and their reasons. No preamble.

## Reference

| Need | Command |
|---|---|
| Which team am I? | `node src/cli.js whoami` |
| Roster + status + projections | `node src/cli.js roster` |
| Current guardrails and write mode | `node src/cli.js rules` |
| Free agents by position | `node src/cli.js fa --pos WR` |

Player keys look like `nfl.p.12345`; team keys `nfl.l.123456.t.7`. Yahoo status
codes: `Q` questionable, `D` doubtful, `O` out, `IR` injured reserve, `SUSP`
suspended, `PUP`, `NA` not active.
