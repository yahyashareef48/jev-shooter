// Pure steering helpers that turn a tactic (chase / flank / retreat) into a target point.
// Operates on {x, z} so it is independent of three.js and unit-testable.

import {
  add,
  angleBetween,
  clamp,
  clampLen,
  dist,
  len,
  norm,
  rotate,
  scale,
  sub,
  xz,
  type Circle,
  type XZ,
} from '../core/math';
import { bestCover } from '../world/Cover';

export const FLANK_ANGLE = (130 * Math.PI) / 180;
const MAX_ARC_STEP = (50 * Math.PI) / 180;

/** Chase: go straight at the player, or hold at `range` for ranged units. */
export function chaseTarget(self: XZ, player: XZ, range = 0): XZ {
  if (range <= 0) return { x: player.x, z: player.z };
  const away = norm(sub(self, player));
  return add(player, scale(away, range));
}

export interface FlankPlan {
  target: XZ;
  /** True once we are within the flank arc and should commit to the attack. */
  inPosition: boolean;
}

/**
 * Flank: orbit around the player towards a point `side` × 130° off the direction they face,
 * stepping at most 50° per plan so the path is an arc instead of cutting through their aim.
 */
export function flankTarget(self: XZ, player: XZ, facing: XZ, side: 1 | -1, radius: number): FlankPlan {
  const rel = sub(self, player);
  const curDist = len(rel);
  const goalDir = rotate(norm(facing), side * FLANK_ANGLE);
  const cur = curDist > 1e-3 ? norm(rel) : goalDir;
  const diff = angleBetween(cur, goalDir);
  const step = clamp(diff, -MAX_ARC_STEP, MAX_ARC_STEP);
  const inPosition = Math.abs(diff) < 0.45;
  // While travelling keep a wide berth, then tighten to the attack radius.
  const r = inPosition ? radius : Math.max(radius, Math.min(curDist, radius * 1.7));
  return { target: add(player, scale(rotate(cur, step), r)), inPosition };
}

/** Retreat: nearest sensible cover behind a pillar, otherwise straight away from the player. */
export function retreatTarget(self: XZ, player: XZ, pillars: readonly Circle[]): XZ {
  return bestCover(self, player, pillars) ?? add(self, scale(norm(sub(self, player)), 10));
}

/** Seek with arrival slowdown. */
export function arrive(self: XZ, target: XZ, maxSpeed: number, slowRadius = 2.5): XZ {
  const d = sub(target, self);
  const l = len(d);
  if (l < 0.05) return xz();
  const speed = l < slowRadius ? maxSpeed * (l / slowRadius) : maxSpeed;
  return scale(d, speed / l);
}

/** Push away from neighbours closer than `radius`. */
export function separation(self: XZ, neighbours: readonly XZ[], radius: number): XZ {
  let fx = 0;
  let fz = 0;
  for (const n of neighbours) {
    const dx = self.x - n.x;
    const dz = self.z - n.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4 && d < radius) {
      const w = (radius - d) / radius;
      fx += (dx / d) * w;
      fz += (dz / d) * w;
    }
  }
  return { x: fx, z: fz };
}

/** Steer tangentially around pillars that lie ahead within `lookahead`. */
export function avoidPillars(self: XZ, vel: XZ, pillars: readonly Circle[], bodyRadius: number, lookahead = 4): XZ {
  const v = norm(vel);
  if (v.x === 0 && v.z === 0) return xz();
  let fx = 0;
  let fz = 0;
  for (const p of pillars) {
    const to = sub(p, self);
    const along = to.x * v.x + to.z * v.z;
    if (along <= 0 || along > lookahead + p.r) continue;
    // Signed distance of the pillar centre from our path; positive = pillar is on the (v.z, -v.x) side.
    const lateral = to.x * v.z - to.z * v.x;
    const clearance = p.r + bodyRadius + 0.6;
    if (Math.abs(lateral) > clearance) continue;
    // Push along (-v.z, v.x) scaled by side, i.e. away from the pillar.
    const side = lateral >= 0 ? 1 : -1;
    const strength = (1 - along / (lookahead + p.r)) * 1.5;
    fx += -v.z * side * strength;
    fz += v.x * side * strength;
  }
  return { x: fx, z: fz };
}

/** Combine goal-seeking with separation and avoidance into a capped desired velocity. */
export function desiredVelocity(
  self: XZ,
  vel: XZ,
  target: XZ,
  maxSpeed: number,
  neighbours: readonly XZ[],
  pillars: readonly Circle[],
  bodyRadius: number,
): XZ {
  let v = arrive(self, target, maxSpeed);
  const sep = separation(self, neighbours, bodyRadius * 2 + 1.2);
  const avoid = avoidPillars(self, dist(self, target) > 0.5 ? v : vel, pillars, bodyRadius);
  v = add(v, scale(sep, maxSpeed * 1.2));
  v = add(v, scale(avoid, maxSpeed));
  return clampLen(v, maxSpeed);
}
