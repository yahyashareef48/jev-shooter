import { describe, expect, it } from 'vitest';
import { alliesBucket, bearingBucket, distanceBucket, healthBucket, heatBucket, movementBucket } from '../src/ai/buckets';

describe('buckets', () => {
  it('buckets health', () => {
    expect(healthBucket(1)).toBe('full');
    expect(healthBucket(0.8)).toBe('high');
    expect(healthBucket(0.5)).toBe('half');
    expect(healthBucket(0.3)).toBe('low');
    expect(healthBucket(0.1)).toBe('critical');
  });

  it('buckets distance', () => {
    expect(distanceBucket(2)).toBe('point-blank');
    expect(distanceBucket(8)).toBe('close');
    expect(distanceBucket(20)).toBe('mid-range');
    expect(distanceBucket(40)).toBe('far');
  });

  it('computes bearing relative to where the player faces', () => {
    const p = { x: 0, z: 0 };
    const facing = { x: 0, z: -1 }; // looking down -z, so +x is the player's right
    expect(bearingBucket(p, facing, { x: 0, z: -10 })).toBe('in front of the player');
    expect(bearingBucket(p, facing, { x: 0, z: 10 })).toBe('behind the player');
    expect(bearingBucket(p, facing, { x: 10, z: 0 })).toBe("on the player's right");
    expect(bearingBucket(p, facing, { x: -10, z: 0 })).toBe("on the player's left");
  });

  it('describes heat and movement', () => {
    expect(heatBucket(1, true)).toMatch(/overheated/);
    expect(heatBucket(0.8, false)).toBe('overheating');
    expect(heatBucket(0.1, false)).toBe('cool');
    expect(movementBucket(0, false, false)).toBe('standing still');
    expect(movementBucket(8, true, false)).toBe('strafing');
    expect(movementBucket(8, false, true)).toBe('just dashed');
  });

  it('counts nearby allies, excluding self', () => {
    const self = { x: 0, z: 0 };
    expect(alliesBucket(self, [self])).toBe('alone');
    expect(alliesBucket(self, [self, { x: 1, z: 0 }])).toBe('few');
    expect(alliesBucket(self, [self, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }])).toBe('many');
  });
});
