// Yahoo Fantasy Sports API client.
import { accessToken } from './auth.js';

const BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

/**
 * Yahoo's JSON is a direct transliteration of its XML, which leaves two
 * hostile shapes: index-keyed pseudo-arrays ({"0":..,"1":..,"count":2}) and
 * entities whose fields are scattered across sibling objects in an array.
 * This collapses both into ordinary JS objects and arrays.
 */
export function simplify(node) {
  if (Array.isArray(node)) {
    const parts = node.map(simplify).filter((p) => p !== null && p !== undefined);
    // A genuine list: every element is a single-key object sharing the same
    // key, which is how Yahoo wraps list items (e.g. roster_positions ->
    // [{roster_position:{...}}, ...]). Merging those collapses the whole list
    // into its last element, so detect and unwrap instead.
    if (parts.length > 1 &&
        parts.every((p) => p && typeof p === 'object' && !Array.isArray(p) &&
                           Object.keys(p).length === 1)) {
      const k = Object.keys(parts[0])[0];
      if (parts.every((p) => Object.keys(p)[0] === k)) return parts.map((p) => p[k]);
    }

    const merged = {};
    let list = null;
    for (const p of parts) {
      if (Array.isArray(p)) list = list ? list.concat(p) : p;
      else if (typeof p === 'object') Object.assign(merged, p);
    }
    if (list && Object.keys(merged).length === 0) return list;
    if (list) merged._list = list;
    return merged;
  }

  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    const numeric = keys.filter((k) => /^\d+$/.test(k));

    // {count: 0} is an empty collection. Require count to be the ONLY key:
    // real entities carry their own count field (roster_position.count is the
    // number of slots), and treating those as empty collections ate them.
    if (keys.length === 1 && keys[0] === 'count') return [];

    if (numeric.length && ('count' in node || numeric.length === keys.length)) {
      return numeric
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => {
          const v = simplify(node[k]);
          // Unwrap the single-key envelope Yahoo puts around each item,
          // e.g. {player: {...}} -> {...}
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const inner = Object.keys(v);
            if (inner.length === 1 && v[inner[0]] && typeof v[inner[0]] === 'object') {
              return v[inner[0]];
            }
          }
          return v;
        });
    }

    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = simplify(v);
    return out;
  }

  return node;
}

async function request(pathname, { method = 'GET', body = null, raw = false } = {}) {
  const url = `${BASE}${pathname}${pathname.includes('?') ? '&' : '?'}format=json`;
  const send = async () => {
    const token = await accessToken();
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/xml' } : {}),
      },
      ...(body ? { body } : {}),
    });
  };

  let res = await send();
  if (res.status === 401) res = await send(); // token just rotated; retry once

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo API ${method} ${pathname} failed (${res.status}):\n${text.slice(0, 1200)}`);
  }
  if (!text.trim()) return null;
  if (raw) return text;
  let json;
  try { json = JSON.parse(text); } catch { return text; }
  return simplify(json.fantasy_content ?? json);
}

export const get = (p) => request(p);
export const post = (p, body) => request(p, { method: 'POST', body });
export const put = (p, body) => request(p, { method: 'PUT', body });

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- reads

/** Every NFL team this login owns, for the current season. */
export async function myTeams() {
  const r = await get('/users;use_login=1/games;game_keys=nfl/teams');
  return r;
}

export const league        = (lk)       => get(`/league/${lk};out=settings,standings`);
export const leagueSettings= (lk)       => get(`/league/${lk}/settings`);
export const standings     = (lk)       => get(`/league/${lk}/standings`);
export const scoreboard    = (lk, week) => get(`/league/${lk}/scoreboard${week ? `;week=${week}` : ''}`);
export const teamInfo      = (tk)       => get(`/team/${tk};out=matchups,stats`);

/** Roster for a week, with each player's stats and eligible positions. */
export const roster = (tk, week) =>
  get(`/team/${tk}/roster${week ? `;week=${week}` : ''}/players/stats;type=season`);

/**
 * Available players. status: FA | W (waivers) | A (all available) | T (taken)
 * sort: OR overall rank | AR actual rank | PTS points | O_RANK
 */
export const availablePlayers = (lk, { status = 'A', sort = 'AR', count = 40, position = null, start = 0 } = {}) =>
  get(`/league/${lk}/players;status=${status};sort=${sort}` +
      `${position ? `;position=${position}` : ''}` +
      `;start=${start};count=${count}/stats;out=ownership,percent_owned`);

export const transactions = (lk, types = 'add,drop,trade') =>
  get(`/league/${lk}/transactions;types=${types};count=25`);

// --------------------------------------------------------------- writes

/**
 * Set the starting lineup. `assignments` is [{ player_key, position }] and must
 * cover EVERY player on the roster - Yahoo treats this as the full picture,
 * so bench players need an explicit "BN".
 */
export async function setLineup(teamKey, week, assignments) {
  const players = assignments.map((a) =>
    `    <player><player_key>${esc(a.player_key)}</player_key>` +
    `<position>${esc(a.position)}</position></player>`).join('\n');
  const xml =
`<?xml version="1.0"?>
<fantasy_content>
  <roster>
    <coverage_type>week</coverage_type>
    <week>${esc(week)}</week>
    <players>
${players}
    </players>
  </roster>
</fantasy_content>`;
  return put(`/team/${teamKey}/roster`, xml);
}

/**
 * Add and/or drop. Omit `drop` for a straight add, omit `add` for a straight
 * drop. `faab` (a number) turns an add into a waiver claim with that bid.
 */
export async function addDrop(leagueKey, teamKey, { add = null, drop = null, faab = null } = {}) {
  if (!add && !drop) throw new Error('addDrop needs at least one of add / drop.');
  const type = add && drop ? 'add/drop' : add ? 'add' : 'drop';
  const parts = [];
  if (add) {
    parts.push(
      `    <player><player_key>${esc(add)}</player_key>` +
      `<transaction_data><type>add</type>` +
      `<destination_team_key>${esc(teamKey)}</destination_team_key></transaction_data></player>`);
  }
  if (drop) {
    parts.push(
      `    <player><player_key>${esc(drop)}</player_key>` +
      `<transaction_data><type>drop</type>` +
      `<source_team_key>${esc(teamKey)}</source_team_key></transaction_data></player>`);
  }
  const body = parts.length > 1
    ? `  <players>\n${parts.join('\n')}\n  </players>`
    : parts[0].replace(/^ {4}/, '  ');

  const xml =
`<?xml version="1.0"?>
<fantasy_content>
  <transaction>
    <type>${type}</type>${faab !== null && faab !== undefined ? `\n    <faab_bid>${esc(faab)}</faab_bid>` : ''}
${body}
  </transaction>
</fantasy_content>`;
  return post(`/league/${leagueKey}/transactions`, xml);
}
