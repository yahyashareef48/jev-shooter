import * as THREE from 'three';
import { pilotMoveVector, type Pilot } from '../ai/pilot';
import { ARENA } from '../core/config';
import { damp, hasLineOfSight, type Circle } from '../core/math';
import type { Enemy } from '../entities/Enemy';
import type { Player, PlayerControls } from '../entities/Player';
import type { ThirdPersonCamera } from '../entities/ThirdPersonCamera';

const TURN_RATE = 7; // rad/s cap, so the aim looks human rather than snapping
const FIRE_CONE = 0.07;

/**
 * Turns the pilot's current Jev decision (move tactic + target) into per-frame controls:
 * steers, aims the camera at the target, fires when lined up and manages heat.
 */
export class Autopilot {
  target: Enemy | null = null;

  constructor(
    private pilot: Pilot,
    private player: Player,
    private cam: ThirdPersonCamera,
    private camera: THREE.PerspectiveCamera,
    private enemies: () => readonly Enemy[],
    private pickups: () => readonly THREE.Vector3[],
    private pillars: readonly Circle[],
  ) {}

  update(dt: number): PlayerControls {
    const p = this.player;
    const enemies = this.enemies().filter((e) => e.alive);
    const d = this.pilot.decision;

    // Keep Jev's target while it lives; otherwise pick the nearest visible enemy until the next call.
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
    this.target = target;

    // ---- aim ----
    let aligned = false;
    if (target) {
      const c = target.center;
      const from = this.camera.position;
      const dx = c.x - from.x;
      const dz = c.z - from.z;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(c.y - from.y, Math.hypot(dx, dz));
      const yawErr = Math.atan2(Math.sin(wantYaw - this.cam.yaw), Math.cos(wantYaw - this.cam.yaw));
      const pitchErr = wantPitch - this.cam.pitch;
      const maxStep = TURN_RATE * dt;
      this.cam.yaw += THREE.MathUtils.clamp(yawErr * damp(12, dt), -maxStep, maxStep);
      this.cam.pitch += THREE.MathUtils.clamp(pitchErr * damp(12, dt), -maxStep, maxStep);
      aligned = Math.abs(yawErr) < FIRE_CONE && Math.abs(pitchErr) < FIRE_CONE * 1.5;
    } else {
      this.cam.pitch += (-0.12 - this.cam.pitch) * damp(4, dt);
    }

    // ---- fire: only when lined up, visible and not about to jam the gun ----
    let fire = false;
    if (target && aligned && !p.overheated) {
      const visible = hasLineOfSight(p.pos, target.pos, this.pillars);
      const inRange = target.pos.distanceTo(p.pos) < 50;
      const heatOk = p.heat < 0.88 || target.hpFrac < 0.3;
      fire = visible && inRange && heatOk;
    }

    // ---- move ----
    const threats = enemies.map((e) => ({ pos: e.pos }));
    let move = enemies.length
      ? pilotMoveVector(d.move, p.pos, target ? target.pos : null, threats, this.pillars, ARENA.radius)
      : { x: -p.pos.x * 0.05, z: -p.pos.z * 0.05 }; // drift back to the centre between waves

    // Grab a health orb on the way when hurt.
    if (p.hp < 60 && d.move !== 'dash_away') {
      const orb = this.pickups().find((o) => Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < 14);
      if (orb) {
        const ox = orb.x - p.pos.x;
        const oz = orb.z - p.pos.z;
        const l = Math.hypot(ox, oz) || 1;
        move = { x: move.x * 0.4 + ox / l, z: move.z * 0.4 + oz / l };
      }
    }

    const dash = p.dashCooldown <= 0 && this.pilot.consumeDash();
    return { move, fire, dash };
  }
}
