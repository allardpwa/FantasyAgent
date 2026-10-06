# fantasy-agent

An agent that manages a Yahoo Fantasy Football team: sets the weekly lineup,
works the waiver wire, and reports what it did. Zero npm dependencies — Node 20+
only, using built-in `fetch`.

## Setup (once)

### 0. API access is read-only (confirmed Oct 2026)

Yahoo gates Fantasy Sports API access behind a review process at
<https://sports.yahoo.com/developer/access/>. Access was granted for this
project in October 2026, and the app-creation form offers **Read only** — there
is no Read/Write option. Yahoo's own page states it plainly:

> The Yahoo Fantasy Sports API currently provides read access only. Write
> access is not available at this time.

**So this agent is advisory.** It reads the league, researches projections, and
produces the exact moves to make; you enter them in the Yahoo app. That takes
about two minutes a week.

`setLineup` and `addDrop` in `src/yahoo.js` are implemented to Yahoo's
documented XML formats and left in place for the day write access appears. They
are dormant, not broken — `dry_run: true` in `config/rules.json` keeps them
unreachable. Do not try to route around this; there is no sanctioned write path.

### 1. Create a Yahoo app

Create a **new** app at <https://developer.yahoo.com/apps/> — editing an
existing app does not pick up Fantasy Sports access. After creating it, submit
the Client ID at <https://sports.yahoo.com/developer/application-confirmation/>
so Yahoo enables it.

- **Application Type**: Web Application
- **Redirect URI**: `https://localhost:8080/callback` — the page does not have
  to exist. Yahoo requires an `https` URI; you copy the `?code=` out of the
  address bar after it fails to load.
- **API Permissions**: tick **Fantasy Sports**. Only **Read** is offered; there
  is no Read/Write option (see section 0)

Copy the Client ID and Client Secret.

### 2. Configure

```sh
cp .env.example .env
```

Fill in `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, and `YAHOO_REDIRECT_URI`
(exactly as entered on the Yahoo app).

### 3. Authenticate

```sh
node src/cli.js login
```

Open the printed URL, approve, then paste the URL you land on back into the
prompt. Tokens go to `state/tokens.json` (gitignored, never committed). The
refresh token is long-lived, so this is a one-time step.

### 4. Point it at your team

```sh
node src/cli.js whoami --save
```

Lists the NFL teams on your login and stores the first in `config/rules.json`.
Add `--pick 1` if you have more than one.

### 5. Go live when you're ready

`config/rules.json` ships with **`dry_run: true`**, so the agent computes and
explains but writes nothing to Yahoo. Watch it for a week, then set
`dry_run: false`.

## Commands

```sh
node src/cli.js brief                 # full snapshot -> data/brief.json
node src/cli.js roster                # roster with status, byes, projections
node src/cli.js lineup                # optimal lineup (preview)
node src/cli.js lineup --apply        # ...and write it to Yahoo
node src/cli.js fa --pos RB           # available players
node src/cli.js claim --add nfl.p.123 --drop nfl.p.456 --faab 12 --apply
node src/cli.js rules                 # guardrails + current write mode
node test/lineup.test.mjs             # optimizer self-test
```

## Guardrails

`config/rules.json` is the authorisation boundary — the agent reads it every run
and is instructed never to widen it on its own.

| Key | Effect |
|---|---|
| `dry_run` | Master switch. `true` blocks every write. |
| `lineup.auto_set` | Allow automatic lineup changes |
| `lineup.never_start_status` | Statuses that can never start (`O`, `IR`, `SUSP`…) |
| `lineup.lock_starters` | Names that must start if legal |
| `waivers.auto_claim` | Allow automatic waiver claims |
| `waivers.max_claims_per_week` | Cap on claims |
| `waivers.max_faab_bid_pct` | Max bid as % of remaining FAAB |
| `waivers.min_faab_reserve` | FAAB that must survive any bid |
| `waivers.min_projected_gain` | Points a claim must add to be worth it |
| `waivers.never_drop` | Players that can never be dropped |
| `waivers.min_roster_at_position` | Positional depth floors |
| `trades.*` | Both false — trades always need you |

## Where projections come from

Yahoo's public API does **not** expose its weekly projections, and projections
drive every decision here. So the Claude skill researches them each run (current
projections plus injury/usage news) and writes
`data/projections-week-N.json` as `{ player_key_or_name: points }`.

Without that file the CLI falls back to season points-per-game and says so. The
fallback is usable but blunt — it cannot know that a starter was ruled out on
Friday. **The researched projections are the point of running this agentically.**

## Layout

```
src/auth.js         OAuth2 + transparent token refresh
src/yahoo.js        API client, JSON normalizer, lineup/transaction writes
src/lineup.js       Eligibility-aware lineup optimizer
src/rules.js        Guardrail enforcement
src/projections.js  Projection loading + fallback
src/cli.js          Command dispatch
config/rules.json   Your authorisation boundary
.claude/skills/     The skill Claude follows on each run
```

## Safety notes

- `state/` and `.env` are gitignored. Never commit tokens or the client secret.
- The agent cannot propose or accept trades — that is deliberate.
- Every write command previews by default; `--apply` is always required.
