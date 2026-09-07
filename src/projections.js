import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './auth.js';

/**
 * Projections drive every decision this agent makes, and Yahoo's public API
 * does not expose its own weekly projections. So the Claude skill researches
 * them each run and writes data/projections-week-N.json as { player_key|name:
 * points }. Absent that file we fall back to season points-per-game, which is
 * a much blunter instrument - the CLI says so loudly when it happens.
 */
export function loadProjections(week) {
  const file = path.join(ROOT, 'data', `projections-week-${week}.json`);
  if (fs.existsSync(file)) {
    return { source: `data/projections-week-${week}.json`, map: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  return { source: null, map: {} };
}

export function saveProjections(week, map) {
  const file = path.join(ROOT, 'data', `projections-week-${week}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
  return file;
}

/** Season points per game, as a fallback when no researched projections exist. */
export function fallbackProjections(players, week) {
  const map = {};
  const gamesPlayed = Math.max(1, Number(week) - 1);
  for (const p of players) {
    const total = Number(p.player_points?.total ?? 0);
    if (total) map[p.player_key] = Math.round((total / gamesPlayed) * 10) / 10;
  }
  return map;
}
