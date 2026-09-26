import type { EnemyType } from '../ai/types';
import { WAVES } from '../core/config';
import type { Events } from '../core/Events';
import type { Circle, XZ } from '../core/math';

/** Enemy roster for wave n (1-based). Pure so it can be unit-tested. */
export function composeWave(n: number): EnemyType[] {
  const count = Math.min(WAVES.maxEnemies, 4 + 2 * n);
  const brutes = n >= 4 ? Math.min(5, Math.floor(n / 2) - 1) : 0;
  const gunners = n >= 2 ? Math.floor(count * (n >= 5 ? 0.35 : 0.3)) : 0;
  const drones = Math.max(0, count - brutes - gunners);
  const roster: EnemyType[] = [];
  // Interleave so each spawn burst is mixed.
  const pools: [EnemyType, number][] = [['drone', drones], ['gunner', gunners], ['brute', brutes]];
  while (roster.length < count) {
    for (const p of pools) {
      if (p[1] > 0) {
        roster.push(p[0]);
        p[1]--;
      }
    }
  }
  return roster;
}

/** Spawn point on the outer ring, away from the player and clear of pillars. */
export function spawnPoint(player: XZ, pillars: readonly Circle[], rand = Math.random): XZ {
  const pa = Math.atan2(player.z, player.x);
  for (let tries = 0; tries < 20; tries++) {
    const a = pa + Math.PI + (rand() - 0.5) * Math.PI * 1.4;
    const r = 44 + rand() * 10;
    const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    const clear = pillars.every((c) => Math.hypot(p.x - c.x, p.z - c.z) > c.r + 2);
    const far = Math.hypot(p.x - player.x, p.z - player.z) > 22;
    if (clear && far) return p;
  }
  return { x: -player.x * 0.9 || 40, z: -player.z * 0.9 };
}

type Phase = 'intermission' | 'spawning' | 'fighting';

export class WaveSystem {
  wave = 0;
  phase: Phase = 'intermission';
  timer = 2;
  private queue: EnemyType[] = [];

  constructor(private events: Events) {}

  reset() {
    this.wave = 0;
    this.phase = 'intermission';
    this.timer = 2;
    this.queue = [];
  }

  /** Advances the wave state machine; calls spawn() for each enemy that should appear now. */
  update(dt: number, aliveCount: number, spawn: (type: EnemyType) => void) {
    this.timer -= dt;
    if (this.phase === 'intermission') {
      if (this.timer <= 0) {
        this.wave++;
        this.queue = composeWave(this.wave);
        this.phase = 'spawning';
        this.timer = 0;
        this.events.emit('waveStart', { wave: this.wave });
      }
    } else if (this.phase === 'spawning') {
      while (this.timer <= 0 && this.queue.length) {
        spawn(this.queue.shift()!);
        this.timer += WAVES.spawnInterval;
      }
      if (!this.queue.length) this.phase = 'fighting';
    } else if (aliveCount === 0) {
      this.events.emit('waveCleared', { wave: this.wave });
      this.phase = 'intermission';
      this.timer = WAVES.intermission;
    }
  }
}
