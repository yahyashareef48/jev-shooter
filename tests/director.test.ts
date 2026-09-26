import { describe, expect, it } from 'vitest';
import { applyAnswers, balanceSquad, Director, type DecideFn, type DirectedUnit } from '../src/ai/director';
import type { DecideResponse, Intent, WorldSnapshot } from '../src/ai/types';
import { validate } from '../server/jevProxy';
import { mockDecide } from '../server/mockJev';

function unit(id: string, intent: Intent = 'chase', intentSince = -99, x = 0, z = -10): DirectedUnit {
  return {
    id,
    type: 'drone',
    pos: { x, z },
    hpFrac: 1,
    alive: true,
    intent,
    intentSince,
    flankSide: 1,
    setIntent(next) {
      if (next === this.intent) return false;
      this.intent = next;
      return true;
    },
  };
}

const res = (answers: DecideResponse['answers']): DecideResponse => ({ answers, latencyMs: 300, mode: 'live' });
const cfg = { gate: 0.35, minCommit: 1, switchMargin: 0.25 };
const probs = (c: number, f: number, r: number) => ({ chase: c, flank: f, retreat: r });

describe('applyAnswers', () => {
  it('applies confident answers', () => {
    const u = unit('e1');
    const r = applyAnswers(res({ e1: { choice: 'flank', probabilities: probs(0.2, 0.7, 0.1), confidence: 0.7 } }), new Map([['e1', u]]), 10, cfg, 'jev');
    expect(u.intent).toBe('flank');
    expect(r.changed).toEqual(['e1']);
  });

  it('gates low-confidence and invalid answers to the fallback', () => {
    const a = unit('a');
    const b = unit('b');
    const r = applyAnswers(
      res({
        a: { choice: 'flank', probabilities: probs(0.34, 0.33, 0.33), confidence: 0.2 },
        b: { choice: 'dance', confidence: 0.9 },
      }),
      new Map([['a', a], ['b', b]]),
      10,
      cfg,
      'jev',
    );
    expect(r.lowConfidence.sort()).toEqual(['a', 'b']);
    expect(a.intent).toBe('chase');
  });

  it('drops answers for dead or unknown enemies as stale', () => {
    const dead = { ...unit('d'), alive: false };
    const r = applyAnswers(res({ d: { choice: 'flank', confidence: 0.9 }, ghost: { choice: 'flank', confidence: 0.9 } }), new Map([['d', dead]]), 10, cfg, 'jev');
    expect(r.stale).toBe(2);
    expect(r.applied).toBe(0);
  });

  it('keeps a fresh tactic unless the new one is clearly better (hysteresis)', () => {
    const u = unit('e1', 'chase', 9.6);
    applyAnswers(res({ e1: { choice: 'flank', probabilities: probs(0.4, 0.55, 0.05), confidence: 0.55 } }), new Map([['e1', u]]), 10, cfg, 'jev');
    expect(u.intent).toBe('chase');
    applyAnswers(res({ e1: { choice: 'flank', probabilities: probs(0.1, 0.85, 0.05), confidence: 0.85 } }), new Map([['e1', u]]), 10, cfg, 'jev');
    expect(u.intent).toBe('flank');
  });
});

describe('balanceSquad', () => {
  it('caps flankers and demotes the least eager to their next-best tactic', () => {
    const units = ['a', 'b', 'c', 'd'].map((id) => unit(id));
    const pending = [
      { u: units[0], choice: 'flank' as Intent, probs: probs(0.1, 0.9, 0), conf: 0.9 },
      { u: units[1], choice: 'flank' as Intent, probs: probs(0.3, 0.6, 0.1), conf: 0.6 },
      { u: units[2], choice: 'flank' as Intent, probs: probs(0.2, 0.7, 0.1), conf: 0.7 },
      { u: units[3], choice: 'flank' as Intent, probs: probs(0.1, 0.5, 0.4), conf: 0.5 },
    ];
    const moved = balanceSquad(pending, units, { flank: 0.5 });
    expect(moved).toBe(2);
    expect(pending.map((p) => p.choice)).toEqual(['flank', 'chase', 'flank', 'retreat']);
  });
});

describe('Director', () => {
  const world = (units: DirectedUnit[]): WorldSnapshot => ({
    wave: 1,
    player: { pos: { x: 0, z: 0 }, facing: { x: 0, z: -1 }, hp: 100, maxHp: 100, heat: 0, overheated: false, speed: 0, strafing: false, recentlyDashed: false },
    enemies: units.map((u) => ({ id: u.id, type: u.type, pos: u.pos, hp: 30, maxHp: 30, intent: u.intent })),
    pillars: [],
  });

  it('sends ONE batched request for the whole squad', async () => {
    const units = Array.from({ length: 12 }, (_, i) => unit(`e${i}`, 'chase', -99, i, -10));
    const calls: number[] = [];
    const decide: DecideFn = async (req) => {
      calls.push(Object.keys(req.questions).length);
      return { ...mockDecide(req), latencyMs: 1, mode: 'mock' } as DecideResponse;
    };
    let t = 0;
    const d = new Director(decide, () => units, () => t, () => {}, true);
    d.update(world(units));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([12]);
    expect(d.stats.calls).toBe(1);
    // Not due again until the interval has passed.
    t = 0.5;
    d.update(world(units));
    expect(calls).toHaveLength(1);
  });

  it('backs off exponentially and falls back locally when Jev fails', async () => {
    const units = [unit('a'), unit('b', 'chase', -99, 3, -20)];
    let t = 0;
    const decide: DecideFn = () => Promise.reject(new Error('529 overloaded'));
    const d = new Director(decide, () => units, () => t, () => {}, false);
    d.update(world(units));
    await new Promise((r) => setTimeout(r, 0));
    expect(d.stats.status).toBe('error');
    expect(d.stats.backoffUntil).toBe(1);
    expect(d.stats.fallbackDecisions).toBeGreaterThan(0);
  });
});

describe('proxy validation', () => {
  it('accepts a batch of choice questions and rejects anything else', () => {
    const good = { request: { state: {}, questions: { e1: { type: 'choice', instructions: 'x', criteria: { a: 'b' } } } } };
    expect(validate(good)).toBeNull();
    expect(validate({ request: { state: {}, questions: {} } })).toMatch(/no questions/);
    expect(validate({ request: { state: {}, questions: { e1: { type: 'score', instructions: 'x', criteria: [] } } } })).toMatch(/choice/);
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`e${i}`, good.request.questions.e1]));
    expect(validate({ request: { state: {}, questions: many } })).toMatch(/too many/);
  });
});
