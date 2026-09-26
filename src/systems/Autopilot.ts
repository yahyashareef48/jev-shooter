import * as THREE from 'three';
import { chooseOrb, pilotMoveVector, type OrbNeed, type Pilot } from '../ai/pilot';
import type { PlayerMove } from '../ai/types';
import { ARENA, PILOT, PLAYER } from '../core/config';
import { hasLineOfSight, type Circle } from '../core/math';
import type { Enemy } from '../entities/Enemy';
import type { Player, PlayerControls } from '../entities/Player';
import type { ThirdPersonCamera } from '../entities/ThirdPersonCamera';


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
  /** The health orb we're committed to, and why. */
  orb: THREE.Vector3 | null = null;
  orbNeed: OrbNeed | null = null;
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
    this.orb = null;
    this.orbNeed = null;
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
      const maxStep = PILOT.turnRate * dt;
      const k = Math.min(1, PILOT.aimGain * dt);
      this.cam.yaw += THREE.MathUtils.clamp(this.ffYaw * dt + yawErr * k, -maxStep, maxStep);
      this.cam.pitch += THREE.MathUtils.clamp(this.ffPitch * dt + pitchErr * k, -maxStep, maxStep);

      // Fire when the muzzle→aim line is clear of pillars and the view is on the target,
      // and don't jam the gun unless the kill is close.
      this.ray.origin.copy(from);
      this.ray.direction.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const onTarget = this.ray.distanceToPoint(this.aimPoint) < target.stats.radius * 1.4;
      const visible = hasLineOfSight(p.pos, target.pos, this.pillars);
      const heatOk = p.heat < PILOT.heatLimit || target.hpFrac < 0.3;
      fire = onTarget && visible && !p.overheated && heatOk && target.pos.distanceTo(p.pos) < 55;
    } else {
      this.prevWant = null;
      this.cam.pitch += (-0.12 - this.cam.pitch) * Math.min(1, 4 * dt);
    }

    // ---- stall breaker: if nothing has landed for a while, stop dancing and close in ----
    const hurt = p.hp < PLAYER.maxHp * 0.4;
    if (target && !hurt && now - this.lastHitAt > PILOT.stallAfter && now > this.unstickUntil) {
      this.unstickUntil = now + PILOT.unstickFor;
      this.lastHitAt = now;
    }
    this.unsticking = now < this.unstickUntil && !!target;
    let move: PlayerMove = this.unsticking ? 'advance' : d.move;

    // ---- health orbs: a side quest, never the main goal ----
    this.updateOrb(enemies, move === 'grab_health');
    const dashing = move === 'dash_away';
    if (this.orb && !dashing && (this.orbNeed !== 'opportunistic' || move !== 'take_cover')) move = 'grab_health';
    else if (move === 'grab_health' && !this.orb) move = 'strafe_right'; // nothing worth grabbing

    // ---- move ----
    const threats = enemies.map((e) => ({ pos: e.pos }));
    let wish = enemies.length || this.orb
      ? pilotMoveVector(move, p.pos, target ? target.pos : null, threats, this.pillars, ARENA.radius, this.orb)
      : { x: -p.pos.x * 0.05, z: -p.pos.z * 0.05 }; // drift back to the centre between waves

    // A blocked shot is worse than a bad angle: step sideways out from behind the pillar.
    if (target && !hasLineOfSight(p.pos, target.pos, this.pillars) && move !== 'take_cover' && move !== 'grab_health') {
      const tx = target.pos.x - p.pos.x;
      const tz = target.pos.z - p.pos.z;
      const l = Math.hypot(tx, tz) || 1;
      wish = { x: wish.x * 0.5 + (-tz / l) * 0.8, z: wish.z * 0.5 + (tx / l) * 0.8 };
    }


    const dash = p.dashCooldown <= 0 && this.pilot.consumeDash();
    return { move: wish, fire, dash };
  }

  /**
   * Keep or pick an orb to go for. Once committed we stick with it until it is collected,
   * expires or becomes guarded, so the pilot doesn't dither between orb and fight.
   */
  private updateOrb(enemies: readonly Enemy[], requested: boolean) {
    const p = this.player;
    const orbs = this.pickups();
    const enemyPos = enemies.map((e) => e.pos);
    if (this.orb) {
      const still = orbs.includes(this.orb);
      const guarded = enemyPos.some((e) => e.distanceTo(this.orb!) < PILOT.orbGuardRadius);
      const topped = PLAYER.maxHp - p.hp < 5;
      // Health kept dropping since we committed: the side quest is now the priority.
      if (p.hp / PLAYER.maxHp < PILOT.orbUrgentHp) this.orbNeed = 'urgent';
      if (still && !topped && (!guarded || this.orbNeed === 'urgent')) return;
      this.orb = null;
      this.orbNeed = null;
    }
    const pick = chooseOrb(p.pos, p.hp, PLAYER.maxHp, orbs, enemyPos, requested);
    if (pick) {
      this.orb = pick.orb as THREE.Vector3;
      this.orbNeed = pick.need;
    }
  }
}
