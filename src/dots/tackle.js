// End-of-play rule for a run: tackle, touchdown or out of bounds.
// Pure: no THREE, no DOM, never mutates players.
import { BODY_RADIUS, engagedOn } from './blocking.js';
import { GOAL_LINE_Y } from './carrier.js';
import { HW } from '../util.js';

export const TACKLE_REACH = BODY_RADIUS / 2; // yd of arm reach beyond body contact; tunable
export const TACKLE_DIST = 2 * BODY_RADIUS + TACKLE_REACH; // center-to-center

// The single tackle predicate: later tackle ratings, tackle odds and seeded
// randomness go here, never in play.js.
export function canTackle(defender, carrier, players) {
  return (
    defender.team === 'defense' &&
    engagedOn(players, defender.id).length === 0 &&
    Math.hypot(defender.x - carrier.x, defender.y - carrier.y) <= TACKLE_DIST
  );
}

// Nearest defender who can tackle; ties keep players order.
export function findTackler(players, carrier) {
  let best = null;
  let bestD = Infinity;
  for (const d of players) {
    if (!canTackle(d, carrier, players)) continue;
    const dist = Math.hypot(d.x - carrier.x, d.y - carrier.y);
    if (dist < bestD) {
      best = d.id;
      bestD = dist;
    }
  }
  return best;
}

export function playEnd(players, carrierId) {
  const carrier = players.find((p) => p.id === carrierId);
  if (!carrier) return null;
  if (carrier.y >= GOAL_LINE_Y) return { reason: 'touchdown', by: null };
  if (Math.abs(carrier.x) > HW) return { reason: 'out', by: null };
  const by = findTackler(players, carrier);
  return by !== null ? { reason: 'tackle', by } : null;
}
