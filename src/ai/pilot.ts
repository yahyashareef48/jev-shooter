// Jev autopilot for the player. Jev picks the tactic (how to move, whom to shoot) in the same
// batched call as the squad; local reflexes do the frame-by-frame aiming, firing and steering.

import { add, clamp, dist, hasLineOfSight, len, norm, scale, sub, type Circle, type XZ } from '../core/math';
import { bestCover } from '../world/Cover';
import { avoidPillars } from './steering';
import { PLAYER_MOVES, type ChoiceAnswer, type DecisionSource, type PlayerMove, type WorldSnapshot } from './types';

export interface PilotDecision {
  move: PlayerMove;
  targetId: string | null;
  source: DecisionSource;
  moveProbs: Partial<Record<PlayerMove, number>> | null;
  moveConfidence: number | null;
  targetConfidence: number | null;
  since: number;
}

/** Local stand-in used when Jev is unavailable or unsure. Pure, so it is unit-testable. */
export function fallbackPilot(world: WorldSnapshot, strafeSign: 1 | -1): { move: PlayerMove; targetId: string | null } {
  const p = world.player;
  const hpFrac = p.hp / p.maxHp;
  let targetId: string | null = null;
  let best = Infinity;
  let nearest = Infinity;
  let pointBlank = 0;
  for (const e of world.enemies) {
    const d = dist(e.pos, p.pos);
    nearest = Math.min(nearest, d);
    if (d < 5) pointBlank++;
    const visible = hasLineOfSight(p.pos, e.pos, world.pillars);
    // Close, weak and visible enemies first; flankers get priority because they hurt most.
    const score = d + (e.hp / e.maxHp) * 10 + (visible ? 0 : 25) - (e.intent === 'flank' ? 6 : 0);
    if (score < best) {
      best = score;
      targetId = e.id;
    }
  }
  let move: PlayerMove;
  if (pointBlank >= 2 && p.dashReady) move = 'dash_away';
  else if (hpFrac < 0.35 || p.overheated) move = 'take_cover';
  else if (nearest < 5) move = 'retreat';
  else move = strafeSign > 0 ? 'strafe_right' : 'strafe_left';
  return { move, targetId };
}

export interface Threat {
  pos: XZ;
}

/**
 * World-space XZ direction for a movement tactic. `target` is the enemy being engaged
 * (or null), `threats` are all live enemies.
 */
export function pilotMoveVector(
  move: PlayerMove,
  self: XZ,
  target: XZ | null,
  threats: readonly Threat[],
  pillars: readonly Circle[],
  arenaRadius: number,
): XZ {
  // Threat centre, weighted towards whoever is closest.
  let wx = 0;
  let wz = 0;
  let wsum = 0;
  for (const t of threats) {
    const w = 1 / Math.max(2, dist(t.pos, self));
    wx += t.pos.x * w;
    wz += t.pos.z * w;
    wsum += w;
  }
  const centroid = wsum > 0 ? { x: wx / wsum, z: wz / wsum } : { x: 0, z: 0 };
  const focus = target ?? centroid;
  const toT = norm(sub(focus, self));
  const d = dist(focus, self);
  const away = norm(sub(self, centroid));

  let v: XZ;
  switch (move) {
    case 'advance':
      v = d > 8 ? toT : scale({ x: -toT.z, z: toT.x }, 0.6);
      break;
    case 'strafe_left':
    case 'strafe_right': {
      const side = move === 'strafe_right' ? 1 : -1;
      const perp = { x: -toT.z * side, z: toT.x * side };
      const radial = d < 10 ? -0.5 : d > 20 ? 0.5 : 0; // hold a comfortable band
      v = add(perp, scale(toT, radial));
      break;
    }
    case 'retreat':
    case 'dash_away':
      v = away;
      break;
    case 'take_cover': {
      const c = bestCover(self, centroid, pillars);
      if (!c) v = away;
      else {
        const to = sub(c, self);
        const l = len(to);
        v = l < 0.8 ? { x: 0, z: 0 } : scale(norm(to), clamp(l / 2, 0.3, 1));
      }
      break;
    }
  }

  // Stay off the wall and out of pillars.
  const r = len(self);
  const soft = arenaRadius - 10;
  if (r > soft) v = add(v, scale(norm(self), -(r - soft) / 6));
  v = add(v, avoidPillars(self, v, pillars, 0.8));
  return len(v) > 1 ? norm(v) : v;
}

export function isPlayerMove(s: unknown): s is PlayerMove {
  return typeof s === 'string' && (PLAYER_MOVES as readonly string[]).includes(s);
}

export class Pilot {
  enabled = false;
  decision: PilotDecision = {
    move: 'strafe_right',
    targetId: null,
    source: 'fallback',
    moveProbs: null,
    moveConfidence: null,
    targetConfidence: null,
    since: 0,
  };
  jevDecisions = 0;
  localDecisions = 0;
  private strafeSign: 1 | -1 = 1;
  private dashUsed = false;

  private set(move: PlayerMove, targetId: string | null, source: DecisionSource, now: number) {
    if (move !== this.decision.move) {
      this.decision.since = now;
      this.dashUsed = false;
      if (move === 'strafe_left') this.strafeSign = -1;
      if (move === 'strafe_right') this.strafeSign = 1;
    }
    this.decision.move = move;
    this.decision.targetId = targetId;
    this.decision.source = source;
  }

  /**
   * Apply Jev's answers to the two pilot questions. Low-confidence parts are filled in by the
   * local fallback. Targets get a lower gate because probability is spread over many enemies.
   */
  applyAnswers(
    move: ChoiceAnswer | undefined,
    target: ChoiceAnswer | undefined,
    world: WorldSnapshot,
    validTargets: ReadonlySet<string>,
    now: number,
    gate: number,
    source: DecisionSource,
  ) {
    const local = fallbackPilot(world, this.strafeSign);
    const moveConf = move?.confidence ?? null;
    const targetConf = target?.confidence ?? null;
    const moveOk = isPlayerMove(move?.choice) && (moveConf ?? 1) >= gate;
    const targetOk = !!target && validTargets.has(target.choice) && (targetConf ?? 1) >= gate * 0.4;
    this.set(moveOk ? (move!.choice as PlayerMove) : local.move, targetOk ? target!.choice : local.targetId, moveOk || targetOk ? source : 'fallback', now);
    this.decision.moveProbs = (move?.probabilities as PilotDecision['moveProbs']) ?? null;
    this.decision.moveConfidence = moveConf;
    this.decision.targetConfidence = targetConf;
    if (moveOk || targetOk) this.jevDecisions++;
    else this.localDecisions++;
  }

  fallback(world: WorldSnapshot, now: number) {
    const local = fallbackPilot(world, this.strafeSign);
    this.set(local.move, local.targetId, 'fallback', now);
    this.decision.moveProbs = null;
    this.decision.moveConfidence = null;
    this.decision.targetConfidence = null;
    this.localDecisions++;
  }

  /** Dash is a one-shot per dash_away decision. */
  consumeDash(): boolean {
    if (this.decision.move !== 'dash_away' || this.dashUsed) return false;
    this.dashUsed = true;
    return true;
  }
}
