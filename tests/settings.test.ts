import { afterEach, describe, expect, it } from 'vitest';
import { chooseOrb, fallbackPilot } from '../src/ai/pilot';
import { PROMPTS, STATE_FIELDS } from '../src/ai/prompts';
import { buildRequest, orbBucket, PILOT_MOVE_Q } from '../src/ai/stateBuilder';
import type { WorldSnapshot } from '../src/ai/types';
import { settings } from '../src/settings/store';

function world(hp: number, orbs: { x: number; z: number }[] = [], enemyAt = { x: 0, z: -20 }): WorldSnapshot {
  return {
    wave: 1,
    player: {
      pos: { x: 0, z: 0 },
      facing: { x: 0, z: -1 },
      hp,
      maxHp: 100,
      heat: 0,
      overheated: false,
      speed: 0,
      strafing: false,
      recentlyDashed: false,
      dashReady: true,
    },
    enemies: [{ id: 'e1', type: 'drone', pos: enemyAt, hp: 30, maxHp: 30, intent: 'chase' }],
    pillars: [],
    orbs,
  };
}

describe('health orbs', () => {
  it('ignores orbs when healthy, and when the heal would mostly be wasted', () => {
    expect(chooseOrb({ x: 0, z: 0 }, 95, 100, [{ x: 2, z: 0 }], [])).toBeNull();
  });

  it('grabs a close, unguarded orb in passing when moderately hurt', () => {
    expect(chooseOrb({ x: 0, z: 0 }, 70, 100, [{ x: 5, z: 0 }], [])?.need).toBe('opportunistic');
    // Too far for a detour at this health.
    expect(chooseOrb({ x: 0, z: 0 }, 70, 100, [{ x: 20, z: 0 }], [])).toBeNull();
  });

  it('skips guarded orbs unless desperate and close', () => {
    const guard = [{ x: 6, z: 0 }];
    expect(chooseOrb({ x: 0, z: 0 }, 70, 100, [{ x: 5, z: 0 }], guard)).toBeNull();
    expect(chooseOrb({ x: 0, z: 0 }, 20, 100, [{ x: 5, z: 0 }], guard)?.need).toBe('urgent');
  });

  it('makes a long detour when badly hurt', () => {
    expect(chooseOrb({ x: 0, z: 0 }, 25, 100, [{ x: 20, z: 0 }], [])?.need).toBe('urgent');
  });

  it('fallback pilot prefers an urgent orb over cover, but not when healthy', () => {
    expect(fallbackPilot(world(25, [{ x: 10, z: 5 }]), 1).move).toBe('grab_health');
    expect(fallbackPilot(world(25), 1).move).toBe('take_cover');
    expect(fallbackPilot(world(100, [{ x: 3, z: 0 }]), 1).move).not.toBe('grab_health');
  });

  it('only offers grab_health to Jev when there is an orb, and describes it', () => {
    const none = buildRequest(world(50), 40, { pilot: true }).request.questions[PILOT_MOVE_Q];
    expect(Object.keys(none.criteria)).not.toContain('grab_health');
    const some = buildRequest(world(50, [{ x: 4, z: 0 }]), 40, { pilot: true }).request;
    expect(Object.keys(some.questions[PILOT_MOVE_Q].criteria)).toContain('grab_health');
    expect((some.state as { player: { health_orbs: string } }).player.health_orbs).toBe('close, safe');
    expect(orbBucket({ x: 0, z: 0 }, [{ x: 4, z: 0 }], [{ x: 5, z: 0 }])).toBe('close, guarded by an enemy');
  });
});

describe('editable prompts and state', () => {
  const saved = { instr: PROMPTS.enemyInstructions, health: STATE_FIELDS.enemy.health };
  afterEach(() => {
    PROMPTS.enemyInstructions = saved.instr;
    STATE_FIELDS.enemy.health = saved.health;
  });

  it('uses edited instructions and drops disabled state fields', () => {
    PROMPTS.enemyInstructions = 'Custom for {id}; again {id}';
    STATE_FIELDS.enemy.health = false;
    const { request } = buildRequest(world(100), 40);
    expect(request.questions.e1.instructions).toBe('Custom for e1; again e1');
    const e = (request.state as { enemies: Record<string, unknown>[] }).enemies[0];
    expect(e).not.toHaveProperty('health');
    expect(e).toHaveProperty('distance');
  });
});

describe('settings store', () => {
  it('edits live objects, tracks defaults, and round-trips overrides', () => {
    const cfg = { speed: 10, name: 'a', on: true };
    settings.group('Test', 'Group', [
      { label: 'speed', key: 'speed', obj: cfg },
      { label: 'name', key: 'name', obj: cfg },
      { label: 'on', key: 'on', obj: cfg },
    ]);
    const [speed, name, on] = settings.fields.filter((f) => f.tab === 'Test');
    expect([speed.kind, name.kind, on.kind]).toEqual(['number', 'text', 'bool']);

    settings.set(speed, 25);
    expect(cfg.speed).toBe(25);
    expect(settings.isModified(speed)).toBe(true);
    expect(settings.overrides()).toEqual({ 'Test/Group/speed': 25 });

    settings.resetTab('Test');
    expect(cfg.speed).toBe(10);
    settings.apply({ 'Test/Group/name': 'b', 'Test/Group/on': 'not a bool', 'Nope/x/y': 1 });
    expect(cfg.name).toBe('b');
    expect(cfg.on).toBe(true); // wrong type ignored
  });
});
