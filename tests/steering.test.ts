import { describe, expect, it } from 'vitest';
import { angleBetween, dist, sub } from '../src/core/math';
import { avoidPillars, chaseTarget, flankTarget, retreatTarget, separation } from '../src/ai/steering';

const player = { x: 0, z: 0 };
const facing = { x: 0, z: -1 };

describe('steering', () => {
  it('chase goes straight for melee and holds range for ranged units', () => {
    expect(chaseTarget({ x: 10, z: 0 }, player)).toEqual({ x: 0, z: 0 });
    const t = chaseTarget({ x: 30, z: 0 }, player, 16);
    expect(dist(t, player)).toBeCloseTo(16);
  });

  it('flank arcs around the player instead of cutting through', () => {
    // Enemy straight in front of the player, flanking to the right.
    let self = { x: 0, z: -12 };
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const plan = flankTarget(self, player, facing, 1, 6);
      const step = Math.abs(angleBetween(sub(self, player), sub(plan.target, player)));
      expect(step).toBeLessThanOrEqual((50 * Math.PI) / 180 + 1e-6);
      self = plan.target;
      last = angleBetween(facing, sub(self, player));
      if (plan.inPosition) break;
    }
    // Ends up well past the player's right side, towards their back.
    expect(last).toBeGreaterThan((100 * Math.PI) / 180);
  });

  it('retreat picks the far side of a pillar', () => {
    const pillars = [{ x: 10, z: 0, r: 2 }];
    const t = retreatTarget({ x: 8, z: 3 }, player, pillars);
    expect(t.x).toBeGreaterThan(10);
  });

  it('separation pushes away from close neighbours', () => {
    const f = separation({ x: 0, z: 0 }, [{ x: 0.5, z: 0 }], 2);
    expect(f.x).toBeLessThan(0);
  });

  it('avoids pillars ahead by steering away from them', () => {
    const f = avoidPillars({ x: 0, z: 0 }, { x: 1, z: 0 }, [{ x: 3, z: 0.5, r: 1 }], 0.7);
    // Pillar is slightly to +z, so we should be pushed toward -z.
    expect(f.z).toBeLessThan(0);
  });
});
