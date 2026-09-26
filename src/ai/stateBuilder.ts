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
import type { ChoiceQuestion, DecideRequest, EnemyType, Intent, PlayerMove, WorldSnapshot } from './types';

/** Question ids used when Jev also pilots the player. Enemy ids look like `e12`, so no clash. */
export const PILOT_MOVE_Q = 'player_move';
export const PILOT_TARGET_Q = 'player_target';

const PILOT_INSTRUCTIONS =
  'You are now piloting the PLAYER (state.player) against this squad. Goal: survive and kill every enemy. ' +
  'Use cover when hurt or when the weapon is overheated, dash only to escape point-blank danger, ' +
  'circle-strafe ranged gunners, and never let flankers get behind you.';

const MOVE_CRITERIA: Record<PlayerMove, string> = {
  advance: 'Push toward the target to finish it off',
  strafe_left: 'Circle-strafe to the left around the target while shooting',
  strafe_right: 'Circle-strafe to the right around the target while shooting',
  retreat: 'Back away from the nearest threats while shooting',
  take_cover: 'Move behind a pillar to break line of sight, heal up and let the gun cool',
  dash_away: 'Dash out of immediate danger (only when dash is ready and enemies are point-blank)',
};

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
  'the nearest units (low closeness_rank) should usually keep the pressure on while others flank; ' +
  'flank when the front is crowded; keep committed to a tactic unless the situation clearly changed.';

export interface BuiltRequest {
  request: DecideRequest;
  /** Enemy ids that got a Jev question (nearest first). */
  ids: string[];
}

export interface BuildOptions {
  /** Also ask Jev how to move the player and whom to shoot. */
  pilot?: boolean;
}

export function buildRequest(world: WorldSnapshot, maxBatch: number, opts: BuildOptions = {}): BuiltRequest {
  const p = world.player;
  const sorted = [...world.enemies].sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos));
  const batch = sorted.slice(0, maxBatch);
  const allPos = world.enemies.map((e) => e.pos);

  const count = (i: Intent) => world.enemies.filter((e) => e.intent === i).length;
  const enemyEntries = batch.map((e, rank) => {
    const los = hasLineOfSight(e.pos, p.pos, world.pillars);
    return {
      id: e.id,
      type: e.type,
      closeness_rank: rank + 1,
      health: healthBucket(e.hp / e.maxHp),
      distance: distanceBucket(dist(e.pos, p.pos)),
      position: bearingBucket(p.pos, p.facing, e.pos),
      in_cover: !los,
      current_tactic: e.intent,
      allies_nearby: alliesBucket(e.pos, allPos),
    };
  });

  const player: Record<string, string | boolean> = {
    health: healthBucket(p.hp / p.maxHp),
    weapon: heatBucket(p.heat, p.overheated),
    movement: movementBucket(p.speed, p.strafing, p.recentlyDashed),
  };
  if (opts.pilot) {
    player.dash = p.dashReady ? 'ready' : 'recharging';
    player.enemies_point_blank = enemyEntries.filter((e) => e.distance === 'point-blank').length > 0;
    player.enemies_behind = enemyEntries.some((e) => e.position === 'behind the player');
  }

  const state = {
    wave: world.wave,
    player,
    squad: {
      alive: world.enemies.length,
      chasing: count('chase'),
      flanking: count('flank'),
      retreating: count('retreat'),
    },
    enemies: enemyEntries,
  };

  const questions: Record<string, ChoiceQuestion> = {};
  for (const e of batch) {
    questions[e.id] = {
      type: 'choice',
      instructions: INSTRUCTIONS.replace('{id}', e.id),
      criteria: CRITERIA[e.type],
    };
  }
  if (opts.pilot && batch.length) {
    questions[PILOT_MOVE_Q] = { type: 'choice', instructions: PILOT_INSTRUCTIONS + ' Pick how the player moves next.', criteria: MOVE_CRITERIA };
    const targets: Record<string, string> = {};
    for (const e of enemyEntries) {
      targets[e.id] = `${e.type}, ${e.health} health, ${e.distance}, ${e.position}, ${e.current_tactic}${e.in_cover ? ', in cover' : ''}`;
    }
    questions[PILOT_TARGET_Q] = {
      type: 'choice',
      instructions: PILOT_INSTRUCTIONS + ' Pick which enemy the player should shoot now: prefer the most dangerous one you can hit.',
      criteria: targets,
    };
  }
  return { request: { state, questions }, ids: batch.map((e) => e.id) };
}
