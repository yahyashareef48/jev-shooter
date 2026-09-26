import { describe, expect, it } from 'vitest';
import { buildRequest } from '../src/ai/stateBuilder';
import type { WorldSnapshot } from '../src/ai/types';

function world(n: number): WorldSnapshot {
  return {
    wave: 3,
    player: {
      pos: { x: 0, z: 0 },
      facing: { x: 0, z: -1 },
      hp: 40,
      maxHp: 100,
      heat: 1,
      overheated: true,
      speed: 5,
      strafing: true,
      recentlyDashed: false,
    },
    enemies: Array.from({ length: n }, (_, i) => ({
      id: `e${i + 1}`,
      type: i % 3 === 0 ? ('gunner' as const) : ('drone' as const),
      pos: { x: 0, z: -(n - i) * 3 }, // e1 is the farthest
      hp: 10,
      maxHp: 30,
      intent: 'chase' as const,
    })),
    pillars: [{ x: 0, z: -4.5, r: 1 }],
  };
}

describe('buildRequest', () => {
  it('makes one choice question per enemy with all three tactics', () => {
    const { request, ids } = buildRequest(world(5), 40);
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      const q = request.questions[id];
      expect(q.type).toBe('choice');
      expect(Object.keys(q.criteria).sort()).toEqual(['chase', 'flank', 'retreat']);
      expect(q.instructions).toContain(id);
    }
  });

  it('sends semantic buckets, never raw numbers for health/distance', () => {
    const { request } = buildRequest(world(3), 40);
    const state = request.state as { player: Record<string, string>; enemies: Record<string, unknown>[] };
    expect(state.player.health).toBe('low');
    expect(state.player.weapon).toMatch(/overheated/);
    for (const e of state.enemies) {
      expect(typeof e.health).toBe('string');
      expect(typeof e.distance).toBe('string');
    }
  });

  it('caps the batch to the nearest enemies', () => {
    const { ids, request } = buildRequest(world(10), 4);
    expect(ids).toEqual(['e10', 'e9', 'e8', 'e7']);
    expect(Object.keys(request.questions)).toHaveLength(4);
  });

  it('marks enemies behind a pillar as in cover', () => {
    const { request } = buildRequest(world(3), 40);
    const enemies = (request.state as { enemies: { id: string; in_cover: boolean }[] }).enemies;
    // e3 at z=-3 is in front of the pillar at z=-4.5; e1 at z=-9 is behind it.
    expect(enemies.find((e) => e.id === 'e3')!.in_cover).toBe(false);
    expect(enemies.find((e) => e.id === 'e1')!.in_cover).toBe(true);
  });
});
