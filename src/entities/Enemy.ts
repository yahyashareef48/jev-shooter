import * as THREE from 'three';
import { chaseTarget, desiredVelocity, flankTarget, retreatTarget } from '../ai/steering';
import type { DecisionSource, EnemyType, Intent } from '../ai/types';
import { ARENA } from '../core/config';
import { damp, dist, hasLineOfSight, type Circle, type XZ } from '../core/math';
import { buildEnemyVisual, INTENT_COLOR, intentIconMaterial, STATS, type EnemyStats, type EnemyVisual } from './EnemyTypes';

export interface EnemyContext {
  time: number;
  playerPos: THREE.Vector3;
  playerFacing: THREE.Vector3;
  playerAlive: boolean;
  pillars: readonly Circle[];
  neighbours: readonly XZ[];
  meleePlayer: (damage: number) => void;
  shoot: (from: THREE.Vector3, dir: THREE.Vector3, damage: number) => void;
}

/** Seconds a flanker circles before it gives up on the perfect angle and attacks. */
const FLANK_COMMIT_AFTER = 4;

let nextId = 1;
export const resetEnemyIds = () => (nextId = 1);

export class Enemy {
  readonly id = `e${nextId++}`;
  readonly stats: EnemyStats;
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly vel = new THREE.Vector3();
  hp: number;
  alive = true;
  intent: Intent = 'chase';
  intentSince = -99;
  source: DecisionSource = 'fallback';
  probs: Partial<Record<Intent, number>> | null = null;
  confidence: number | null = null;
  flankSide: 1 | -1 = 1;
  flankInPosition = false;
  inCover = false;
  hasLos = true;
  /** Set when this flanker has already triggered the FLANKED warning. */
  flankAlerted = false;
  lastDamagedAt = -99;
  private attackCd = 0.8;
  private hitFlash = 0;
  private spawnT = 0;
  private visual: EnemyVisual;
  private icon: THREE.Sprite;
  private color = new THREE.Color();

  constructor(readonly type: EnemyType, x: number, z: number) {
    this.stats = STATS[type];
    this.hp = this.stats.hp;
    this.pos.set(x, 0, z);
    this.visual = buildEnemyVisual(type);
    this.visual.root.position.y = this.stats.hoverY;
    this.group.add(this.visual.root);
    this.icon = new THREE.Sprite(intentIconMaterial('chase'));
    this.icon.scale.setScalar(0.55);
    // Layer 1 is visible to the main camera but skipped by the floor reflection pass.
    this.icon.layers.set(1);
    this.icon.position.y = this.stats.hoverY + this.stats.radius + 0.75;
    this.group.add(this.icon);
    this.color.copy(INTENT_COLOR.chase);
    this.group.scale.setScalar(0.01);
  }

  get hpFrac() {
    return this.hp / this.stats.hp;
  }

