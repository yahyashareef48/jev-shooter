import * as THREE from 'three';
import { pilotMoveVector, type Pilot } from '../ai/pilot';
import type { PlayerMove } from '../ai/types';
import { ARENA, PLAYER } from '../core/config';
import { hasLineOfSight, type Circle } from '../core/math';
import type { Enemy } from '../entities/Enemy';
import type { Player, PlayerControls } from '../entities/Player';
import type { ThirdPersonCamera } from '../entities/ThirdPersonCamera';

const TURN_RATE = 14; // rad/s cap: fast, but still visibly turns rather than teleporting
const AIM_GAIN = 25; // proportional correction on top of the feed-forward
/** No damage dealt for this long while engaging → the current tactic isn't working. */
const STALL_AFTER = 3.5;
const UNSTICK_FOR = 2.5;

/**
 * Turns the pilot's current Jev decision (move tactic + target) into per-frame controls.
 * Aims with target lead and feed-forward so it can track while strafing, fires only when the
 * bolt will actually connect, and breaks stalemates when nothing is landing.
 */
export class Autopilot {
  target: Enemy | null = null;
  /** Where the gun should shoot this frame (lead-corrected target centre). */
  readonly aimPoint = new THREE.Vector3();
  hasAim = false;
  /** Set while the stall breaker has overridden Jev's move. */
  unsticking = false;
  private lastHitAt = 0;
  private unstickUntil = -1;
  private prevWant: { yaw: number; pitch: number } | null = null;
  private ffYaw = 0;
  private ffPitch = 0;
  private prevTarget: Enemy | null = null;
  private ray = new THREE.Ray();
  private tmp = new THREE.Vector3();

  constructor(
    private pilot: Pilot,
    private player: Player,
    private cam: ThirdPersonCamera,
    private camera: THREE.PerspectiveCamera,
    private enemies: () => readonly Enemy[],
    private pickups: () => readonly THREE.Vector3[],
    private pillars: readonly Circle[],
  ) {}

  /** Called when any player bolt hits an enemy. */
  noteHit(now: number) {
    this.lastHitAt = now;
  }

  reset(now: number) {
    this.lastHitAt = now;
    this.unstickUntil = -1;
    this.prevWant = null;
    this.target = this.prevTarget = null;
  }

  update(dt: number, now: number): PlayerControls {
    const p = this.player;
    const enemies = this.enemies().filter((e) => e.alive);
    const d = this.pilot.decision;

    // Keep Jev's target while it lives; otherwise pick the best visible enemy until the next call.
    let target = enemies.find((e) => e.id === d.targetId) ?? null;
    if (!target && enemies.length) {
      let best = Infinity;
      for (const e of enemies) {
        const score = e.pos.distanceTo(p.pos) + (hasLineOfSight(p.pos, e.pos, this.pillars) ? 0 : 30);
        if (score < best) {
          best = score;
          target = e;
        }
      }
    }
    if (target !== this.prevTarget) {
      this.lastHitAt = now; // fresh target, fresh stall timer
      this.prevWant = null;
      this.prevTarget = target;
    }
    this.target = target;

    // ---- aim: lead the target, feed-forward its angular motion, then correct the error ----
    let fire = false;
    this.hasAim = false;
    if (target) {
      const c = target.center;
      const muzzle = p.muzzleWorld(this.tmp);
      const tof = muzzle.distanceTo(c) / PLAYER.bulletSpeed;
      this.aimPoint.set(c.x + target.vel.x * tof, c.y, c.z + target.vel.z * tof);
      this.hasAim = true;

      const from = this.camera.position;
      const dx = this.aimPoint.x - from.x;
      const dz = this.aimPoint.z - from.z;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(this.aimPoint.y - from.y, Math.hypot(dx, dz));
      if (this.prevWant && dt > 0) {
        const dyaw = Math.atan2(Math.sin(wantYaw - this.prevWant.yaw), Math.cos(wantYaw - this.prevWant.yaw));
        // Smoothed angular velocity of the aim line (our strafing + the target's movement).
        this.ffYaw += (dyaw / dt - this.ffYaw) * 0.35;
        this.ffPitch += ((wantPitch - this.prevWant.pitch) / dt - this.ffPitch) * 0.35;
      } else {
        this.ffYaw = this.ffPitch = 0;
      }
      this.prevWant = { yaw: wantYaw, pitch: wantPitch };

      const yawErr = Math.atan2(Math.sin(wantYaw - this.cam.yaw), Math.cos(wantYaw - this.cam.yaw));
      const pitchErr = wantPitch - this.cam.pitch;
      const maxStep = TURN_RATE * dt;
      const k = Math.min(1, AIM_GAIN * dt);
      this.cam.yaw += THREE.MathUtils.clamp(this.ffYaw * dt + yawErr * k, -maxStep, maxStep);
      this.cam.pitch += THREE.MathUtils.clamp(this.ffPitch * dt + pitchErr * k, -maxStep, maxStep);

      // Fire when the muzzle→aim line is clear of pillars and the view is on the target,
      // and don't jam the gun unless the kill is close.
      this.ray.origin.copy(from);
      this.ray.direction.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const onTarget = this.ray.distanceToPoint(this.aimPoint) < target.stats.radius * 1.4;
      const visible = hasLineOfSight(p.pos, target.pos, this.pillars);
      const heatOk = p.heat < 0.88 || target.hpFrac < 0.3;
      fire = onTarget && visible && !p.overheated && heatOk && target.pos.distanceTo(p.pos) < 55;
    } else {
      this.prevWant = null;
      this.cam.pitch += (-0.12 - this.cam.pitch) * Math.min(1, 4 * dt);
    }

    // ---- stall breaker: if nothing has landed for a while, stop dancing and close in ----
    const hurt = p.hp < PLAYER.maxHp * 0.4;
    if (target && !hurt && now - this.lastHitAt > STALL_AFTER && now > this.unstickUntil) {
      this.unstickUntil = now + UNSTICK_FOR;
      this.lastHitAt = now;
    }
    this.unsticking = now < this.unstickUntil && !!target;
    const move: PlayerMove = this.unsticking ? 'advance' : d.move;

    // ---- move ----
    const threats = enemies.map((e) => ({ pos: e.pos }));
    let wish = enemies.length
      ? pilotMoveVector(move, p.pos, target ? target.pos : null, threats, this.pillars, ARENA.radius)
      : { x: -p.pos.x * 0.05, z: -p.pos.z * 0.05 }; // drift back to the centre between waves

    // A blocked shot is worse than a bad angle: step sideways out from behind the pillar.
    if (target && !hasLineOfSight(p.pos, target.pos, this.pillars) && move !== 'take_cover') {
      const tx = target.pos.x - p.pos.x;
      const tz = target.pos.z - p.pos.z;
      const l = Math.hypot(tx, tz) || 1;
      wish = { x: wish.x * 0.5 + (-tz / l) * 0.8, z: wish.z * 0.5 + (tx / l) * 0.8 };
    }

    // Grab a health orb on the way when hurt.
    if (p.hp < 60 && move !== 'dash_away') {
      const orb = this.pickups().find((o) => Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < 14);
      if (orb) {
        const ox = orb.x - p.pos.x;
        const oz = orb.z - p.pos.z;
        const l = Math.hypot(ox, oz) || 1;
        wish = { x: wish.x * 0.4 + ox / l, z: wish.z * 0.4 + oz / l };
      }
    }

    const dash = p.dashCooldown <= 0 && this.pilot.consumeDash();
    return { move: wish, fire, dash };
  }
}
