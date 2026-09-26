import { ARENA, PLAYER } from '../core/config';
import type { Circle } from '../core/math';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';

interface Body {
  pos: { x: number; z: number };
  r: number;
  /** Share of overlap this body absorbs when pushed (0 = immovable). */
  give: number;
}

function pushOutOfPillars(b: Body, pillars: readonly Circle[]) {
  for (const c of pillars) {
    const dx = b.pos.x - c.x;
    const dz = b.pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + b.r;
    if (d < min && d > 1e-5) {
      b.pos.x = c.x + (dx / d) * min;
      b.pos.z = c.z + (dz / d) * min;
    }
  }
}

function clampToArena(b: Body) {
  const r = Math.hypot(b.pos.x, b.pos.z);
  const max = ARENA.radius - b.r;
  if (r > max) {
    b.pos.x *= max / r;
    b.pos.z *= max / r;
  }
}

/** Hard circle-vs-circle resolution for player, enemies and pillars on the XZ plane. */
export function resolveCollisions(player: Player, enemies: readonly Enemy[], pillars: readonly Circle[]) {
  const bodies: Body[] = [];
  if (player.alive) bodies.push({ pos: player.pos, r: PLAYER.radius, give: 0.25 });
  for (const e of enemies) bodies.push({ pos: e.pos, r: e.stats.radius, give: e.type === 'brute' ? 0.3 : 1 });

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const min = a.r + b.r;
      if (d >= min || d < 1e-5) continue;
      const overlap = min - d;
      const total = a.give + b.give || 1;
      const nx = dx / d;
      const nz = dz / d;
      a.pos.x -= nx * overlap * (a.give / total);
      a.pos.z -= nz * overlap * (a.give / total);
      b.pos.x += nx * overlap * (b.give / total);
      b.pos.z += nz * overlap * (b.give / total);
    }
  }
  for (const b of bodies) {
    pushOutOfPillars(b, pillars);
    clampToArena(b);
  }
}
