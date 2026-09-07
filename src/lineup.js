// Turns a roster + projections into an optimal legal starting lineup.

const FLEX = {
  'W/R': ['WR', 'RB'],
  'W/T': ['WR', 'TE'],
  'R/T': ['RB', 'TE'],
  'W/R/T': ['WR', 'RB', 'TE'],
  'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'],
  'D/ST': ['DEF', 'DST'],
};

const NON_STARTING = new Set(['BN', 'IR', 'IR+', 'IR-R', 'NA']);
const IR_SLOTS = new Set(['IR', 'IR+', 'IR-R']);

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Flatten Yahoo's player object into the shape the optimizer wants. */
export function normalizePlayer(p, projections = {}) {
  const key = p.player_key;
  const name = p.name?.full ?? p.name ?? key;
  const eligible = arr(p.eligible_positions)
    .map((e) => (typeof e === 'string' ? e : e.position))
    .filter(Boolean);
  const bye = Number(p.bye_weeks?.week ?? p.bye_weeks ?? 0) || null;
  return {
    key,
    name,
    team: p.editorial_team_abbr ?? '',
    pos: p.display_position ?? eligible[0] ?? '',
    eligible,
    status: p.status ?? '',              // O, Q, D, IR, SUSP, BYE...
    bye,
    current: p.selected_position?.position ?? null,
    projected: Number(projections[key] ?? projections[name] ?? 0),
  };
}

const eligibleFor = (player, slot) =>
  player.eligible.includes(slot) ||
  (FLEX[slot] || []).some((s) => player.eligible.includes(s));

/** Slots that must be filled, expanded from league settings, e.g. two RBs -> ['RB','RB']. */
export function startingSlots(rosterPositions) {
  const slots = [];
  for (const rp of arr(rosterPositions)) {
    const pos = rp.position ?? rp;
    const count = Number(rp.count ?? 1);
    if (NON_STARTING.has(pos)) continue;
    for (let i = 0; i < count; i++) slots.push(pos);
  }
  return slots;
}

/**
 * Assign players to slots to maximise projected points.
 * Greedy on the most restrictive slots first, then improvement passes until stable.
 */
export function optimize(players, rosterPositions, { week, rules = {} } = {}) {
  const slots = startingSlots(rosterPositions);
  const never = new Set(rules?.lineup?.never_start_status ?? ['O', 'IR', 'SUSP', 'PUP', 'NA']);
  const locked = new Set(rules?.lineup?.lock_starters ?? []);

  const startable = players.filter((p) => {
    if (never.has(p.status)) return false;
    if (week && p.bye === Number(week)) return false;
    return true;
  });

  // Fewest eligible bodies first, so scarce slots (K, DEF, QB) get filled.
  const order = slots
    .map((slot, i) => ({ slot, i, pool: startable.filter((p) => eligibleFor(p, slot)).length }))
    .sort((a, b) => a.pool - b.pool);

  const assigned = new Map(); // slot index -> player
  const used = new Set();

  // Honour explicit locks before anything else.
  for (const { slot, i } of order) {
    const lock = startable.find(
      (p) => !used.has(p.key) && locked.has(p.name) && eligibleFor(p, slot));
    if (lock) { assigned.set(i, lock); used.add(lock.key); }
  }

  for (const { slot, i } of order) {
    if (assigned.has(i)) continue;
    const best = startable
      .filter((p) => !used.has(p.key) && eligibleFor(p, slot))
      .sort((a, b) => b.projected - a.projected)[0];
    if (best) { assigned.set(i, best); used.add(best.key); }
  }

  // Greedy can strand points on the bench: promoting a player frees the one he
  // replaced, which may then win a different slot. Repeat until stable.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < slots.length; i++) {
      const inSlot = assigned.get(i);
      if (inSlot && locked.has(inSlot.name)) continue;
      for (const cand of startable) {
        if (used.has(cand.key)) continue;
        if (!eligibleFor(cand, slots[i])) continue;
        if (cand.projected > (inSlot?.projected ?? -Infinity)) {
          if (assigned.get(i)) used.delete(assigned.get(i).key);
          assigned.set(i, cand);
          used.add(cand.key);
          improved = true;
        }
      }
    }
  }

  const assignments = [];
  for (let i = 0; i < slots.length; i++) {
    const p = assigned.get(i);
    if (p) assignments.push({ player_key: p.key, position: slots[i], name: p.name, projected: p.projected });
  }
  for (const p of players.filter((x) => !used.has(x.key))) {
    // Leave anyone already in an IR slot there; Yahoo rejects illegal IR moves.
    assignments.push({
      player_key: p.key,
      position: IR_SLOTS.has(p.current) ? p.current : 'BN',
      name: p.name,
      projected: p.projected,
    });
  }

  const changes = assignments
    .map((a) => ({ a, p: players.find((x) => x.key === a.player_key) }))
    .filter(({ a, p }) => p && p.current && p.current !== a.position)
    .map(({ a, p }) => ({ name: a.name, from: p.current, to: a.position, projected: a.projected }));

  const projectedTotal = assignments
    .filter((a) => !NON_STARTING.has(a.position))
    .reduce((s, a) => s + a.projected, 0);

  const unfilled = slots
    .map((s, i) => (assigned.has(i) ? null : s))
    .filter(Boolean);

  return { assignments, changes, projectedTotal, slots, unfilled };
}
