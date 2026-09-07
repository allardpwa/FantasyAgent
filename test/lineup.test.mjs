// Self-test for the lineup optimizer: node test/lineup.test.mjs
import { optimize, normalizePlayer } from '../src/lineup.js';

const mk = (k, n, pos, cur, status = '', bye = null) => ({
  player_key: k, name: { full: n }, display_position: pos,
  eligible_positions: pos === 'DEF' ? ['DEF'] : [pos, ...(['WR', 'RB', 'TE'].includes(pos) ? ['W/R/T'] : [])],
  selected_position: { position: cur }, status, bye_weeks: { week: bye },
});

const raw = [
  mk('p1', 'Star QB', 'QB', 'BN'), mk('p2', 'Bad QB', 'QB', 'QB'),
  mk('p3', 'RB One', 'RB', 'BN'), mk('p4', 'RB Two', 'RB', 'RB'),
  mk('p5', 'RB Hurt', 'RB', 'RB', 'O'), mk('p12', 'RB Bye', 'RB', 'BN', '', 5),
  mk('p6', 'WR One', 'WR', 'WR'), mk('p7', 'WR Two', 'WR', 'BN'), mk('p8', 'WR Flex', 'WR', 'BN'),
  mk('p9', 'TE One', 'TE', 'TE'), mk('p10', 'K One', 'K', 'K'), mk('p11', 'D One', 'DEF', 'DEF'),
];
const proj = { p1: 22, p2: 9, p3: 18, p4: 14, p5: 20, p6: 16, p7: 12, p8: 13, p9: 8, p10: 7, p11: 6, p12: 25 };
const players = raw.map((p) => normalizePlayer(p, proj));
const rp = [
  { position: 'QB', count: 1 }, { position: 'RB', count: 2 }, { position: 'WR', count: 2 },
  { position: 'TE', count: 1 }, { position: 'W/R/T', count: 1 }, { position: 'K', count: 1 },
  { position: 'DEF', count: 1 }, { position: 'BN', count: 4 },
];

const r = optimize(players, rp, { week: 5 });
const starters = r.assignments.filter((a) => a.position !== 'BN');
const bench = r.assignments.filter((a) => a.position === 'BN').map((a) => a.name);

console.log('projected total:', r.projectedTotal);
console.log('unfilled slots:', r.unfilled.length ? r.unfilled : '(none)');
console.log('\nstarters:');
for (const a of starters) console.log('  ', a.position.padEnd(7), a.name, `(${a.projected})`);
console.log('\nbench:', bench.join(', '));
console.log('\nchanges:');
for (const c of r.changes) console.log('  ', c.name, c.from, '->', c.to);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) fail++; };
console.log('\nassertions:');
ok(starters.length === 9, 'fills all 9 starting slots');
ok(bench.includes('RB Hurt'), 'benches the player listed OUT');
ok(bench.includes('RB Bye'), 'benches the player on bye, despite the top projection');
ok(bench.includes('Bad QB') && starters.some((s) => s.name === 'Star QB'), 'starts the better QB off the bench');
const flex = starters.find((s) => s.position === 'W/R/T');
ok(['WR', 'RB', 'TE'].some((x) => flex && players.find((p) => p.name === flex.name)?.eligible.includes(x)),
   'flex slot holds a flex-eligible player');
ok(['WR One', 'WR Two', 'WR Flex'].every((n) => starters.some((s) => s.name === n)),
   'all three healthy WRs start (two WR slots + flex)');
ok(r.assignments.length === players.length, 'every rostered player gets an explicit slot');
// Optimum by hand: QB22 + RB 18,14 + WR 16,13 + TE8 + flex12 + K7 + DEF6.
ok(r.projectedTotal === 116, `projected total is the optimum (got ${r.projectedTotal}, want 116)`);

console.log(fail ? `\n${fail} assertion(s) failed` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
