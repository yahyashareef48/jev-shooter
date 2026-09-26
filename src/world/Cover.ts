import { add, dist, hasLineOfSight, norm, scale, sub, type Circle, type XZ } from '../core/math';

const COVER_GAP = 1.8;

/** The spot directly behind a pillar as seen from the player. */
export function coverPoint(pillar: Circle, playerPos: XZ, standoff = COVER_GAP): XZ {
  const away = norm(sub(pillar, playerPos));
  return add(pillar, scale(away, pillar.r + standoff));
}

/**
 * Pick the cover point cheapest to reach that doesn't require running at the player.
 * Returns null only when there are no pillars.
 */
export function bestCover(from: XZ, playerPos: XZ, pillars: readonly Circle[]): XZ | null {
  let best: XZ | null = null;
  let bestCost = Infinity;
  const myDist = dist(from, playerPos);
  for (const p of pillars) {
    const c = coverPoint(p, playerPos);
    const travel = dist(from, c);
    // Penalise cover that is much closer to the player than we are now.
    const towardPlayer = Math.max(0, myDist - dist(c, playerPos)) * 2.5;
    const cost = travel + towardPlayer;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

export function isInCover(pos: XZ, playerPos: XZ, pillars: readonly Circle[]): boolean {
  return !hasLineOfSight(pos, playerPos, pillars);
}
