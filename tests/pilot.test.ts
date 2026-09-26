import { describe, expect, it } from 'vitest';
import { Director, type DecideFn, type DirectedUnit } from '../src/ai/director';
import { fallbackPilot, Pilot, pilotMoveVector } from '../src/ai/pilot';
import { buildRequest, PILOT_MOVE_Q, PILOT_TARGET_Q } from '../src/ai/stateBuilder';
import type { DecideResponse, WorldSnapshot } from '../src/ai/types';
import { dist } from '../src/core/math';

function world(over: Partial<WorldSnapshot['player']> = {}, enemies = 3): WorldSnapshot {
  return {
    wave: 2,
    player: {
      pos: { x: 0, z: 0 },
      facing: { x: 0, z: -1 },
      hp: 100,
      maxHp: 100,
      heat: 0,
      overheated: false,
      speed: 0,
      strafing: false,
      recentlyDashed: false,
      dashReady: true,
      ...over,
    },
    enemies: Array.from({ length: enemies }, (_, i) => ({
      id: `e${i + 1}`,
      type: 'drone' as const,
      pos: { x: 0, z: -8 - i * 6 },
      hp: 30,
      maxHp: 30,
      intent: 'chase' as const,
    })),
    pillars: [],
  };
}

describe('pilot request', () => {
  it('adds move + target questions only when piloting', () => {
    expect(buildRequest(world(), 40).request.questions[PILOT_MOVE_Q]).toBeUndefined();
    const { request } = buildRequest(world(), 40, { pilot: true });
    expect(Object.keys(request.questions[PILOT_MOVE_Q].criteria)).toContain('take_cover');
    expect(Object.keys(request.questions[PILOT_TARGET_Q].criteria).sort()).toEqual(['e1', 'e2', 'e3']);
    expect((request.state as { player: { dash: string } }).player.dash).toBe('ready');
  });
});

describe('fallbackPilot', () => {
  it('takes cover when hurt or jammed', () => {
    expect(fallbackPilot(world({ hp: 20 }), 1).move).toBe('take_cover');
    expect(fallbackPilot(world({ overheated: true, heat: 1 }), 1).move).toBe('take_cover');
  });

  it('dashes away when swarmed at point-blank', () => {
    const w = world();
    w.enemies[0].pos = { x: 1, z: 1 };
    w.enemies[1].pos = { x: -1, z: 2 };
    expect(fallbackPilot(w, 1).move).toBe('dash_away');
  });

  it('strafes and targets the closest enemy otherwise', () => {
    const r = fallbackPilot(world(), -1);
    expect(r.move).toBe('strafe_left');
    expect(r.targetId).toBe('e1');
  });
});

describe('pilotMoveVector', () => {
  const self = { x: 0, z: 0 };
  const target = { x: 0, z: -15 };
  const threats = [{ pos: target }];

  it('strafes perpendicular to the target', () => {
    const v = pilotMoveVector('strafe_right', self, target, threats, [], 58);
    expect(Math.abs(v.z)).toBeLessThan(0.2);
    expect(v.x).toBeGreaterThan(0.8); // facing -z, right is +x
  });

  it('retreats away from threats and advances toward the target', () => {
    expect(pilotMoveVector('retreat', self, target, threats, [], 58).z).toBeGreaterThan(0.5);
    expect(pilotMoveVector('advance', self, target, threats, [], 58).z).toBeLessThan(-0.5);
  });

  it('heads behind a pillar to take cover', () => {
    const pillars = [{ x: 6, z: 0, r: 2 }];
    const v = pilotMoveVector('take_cover', self, target, threats, pillars, 58);
    const next = { x: self.x + v.x, z: self.z + v.z };
    expect(dist(next, { x: 6, z: 4 })).toBeLessThan(dist(self, { x: 6, z: 4 }));
  });
});

describe('Pilot.applyAnswers', () => {
  it('uses confident Jev answers and falls back on shaky ones', () => {
    const pilot = new Pilot();
    const w = world();
    const ids = new Set(['e1', 'e2', 'e3']);
    pilot.applyAnswers({ choice: 'advance', confidence: 0.8 }, { choice: 'e3', confidence: 0.6 }, w, ids, 1, 0.35, 'jev');
    expect(pilot.decision).toMatchObject({ move: 'advance', targetId: 'e3', source: 'jev' });

    pilot.applyAnswers({ choice: 'moonwalk', confidence: 0.9 }, { choice: 'e99', confidence: 0.9 }, w, ids, 2, 0.35, 'jev');
    expect(pilot.decision.source).toBe('fallback');
    expect(pilot.decision.targetId).toBe('e1');
  });

  it('fires dash only once per dash_away decision', () => {
    const pilot = new Pilot();
    pilot.applyAnswers({ choice: 'dash_away', confidence: 0.9 }, undefined, world(), new Set(), 1, 0.35, 'jev');
    expect(pilot.consumeDash()).toBe(true);
    expect(pilot.consumeDash()).toBe(false);
  });
});

describe('Director with pilot', () => {
  it('rides the player questions in the same batch and routes the answers', async () => {
    const units = ['e1', 'e2'].map((id, i): DirectedUnit => ({
      id,
      type: 'drone',
      pos: { x: 0, z: -8 - i * 6 },
      hpFrac: 1,
      alive: true,
      intent: 'chase',
      intentSince: -99,
      flankSide: 1,
      setIntent(next) {
        const changed = next !== this.intent;
        this.intent = next;
        return changed;
      },
    }));
    const sent: string[][] = [];
    const decide: DecideFn = async (req) => {
      sent.push(Object.keys(req.questions));
      return {
        answers: {
          e1: { choice: 'chase', confidence: 0.9 },
          e2: { choice: 'flank', confidence: 0.9 },
          [PILOT_MOVE_Q]: { choice: 'take_cover', confidence: 0.7 },
          [PILOT_TARGET_Q]: { choice: 'e2', confidence: 0.5 },
        },
        latencyMs: 5,
        mode: 'live',
      } satisfies DecideResponse;
    };
    const d = new Director(decide, () => units, () => 0, () => {});
    d.pilot = new Pilot();
    d.pilot.enabled = true;
    d.update(world({}, 2));
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.arrayContaining(['e1', 'e2', PILOT_MOVE_Q, PILOT_TARGET_Q]));
    expect(d.pilot.decision).toMatchObject({ move: 'take_cover', targetId: 'e2', source: 'jev' });
    expect(d.stats.staleDropped).toBe(0); // player answers are not mistaken for dead enemies
  });
});
