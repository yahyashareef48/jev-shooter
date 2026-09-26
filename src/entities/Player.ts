import * as THREE from 'three';
import { ARENA, COLORS, PLAYER } from '../core/config';
import type { Events } from '../core/Events';
import type { Input } from '../core/Input';
import { damp } from '../core/math';

const hdr = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);

/** What the pilot (keyboard/mouse or Jev autopilot) wants this frame. `move` is world-space XZ. */
export interface PlayerControls {
  move: { x: number; z: number };
  fire: boolean;
  dash: boolean;
}

/** Map WASD/mouse/shift to controls relative to where the camera faces. */
export function manualControls(input: Input, yaw: number): PlayerControls {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let x = 0;
  let z = 0;
  if (input.isDown('KeyW')) (x += fx), (z += fz);
  if (input.isDown('KeyS')) (x -= fx), (z -= fz);
  if (input.isDown('KeyD')) (x += -fz), (z += fx);
  if (input.isDown('KeyA')) (x -= -fz), (z -= fx);
  return {
    move: { x, z },
    fire: input.mouseDown,
    dash: input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight') || input.wasPressed('Space'),
  };
}

export interface FireRequest {
  from: THREE.Vector3;
  dir: THREE.Vector3;
}

/** Hover-mech the player drives. Faces wherever the camera looks (strafe shooter). */
export class Player {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly vel = new THREE.Vector3();
  readonly facing = new THREE.Vector3(0, 0, -1);
  hp = PLAYER.maxHp;
  heat = 0;
  overheated = false;
  dashCooldown = 0;
  strafing = false;
  alive = true;
  private dashTime = 0;
  private dashDir = new THREE.Vector3();
  private sinceDash = 99;
  private fireTimer = 0;
  private invuln = 0;
  private muzzle = new THREE.Object3D();
  private thrusterMat = new THREE.MeshBasicMaterial({ color: hdr(0.4, 2.2, 3) });
  private visorMat = new THREE.MeshBasicMaterial({ color: hdr(0.6, 2.6, 3.2) });
  private bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.75, roughness: 0.3 });
  private hitFlash = 0;
  private body = new THREE.Group();

  constructor(private events: Events) {
    const b = this.body;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 6, 16), this.bodyMat);
    torso.position.y = 1.15;
    b.add(torso);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), this.visorMat);
    visor.position.set(0, 1.42, -0.34);
    b.add(visor);

    const shoulderGeo = new THREE.BoxGeometry(0.28, 0.24, 0.5);
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(shoulderGeo, this.bodyMat);
      sh.position.set(0.52 * s, 1.35, 0);
      b.add(sh);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.46), this.thrusterMat);
      strip.position.set(0.67 * s, 1.35, 0);
      b.add(strip);
    }

    const gun = new THREE.Group();
    gun.position.set(0.62, 1.12, -0.2);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.95), this.bodyMat);
    barrel.position.z = -0.35;
    gun.add(barrel);
    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.5), this.thrusterMat);
    coil.position.set(0, 0.09, -0.35);
    gun.add(coil);
    this.muzzle.position.set(0, 0, -0.9);
    gun.add(this.muzzle);
    b.add(gun);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 32), this.thrusterMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.45;
    b.add(ring);

    this.group.add(b);
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 8);
    this.vel.set(0, 0, 0);
    this.hp = PLAYER.maxHp;
    this.heat = 0;
    this.overheated = false;
    this.dashCooldown = 0;
    this.dashTime = 0;
    this.sinceDash = 99;
    this.alive = true;
    this.group.visible = true;
  }

  get dashing() {
    return this.dashTime > 0;
  }
  get recentlyDashed() {
    return this.sinceDash < 2;
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  muzzleWorld(target = new THREE.Vector3()) {
    return this.muzzle.getWorldPosition(target);
  }

  update(dt: number, time: number, controls: PlayerControls, yaw: number, aimPoint: THREE.Vector3, fire: (r: FireRequest) => void) {
    if (!this.alive) return;
    this.facing.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-this.facing.z, 0, this.facing.x);

    const wish = new THREE.Vector3(controls.move.x, 0, controls.move.z);
    if (wish.lengthSq() > 1) wish.normalize();
    this.strafing = wish.lengthSq() > 0 && Math.abs(wish.dot(right)) > 0.6;

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.sinceDash += dt;
    if (controls.dash && this.dashCooldown <= 0) {
      this.dashDir.copy(wish.lengthSq() > 0 ? wish : this.facing);
      this.dashTime = PLAYER.dashTime;
      this.dashCooldown = PLAYER.dashCooldown;
      this.sinceDash = 0;
      this.invuln = Math.max(this.invuln, PLAYER.dashTime + 0.1);
      this.events.emit('dash', {});
    }

    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(PLAYER.dashSpeed);
    } else {
      this.vel.lerp(wish.multiplyScalar(PLAYER.speed), damp(PLAYER.accel, dt));
    }
    this.pos.addScaledVector(this.vel, dt);
    const r = Math.hypot(this.pos.x, this.pos.z);
    const max = ARENA.radius - PLAYER.radius;
    if (r > max) this.pos.multiplyScalar(max / r);

    // Weapon heat.
    this.fireTimer -= dt;
    if (this.overheated) {
      this.heat = Math.max(0, this.heat - PLAYER.heatCoolRate * 1.3 * dt);
      if (this.heat <= PLAYER.overheatRecover) this.overheated = false;
    } else if (controls.fire && this.fireTimer <= 0) {
      this.fireTimer = 1 / PLAYER.fireRate;
      this.heat += PLAYER.heatPerShot;
      const from = this.muzzleWorld();
      fire({ from, dir: aimPoint.clone().sub(from).normalize() });
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheated = true;
        this.events.emit('overheat', {});
      }
    } else if (!controls.fire) {
      this.heat = Math.max(0, this.heat - PLAYER.heatCoolRate * dt);
    }

    // Visuals: lean into movement, bob, thruster pulse, damage flash.
    this.group.rotation.y = yaw;
    const localVel = this.vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, localVel.z * 0.02, damp(8, dt));
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -localVel.x * 0.025, damp(8, dt));
    this.body.position.y = Math.sin(time * 3) * 0.05;
    const heatGlow = 1 + this.heat * 1.5;
    this.thrusterMat.color.setRGB(0.4 * heatGlow + this.heat * 2, 2.2 * (this.overheated ? 0.4 : 1), 3 * (this.overheated ? 0.3 : 1));
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.bodyMat.emissive.setRGB(this.hitFlash * 2, this.hitFlash * 0.2, this.hitFlash * 0.3);
  }

  /** Returns true if the damage actually landed. */
  damage(amount: number): boolean {
    if (!this.alive || this.invuln > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = PLAYER.hitInvuln;
    this.hitFlash = 1;
    this.events.emit('playerHit', { damage: amount });
    if (this.hp <= 0) {
      this.alive = false;
      this.group.visible = false;
      this.events.emit('gameOver', {});
    }
    return true;
  }

  heal(amount: number) {
    this.hp = Math.min(PLAYER.maxHp, this.hp + amount);
  }

  get glowColor() {
    return new THREE.Color(COLORS.player);
  }
}
