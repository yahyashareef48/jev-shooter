import * as THREE from 'three';
import type { Events } from '../core/Events';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { ProjectileSystem } from '../entities/Projectile';

/** Closest distance from point c to segment a→b. */
function segPointDist(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(c, a).dot(ab) / Math.max(ab.lengthSq(), 1e-8), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(c);
}

export interface CombatStats {
  score: number;
  kills: number;
  flankKills: number;
  combo: number;
  comboTimer: number;
  bestCombo: number;
}

const COMBO_WINDOW = 3;

export class CombatSystem {
  stats: CombatStats = CombatSystem.fresh();

  constructor(
    private events: Events,
    private projectiles: ProjectileSystem,
  ) {}

  static fresh(): CombatStats {
    return { score: 0, kills: 0, flankKills: 0, combo: 0, comboTimer: 0, bestCombo: 0 };
  }

  reset() {
    this.stats = CombatSystem.fresh();
  }

  get multiplier() {
    return Math.min(8, 1 + Math.floor(this.stats.combo / 3));
  }

  /** Resolves bolt hits. Returns enemies killed this frame. */
  update(dt: number, time: number, player: Player, enemies: readonly Enemy[]): Enemy[] {
    const st = this.stats;
    st.comboTimer -= dt;
    if (st.comboTimer <= 0) st.combo = 0;

    const killed: Enemy[] = [];
    for (const b of this.projectiles.player.items) {
      if (!b.alive) continue;
      for (const e of enemies) {
        if (!e.alive) continue;
        const c = e.center;
        if (segPointDist(b.prev, b.pos, c) > e.stats.radius) continue;
        b.alive = false;
        const dir = b.vel.clone().normalize();
        const { dealt, shielded } = e.damage(b.damage, dir, time);
        this.events.emit('enemyHit', { x: b.pos.x, y: b.pos.y, z: b.pos.z, damage: Math.round(dealt), shielded });
        if (!e.alive) {
          killed.push(e);
          st.kills++;
          st.combo++;
          st.bestCombo = Math.max(st.bestCombo, st.combo);
          st.comboTimer = COMBO_WINDOW;
          const pts = e.stats.score * this.multiplier;
          st.score += pts;
          if (e.intent === 'flank') st.flankKills++;
          this.events.emit('enemyKilled', {
            x: c.x, y: c.y, z: c.z, color: e.glowColor.getHex(), score: pts, intent: e.intent, big: e.type === 'brute',
          });
        }
        break;
      }
    }

    if (player.alive) {
      const pc = new THREE.Vector3(player.pos.x, 1.1, player.pos.z);
      for (const b of this.projectiles.enemy.items) {
        if (!b.alive) continue;
        if (segPointDist(b.prev, b.pos, pc) < 0.75) {
          b.alive = false;
          if (!player.dashing) player.damage(b.damage);
          this.events.emit('impact', { x: b.pos.x, y: b.pos.y, z: b.pos.z, color: 0xff4fd8 });
        }
      }
    }
    return killed;
  }
}
