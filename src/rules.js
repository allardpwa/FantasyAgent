import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './auth.js';

const RULES_FILE = path.join(ROOT, 'config', 'rules.json');

export function loadRules() {
  const r = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  if (r.dry_run === undefined) r.dry_run = true; // fail closed
  return r;
}

export function saveRules(r) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(r, null, 2) + '\n');
}

/**
 * Gate every write behind the guardrails. Returns { allowed, reason }.
 * `action` is 'lineup' | 'claim' | 'drop' | 'trade'.
 */
export function checkAllowed(rules, action, ctx = {}) {
  if (rules.dry_run) {
    return { allowed: false, reason: 'dry_run is true in config/rules.json - nothing will be written to Yahoo.' };
  }
  if (action === 'lineup' && !rules.lineup.auto_set) {
    return { allowed: false, reason: 'lineup.auto_set is false.' };
  }
  if (action === 'claim') {
    if (!rules.waivers.auto_claim) return { allowed: false, reason: 'waivers.auto_claim is false.' };
    const { faab, faabBalance, claimsThisWeek = 0, projectedGain } = ctx;
    if (claimsThisWeek >= rules.waivers.max_claims_per_week) {
      return { allowed: false, reason: `already at max_claims_per_week (${rules.waivers.max_claims_per_week}).` };
    }
    if (projectedGain !== undefined && projectedGain < rules.waivers.min_projected_gain) {
      return { allowed: false, reason: `projected gain ${projectedGain} is below min_projected_gain ${rules.waivers.min_projected_gain}.` };
    }
    if (faab != null && faabBalance != null) {
      const cap = Math.floor((rules.waivers.max_faab_bid_pct / 100) * faabBalance);
      if (faab > cap) return { allowed: false, reason: `bid ${faab} exceeds max_faab_bid_pct cap of ${cap}.` };
      if (faabBalance - faab < rules.waivers.min_faab_reserve) {
        return { allowed: false, reason: `bid ${faab} would drop FAAB below min_faab_reserve ${rules.waivers.min_faab_reserve}.` };
      }
    }
  }
  if (action === 'drop') {
    const { playerName = '', playerKey = '' } = ctx;
    const blocked = (rules.waivers.never_drop || []).some(
      (n) => n === playerKey || n.toLowerCase() === playerName.toLowerCase());
    if (blocked) return { allowed: false, reason: `${playerName} is on the never_drop list.` };
  }
  if (action === 'trade' && !rules.trades.auto_propose) {
    return { allowed: false, reason: 'trades.auto_propose is false - trades need your approval.' };
  }
  return { allowed: true, reason: 'permitted by config/rules.json' };
}
