#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { ROOT, authorizeUrl, exchangeCode, isAuthenticated } from './auth.js';
import * as y from './yahoo.js';
import { loadRules, saveRules, checkAllowed } from './rules.js';
import { normalizePlayer, optimize } from './lineup.js';
import { loadProjections, fallbackProjections } from './projections.js';
import { deepCollect, deepGet, pad, fmt } from './util.js';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n, d = null) => {
  const i = args.indexOf('--' + n);
  if (i === -1) return d;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const has = (n) => args.includes('--' + n);

const rules = () => loadRules();

function keys() {
  const r = rules();
  const lk = flag('league', r.team.league_key);
  const tk = flag('team', r.team.team_key);
  if (!lk || !tk) throw new Error('No team configured. Run:  node src/cli.js whoami --save');
  return { lk, tk, r };
}

const save = (name, obj) => {
  const f = path.join(ROOT, 'data', name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return path.relative(ROOT, f);
};

const currentWeek = (lg) => Number(flag('week', deepGet(lg, 'current_week'))) || 1;

async function loadRoster(tk, week) {
  const res = await y.roster(tk, week);
  const raw = deepCollect(res, (o) => typeof o.player_key === 'string' && o.name);
  const { source, map } = loadProjections(week);
  const proj = source ? map : fallbackProjections(raw, week);
  return { res, raw, source, players: raw.map((p) => normalizePlayer(p, proj)) };
}

// ------------------------------------------------------------------ commands

async function login() {
  if (isAuthenticated() && !has('force')) {
    console.log('Already authenticated. Re-run with --force to redo the login.');
    return;
  }
  // Non-interactive paths, so login works from a session with no TTY:
  // --url prints the authorize URL, --code finishes the exchange.
  if (has('url')) {
    console.log(authorizeUrl());
    return;
  }
  const supplied = flag('code');
  if (typeof supplied === 'string') {
    await exchangeCode(supplied);
    console.log('Authenticated. Tokens saved to state/tokens.json (gitignored).');
    return;
  }

  console.log('\n1. Open this URL in your browser and approve access:\n');
  console.log('   ' + authorizeUrl() + '\n');
  console.log('2. Yahoo redirects you to your redirect URI. That page may well fail');
  console.log('   to load - that is fine. Copy the FULL URL from the address bar.\n');
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('3. Paste the redirected URL (or just the code): ');
  rl.close();
  await exchangeCode(answer);
  console.log('\nAuthenticated. Tokens saved to state/tokens.json (gitignored).');
  console.log('Next:  node src/cli.js whoami --save');
}

async function whoami() {
  const res = await y.myTeams();
  const teams = deepCollect(res, (o) => typeof o.team_key === 'string' && o.name);
  if (!teams.length) {
    console.log('No NFL fantasy teams found on this login for the current season.');
    console.log('Raw response saved to ' + save('whoami-raw.json', res));
    return;
  }
  console.log('\nYour NFL fantasy teams:\n');
  teams.forEach((t, i) => {
    console.log('  [' + i + '] ' + t.name);
    console.log('      team_key=' + t.team_key + '  league_key=' + t.team_key.split('.t.')[0]);
  });
  if (has('save')) {
    const pick = teams[Number(flag('pick', 0))];
    const r = rules();
    r.team.team_key = pick.team_key;
    r.team.league_key = pick.team_key.split('.t.')[0];
    saveRules(r);
    console.log('\nSaved "' + pick.name + '" to config/rules.json.');
  } else {
    console.log('\nRun with --save (and --pick N for a team other than 0) to store it.');
  }
}

/** One JSON snapshot with everything a decision needs. */
async function brief() {
  const { lk, tk } = keys();
  const lg = await y.league(lk);
  const week = currentWeek(lg);

  const [rosterData, scoreRes, faRes, txRes] = await Promise.all([
    loadRoster(tk, week),
    y.scoreboard(lk, week).catch(() => null),
    y.availablePlayers(lk, { status: 'A', sort: 'AR', count: 40 }).catch(() => null),
    y.transactions(lk).catch(() => null),
  ]);
  const { res: rosterRes, players, source } = rosterData;

  const team = deepCollect(rosterRes, (o) => o.team_key === tk)[0] ?? {};
  const faabBalance = Number(deepGet(rosterRes, 'faab_balance') ?? deepGet(lg, 'faab_balance') ?? 0);

  const freeAgents = deepCollect(faRes, (o) => typeof o.player_key === 'string' && o.name).map((p) => ({
    player_key: p.player_key,
    name: p.name?.full,
    pos: p.display_position,
    team: p.editorial_team_abbr,
    status: p.status ?? '',
    bye: p.bye_weeks?.week ?? null,
    percent_owned: Number(p.percent_owned?.value ?? 0),
    season_points: Number(p.player_points?.total ?? 0),
  }));

  const out = {
    generated_at: new Date().toISOString(),
    week,
    league: {
      key: lk,
      name: deepGet(lg, 'name'),
      scoring_type: deepGet(lg, 'scoring_type'),
      num_teams: deepGet(lg, 'num_teams'),
      roster_positions: deepGet(lg, 'roster_positions') ?? [],
      // Waiver format decides how claims are priced. uses_faab '0' means
      // priority-order waivers, where the FAAB guardrails do not apply.
      uses_faab: deepGet(lg, 'uses_faab') ?? null,
      waiver_type: deepGet(lg, 'waiver_type') ?? null,
      waiver_rule: deepGet(lg, 'waiver_rule') ?? null,
    },
    team: {
      key: tk,
      name: team.name ?? deepGet(rosterRes, 'name'),
      faab_balance: faabBalance,
      waiver_priority: deepGet(rosterRes, 'waiver_priority') ?? null,
    },
    projections: {
      source: source ?? 'FALLBACK: season points-per-game',
      researched: Boolean(source),
    },
    roster: players,
    matchup: deepCollect(scoreRes, (o) => o.team_key && o.name).map((t) => ({ name: t.name, key: t.team_key })),
    free_agents: freeAgents,
    recent_transactions: deepCollect(txRes, (o) => o.transaction_key)
      .slice(0, 15).map((t) => ({ type: t.type, status: t.status, ts: t.timestamp })),
    rules: rules(),
  };

  const file = save('brief.json', out);
  console.log('Week ' + week + ' - ' + out.league.name + ' - ' + out.team.name);
  console.log('Projections: ' + out.projections.source);
  const faabLeague = String(out.league.uses_faab) === '1';
  console.log('Roster: ' + players.length + ' players | Free agents sampled: ' + freeAgents.length);
  console.log('Waivers: ' + (faabLeague
    ? 'FAAB, balance ' + faabBalance
    : 'priority order, you are #' + (out.team.waiver_priority ?? '?') + ' (no FAAB in this league)'));
  console.log('\nFull snapshot -> ' + file);
  if (!source) {
    console.log('\nNOTE: no researched projections for this week. Lineup advice stays weak');
    console.log('      until data/projections-week-' + week + '.json exists.');
  }
}

async function showRoster() {
  const { lk, tk } = keys();
  const lg = await y.league(lk);
  const week = currentWeek(lg);
  const { players, source } = await loadRoster(tk, week);
  console.log('\nWeek ' + week + ' roster  (projections: ' + (source ?? 'season PPG fallback') + ')\n');
  console.log('  ' + pad('SLOT', 7) + pad('POS', 5) + pad('PLAYER', 24) + pad('TM', 5) +
              pad('BYE', 5) + pad('ST', 5) + 'PROJ');
  const sorted = players.sort((a, b) =>
    (a.current === 'BN' ? 1 : 0) - (b.current === 'BN' ? 1 : 0) || b.projected - a.projected);
  for (const p of sorted) {
    console.log('  ' + pad(p.current, 7) + pad(p.pos, 5) + pad(p.name, 24) + pad(p.team, 5) +
                pad(p.bye ?? '', 5) + pad(p.status, 5) + fmt(p.projected));
  }
}

async function lineup() {
  const { lk, tk, r } = keys();
  const lg = await y.league(lk);
  const week = currentWeek(lg);
  const { players, source } = await loadRoster(tk, week);
  const plan = optimize(players, deepGet(lg, 'roster_positions') ?? [], { week, rules: r });

  console.log('\nWeek ' + week + ' optimal lineup  (projections: ' + (source ?? 'season PPG fallback') + ')');
  console.log('Projected total: ' + fmt(plan.projectedTotal) + '\n');
  for (const a of plan.assignments.filter((a) => a.position !== 'BN')) {
    console.log('  ' + pad(a.position, 7) + pad(a.name, 24) + fmt(a.projected));
  }
  if (plan.unfilled.length) console.log('\n  UNFILLED SLOTS: ' + plan.unfilled.join(', '));

  if (!plan.changes.length) {
    console.log('\nAlready optimal - no changes needed.');
    return;
  }
  const real = plan.changes.filter((c) => !c.reslot);
  const reslots = plan.changes.filter((c) => c.reslot);
  if (real.length) {
    console.log('\nStart/sit changes:');
    for (const c of real) console.log('  ' + pad(c.name, 24) + c.from + ' -> ' + c.to + '  (' + fmt(c.projected) + ')');
  } else {
    console.log('\nNo start/sit changes - the right players are already starting.');
  }
  if (reslots.length) {
    console.log('\nSlot relabels only (same players start, no action needed):');
    for (const c of reslots) console.log('  ' + pad(c.name, 24) + c.from + ' -> ' + c.to);
  }

  if (!has('apply')) {
    console.log('\nEnter these in the Yahoo app - the API is read-only, so this cannot be applied for you.');
    return;
  }
  const gate = checkAllowed(r, 'lineup');
  if (!gate.allowed) {
    console.log('\nNOT APPLIED: ' + gate.reason);
    return;
  }
  await y.setLineup(tk, week, plan.assignments.map((a) => ({ player_key: a.player_key, position: a.position })));
  console.log('\nLineup submitted to Yahoo.');
}

async function freeAgents() {
  const { lk } = keys();
  const res = await y.availablePlayers(lk, {
    status: flag('status', 'A'),
    sort: flag('sort', 'AR'),
    count: Number(flag('count', 30)),
    position: flag('pos', null),
  });
  const list = deepCollect(res, (o) => typeof o.player_key === 'string' && o.name);
  console.log('\n  ' + pad('POS', 5) + pad('PLAYER', 24) + pad('TM', 5) + pad('OWN%', 7) + pad('PTS', 7) + 'KEY');
  for (const p of list) {
    console.log('  ' + pad(p.display_position, 5) + pad(p.name?.full, 24) + pad(p.editorial_team_abbr, 5) +
                pad(fmt(p.percent_owned?.value ?? 0, 0), 7) + pad(fmt(p.player_points?.total ?? 0), 7) + p.player_key);
  }
}

async function claim() {
  const { lk, tk, r } = keys();
  const add = flag('add');
  const drop = flag('drop');
  const faab = flag('faab') === null ? null : Number(flag('faab'));
  if (!add && !drop) throw new Error('Pass --add <player_key> and/or --drop <player_key>.');

  const gate = checkAllowed(r, add ? 'claim' : 'drop', {
    faab,
    faabBalance: flag('balance') ? Number(flag('balance')) : null,
    claimsThisWeek: Number(flag('claims', 0)),
    playerKey: drop,
    projectedGain: flag('gain') ? Number(flag('gain')) : undefined,
  });

  console.log('\nadd=' + (add ?? '-') + '  drop=' + (drop ?? '-') + '  faab=' + (faab ?? '-'));
  if (!gate.allowed) {
    console.log('BLOCKED: ' + gate.reason);
    process.exitCode = 2;
    return;
  }
  if (!has('apply')) {
    console.log('Allowed by rules. (preview only - pass --apply to submit)');
    return;
  }
  await y.addDrop(lk, tk, { add, drop, faab });
  console.log('Submitted to Yahoo.');
}

async function showRules() {
  const r = rules();
  console.log(JSON.stringify(r, null, 2));
  console.log('\nWrite mode: ' + (r.dry_run
    ? 'DRY RUN - nothing reaches Yahoo. Set dry_run:false in config/rules.json to go live.'
    : 'LIVE - this agent can change your team.'));
}

const COMMANDS = { login, whoami, brief, roster: showRoster, lineup, fa: freeAgents, claim, rules: showRules };

const usage = [
  '',
  'fantasy-agent - agentic manager for a Yahoo Fantasy Football team',
  '',
  '  node src/cli.js login [--url | --code URL]  one-time Yahoo OAuth',
  '  node src/cli.js whoami [--save] [--pick N]     list your teams, store one',
  '  node src/cli.js brief [--week N]               full snapshot -> data/brief.json',
  '  node src/cli.js roster [--week N]              roster table',
  '  node src/cli.js lineup [--week N] [--apply]    optimal lineup; --apply writes it',
  '  node src/cli.js fa [--pos RB] [--count N]      available players',
  '  node src/cli.js claim --add KEY [--drop KEY] [--faab N] [--apply]',
  '  node src/cli.js rules                          show guardrails and write mode',
  '',
].join('\n');

const fn = COMMANDS[cmd];
if (!fn) {
  console.log(usage);
  process.exit(cmd ? 1 : 0);
}
try {
  await fn();
} catch (e) {
  console.error('\nError: ' + e.message);
  // process.exit() with in-flight handles trips a libuv assert on Windows.
  process.exitCode = 1;
}
