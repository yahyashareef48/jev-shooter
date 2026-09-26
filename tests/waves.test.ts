import { describe, expect, it } from 'vitest';
import { WAVES } from '../src/core/config';
import { composeWave, spawnPoint } from '../src/systems/WaveSystem';

describe('waves', () => {
  it('grows by two enemies per wave and caps at the max', () => {
    expect(composeWave(1)).toHaveLength(6);
    expect(composeWave(5)).toHaveLength(14);
    expect(composeWave(100)).toHaveLength(WAVES.maxEnemies);
  });

  it('introduces gunners on wave 2 and brutes on wave 4', () => {
    expect(composeWave(1).every((t) => t === 'drone')).toBe(true);
    expect(composeWave(2)).toContain('gunner');
    expect(composeWave(3)).not.toContain('brute');
    expect(composeWave(4)).toContain('brute');
  });

  it('spawns away from the player and clear of pillars', () => {
    const pillars = [{ x: 30, z: 0, r: 2.2 }];
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 50; i++) {
      const p = spawnPoint({ x: 20, z: 0 }, pillars, rand);
      expect(Math.hypot(p.x - 20, p.z)).toBeGreaterThan(22);
      expect(Math.hypot(p.x - 30, p.z)).toBeGreaterThan(4.2);
    }
  });
});
