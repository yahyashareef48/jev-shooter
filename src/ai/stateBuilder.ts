// Turns a WorldSnapshot into one batched Jev request: shared state + one choice question per enemy.

import { dist, hasLineOfSight } from '../core/math';
import {
  alliesBucket,
  bearingBucket,
  distanceBucket,
  healthBucket,
  heatBucket,
  movementBucket,
} from './buckets';
import type { ChoiceQuestion, DecideRequest, EnemyType, Intent, WorldSnapshot } from './types';

const CRITERIA: Record<EnemyType, Record<Intent, string>> = {
  drone: {
    chase: 'Rush straight at the player and zap them up close',
    flank: "Swing wide around to the player's side or back, then strike",
    retreat: 'Break line of sight behind a pillar and recover health',
  },
  gunner: {
    chase: 'Advance to firing range and shoot the player head-on',
    flank: "Reposition to the player's side or back and fire from there",
    retreat: 'Fall back to cover behind a pillar, firing only if exposed',
  },
  brute: {
    chase: 'Push forward shield-first and charge when close',
    flank: "Circle slowly to hit the player's unshielded side or back",
    retreat: 'Withdraw behind a pillar to regenerate',
  },
};

const INSTRUCTIONS =
  'Pick the next tactic for enemy {id} (its entry is in state.enemies). ' +
  'Enemies share one goal: kill the player. Coordinate as a squad: not everyone should do the same thing; ' +
  'badly wounded units should survive to fight later; punish an overheated, low-health or distracted player; ' +
  'flank when the front is crowded; keep committed to a tactic unless the situation clearly changed.';

export interface BuiltRequest {
  request: DecideRequest;
  /** Enemy ids that got a Jev question (nearest first). */
  ids: string[];
}

export function buildRequest(world: WorldSnapshot, maxBatch: number): BuiltRequest {
  const p = world.player;
  const sorted = [...world.enemies].sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos));
  const batch = sorted.slice(0, maxBatch);
  const allPos = world.enemies.map((e) => e.pos);

  const count = (i: Intent) => world.enemies.filter((e) => e.intent === i).length;
  const state = {
    wave: world.wave,
    player: {
      health: healthBucket(p.hp / p.maxHp),
      weapon: heatBucket(p.heat, p.overheated),
      movement: movementBucket(p.speed, p.strafing, p.recentlyDashed),
    },
    squad: {
      alive: world.enemies.length,
      chasing: count('chase'),
      flanking: count('flank'),
      retreating: count('retreat'),
    },
    enemies: batch.map((e) => {
      const los = hasLineOfSight(e.pos, p.pos, world.pillars);
      return {
        id: e.id,
        type: e.type,
        health: healthBucket(e.hp / e.maxHp),
        distance: distanceBucket(dist(e.pos, p.pos)),
        position: bearingBucket(p.pos, p.facing, e.pos),
        in_cover: !los,
        current_tactic: e.intent,
        allies_nearby: alliesBucket(e.pos, allPos),
      };
    }),
  };

  const questions: Record<string, ChoiceQuestion> = {};
  for (const e of batch) {
    questions[e.id] = {
      type: 'choice',
      instructions: INSTRUCTIONS.replace('{id}', e.id),
      criteria: CRITERIA[e.type],
    };
  }
  return { request: { state, questions }, ids: batch.map((e) => e.id) };
}
