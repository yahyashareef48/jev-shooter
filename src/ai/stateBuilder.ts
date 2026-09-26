// Turns a WorldSnapshot into one batched Jev request: shared state + one choice question per enemy.

import { dist, hasLineOfSight, type XZ } from '../core/math';
import {
  alliesBucket,
  bearingBucket,
  distanceBucket,
  healthBucket,
  heatBucket,
  movementBucket,
} from './buckets';
import { PROMPTS, STATE_FIELDS } from './prompts';
import type { ChoiceQuestion, DecideRequest, Intent, PlayerMove, WorldSnapshot } from './types';

/** Question ids used when Jev also pilots the player. Enemy ids look like `e12`, so no clash. */
export const PILOT_MOVE_Q = 'player_move';
export const PILOT_TARGET_Q = 'player_target';

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
  const ef = STATE_FIELDS.enemy;
  const pf = STATE_FIELDS.player;

  const facts = batch.map((e, rank) => ({
    e,
    rank: rank + 1,
    distance: distanceBucket(dist(e.pos, p.pos)),
    position: bearingBucket(p.pos, p.facing, e.pos),
    inCover: !hasLineOfSight(e.pos, p.pos, world.pillars),
  }));

  const enemyEntries = facts.map((f) => {
    const out: Record<string, unknown> = { id: f.e.id };
    if (ef.type) out.type = f.e.type;
    if (ef.closeness_rank) out.closeness_rank = f.rank;
    if (ef.health) out.health = healthBucket(f.e.hp / f.e.maxHp);
    if (ef.distance) out.distance = f.distance;
    if (ef.position) out.position = f.position;
    if (ef.in_cover) out.in_cover = f.inCover;
    if (ef.current_tactic) out.current_tactic = f.e.intent;
    if (ef.allies_nearby) out.allies_nearby = alliesBucket(f.e.pos, allPos);
    return out;
  });

  const player: Record<string, string | boolean> = {};
  if (pf.health) player.health = healthBucket(p.hp / p.maxHp);
  if (pf.weapon) player.weapon = heatBucket(p.heat, p.overheated);
  if (pf.movement) player.movement = movementBucket(p.speed, p.strafing, p.recentlyDashed);
  const orbs = opts.pilot ? orbBucket(p.pos, world.orbs ?? [], world.enemies.map((e) => e.pos)) : 'none';
  if (opts.pilot) {
    if (pf.dash) player.dash = p.dashReady ? 'ready' : 'recharging';
    if (pf.enemies_point_blank) player.enemies_point_blank = facts.some((f) => f.distance === 'point-blank');
    if (pf.enemies_behind) player.enemies_behind = facts.some((f) => f.position === 'behind the player');
    if (pf.shots) player.shots = p.landingShots ? 'landing' : 'missing (change approach)';
    if (pf.health_orbs) player.health_orbs = orbs;
  }

  const state: Record<string, unknown> = { wave: world.wave, player };
  if (STATE_FIELDS.squad.counts) {
    state.squad = {
      alive: world.enemies.length,
      chasing: count('chase'),
      flanking: count('flank'),
      retreating: count('retreat'),
    };
  }
  state.enemies = enemyEntries;

  const questions: Record<string, ChoiceQuestion> = {};
  for (const e of batch) {
    questions[e.id] = {
      type: 'choice',
      instructions: PROMPTS.enemyInstructions.split('{id}').join(e.id),
      criteria: { ...PROMPTS.enemyCriteria[e.type] },
    };
  }
  if (opts.pilot && batch.length) {
    // Only offer grab_health when there is actually an orb to grab.
    const moves = Object.entries(PROMPTS.moveCriteria).filter(([m]) => m !== 'grab_health' || orbs !== 'none');
    questions[PILOT_MOVE_Q] = {
      type: 'choice',
      instructions: `${PROMPTS.pilotInstructions} ${PROMPTS.pilotMoveQuestion}`,
      criteria: Object.fromEntries(moves) as Record<PlayerMove, string>,
    };
    const targets: Record<string, string> = {};
    for (const f of facts) {
      const hp = healthBucket(f.e.hp / f.e.maxHp);
      targets[f.e.id] = `${f.e.type}, ${hp} health, ${f.distance}, ${f.position}, ${f.e.intent}${f.inCover ? ', in cover' : ''}`;
    }
    questions[PILOT_TARGET_Q] = {
      type: 'choice',
      instructions: `${PROMPTS.pilotInstructions} ${PROMPTS.pilotTargetQuestion}`,
      criteria: targets,
    };
  }
  return { request: { state, questions }, ids: batch.map((e) => e.id) };
}

/** Nearest health orb as a bucket, flagged "guarded" if an enemy is sitting near it. */
export function orbBucket(player: XZ, orbs: readonly XZ[], enemies: readonly XZ[]): string {
  let best: XZ | null = null;
  let bd = Infinity;
  for (const o of orbs) {
    const d = dist(o, player);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  if (!best) return 'none';
  const range = bd < 10 ? 'close' : bd < 22 ? 'nearby' : 'far';
  const guarded = enemies.some((e) => dist(e, best!) < 6);
  return `${range}${guarded ? ', guarded by an enemy' : ', safe'}`;
}