  /** World-space centre of the body (for hit tests and aiming). */
  get center(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.stats.hoverY, this.pos.z);
  }

  setIntent(intent: Intent, source: DecisionSource, now: number, probs?: Partial<Record<Intent, number>>, confidence?: number) {
    this.source = source;
    this.probs = probs ?? null;
    this.confidence = confidence ?? null;
    if (intent === this.intent) return false;
    this.intent = intent;
    this.intentSince = now;
    this.flankInPosition = false;
    this.flankAlerted = false;
    this.icon.material = intentIconMaterial(intent);
    return true;
  }

  /** Returns damage actually applied (brute shields soak frontal hits). */
  damage(amount: number, fromDir: THREE.Vector3, now: number): { dealt: number; shielded: boolean } {
    let shielded = false;
    if (this.type === 'brute') {
      const fwd = new THREE.Vector3(-Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));
      // fromDir points from shooter to us; a frontal hit travels against our forward.
      if (fwd.dot(fromDir) < -0.5) {
        amount *= 0.3;
        shielded = true;
      }
    }
    this.hp -= amount;
    this.hitFlash = 1;
    this.lastDamagedAt = now;
    if (this.hp <= 0) this.alive = false;
    return { dealt: amount, shielded };
  }

  update(dt: number, ctx: EnemyContext) {
    const s = this.stats;
    const player = ctx.playerPos;
    const d = dist(this.pos, player);
    this.hasLos = hasLineOfSight(this.pos, player, ctx.pillars);

    // ---- choose a target point for the current tactic ----
    let target: XZ;
    let speed = s.speed;
    let attacking = this.intent === 'chase';
    if (this.intent === 'chase') {
      target = chaseTarget(this.pos, player, s.range);
      if (this.type === 'drone' && d < 7) speed *= 1.5; // lunge
      if (this.type === 'brute' && d < 9) speed = 11; // charge
    } else if (this.intent === 'flank') {
      const plan = flankTarget(this.pos, player, ctx.playerFacing, this.flankSide, s.flankRadius);
      // If the player keeps turning to face us the flank point keeps moving; after a few seconds
      // of circling, commit to the attack instead of orbiting forever.
      this.flankInPosition ||= plan.inPosition || ctx.time - this.intentSince > FLANK_COMMIT_AFTER;
      if (this.flankInPosition && s.range === 0) {
        target = { x: player.x, z: player.z };
        speed *= this.type === 'drone' ? 1.5 : 1.3;
      } else target = plan.target;
      attacking = this.flankInPosition || s.range > 0;
      speed *= 1.1;
    } else {
      target = retreatTarget(this.pos, player, ctx.pillars);
      speed *= 1.15;
    }

    const want = desiredVelocity(this.pos, this.vel, target, speed, ctx.neighbours, ctx.pillars, s.radius);
    const spawnFactor = Math.min(1, this.spawnT * 2);
    this.vel.x += (want.x * spawnFactor - this.vel.x) * damp(6, dt);
    this.vel.z += (want.z * spawnFactor - this.vel.z) * damp(6, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const r = Math.hypot(this.pos.x, this.pos.z);
    const max = ARENA.radius - s.radius;
    if (r > max) {
      this.pos.x *= max / r;
      this.pos.z *= max / r;
    }

    // ---- cover & regen ----
    this.inCover = !this.hasLos;
    if (this.intent === 'retreat' && this.inCover && ctx.time - this.lastDamagedAt > 1.5) {
      this.hp = Math.min(s.hp, this.hp + s.regen * dt);
    }

    // ---- attacks ----
    this.attackCd -= dt;
    if (ctx.playerAlive && this.spawnT > 0.6 && this.attackCd <= 0) {
      if (s.range > 0) {
        const canShoot = this.hasLos && d < 34 && (attacking || this.intent === 'retreat');
        if (canShoot) {
          this.attackCd = s.attackCooldown * (this.intent === 'retreat' ? 1.6 : 1) * (0.85 + Math.random() * 0.3);
          const from = this.visual.muzzle!.getWorldPosition(new THREE.Vector3());
          const aim = new THREE.Vector3(player.x, 1.1, player.z).sub(from).normalize();
          aim.x += (Math.random() - 0.5) * 0.06;
          aim.y += (Math.random() - 0.5) * 0.04;
          ctx.shoot(from, aim.normalize(), s.damage);
        }
      } else if (attacking && d < s.radius + 0.8 + 0.7) {
        this.attackCd = s.attackCooldown;
        ctx.meleePlayer(s.damage);
      }
    }

    // ---- visuals ----
    this.spawnT += dt;
    this.group.scale.setScalar(Math.min(1, this.spawnT * 2.2) ** 0.6);
    const face = this.intent === 'retreat' && !this.hasLos && Math.hypot(this.vel.x, this.vel.z) > 1
      ? { x: this.vel.x, z: this.vel.z }
      : { x: player.x - this.pos.x, z: player.z - this.pos.z };
    const yaw = Math.atan2(-face.x, -face.z);
    let dy = yaw - this.group.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.group.rotation.y += dy * damp(this.type === 'brute' ? 4 : 9, dt);

    const v = this.visual;
    v.root.position.y = s.hoverY + Math.sin(ctx.time * 2.5 + this.pos.x) * 0.12;
    if (v.spinner) v.spinner.rotation.y += dt * (this.type === 'drone' ? 5 : 1.5);
    if (this.type === 'drone') v.root.rotation.z = -this.vel.x * 0.02;
    this.color.lerp(INTENT_COLOR[this.intent], damp(5, dt));
    this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
    v.accent.color.copy(this.color).addScalar(this.hitFlash * 3);
    v.body.emissive.setRGB(this.hitFlash, this.hitFlash, this.hitFlash);
    this.icon.material.opacity = 0.85;
    this.icon.position.y = s.hoverY + s.radius + 0.75 + Math.sin(ctx.time * 3) * 0.05;
  }

  get glowColor() {
    return this.color;
  }

  dispose() {
    this.visual.body.dispose();
    this.visual.accent.dispose();
    (this.visual.shield?.material as THREE.Material | undefined)?.dispose();
  }
}
