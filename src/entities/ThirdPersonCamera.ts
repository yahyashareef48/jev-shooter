import * as THREE from 'three';
import { ARENA, CAMERA } from '../core/config';
import { clamp, damp, type Circle } from '../core/math';

export interface AimTarget {
  pos: THREE.Vector3;
  r: number;
}

/**
 * Over-the-right-shoulder camera. Mouse drives yaw/pitch; the boom shortens when a pillar
 * gets between the pivot and the camera. Screen shake uses a trauma model (shake = trauma²).
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = -0.12;
  private boom = CAMERA.shoulder.z;
  private trauma = 0;
  private fovKick = 0;
  private smoothPivot = new THREE.Vector3();
  readonly aimPoint = new THREE.Vector3();
  readonly forward = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private pillars: readonly Circle[],
  ) {}

  look(dx: number, dy: number) {
    this.yaw -= dx * CAMERA.sensitivity;
    this.pitch = clamp(this.pitch - dy * CAMERA.sensitivity, CAMERA.minPitch, CAMERA.maxPitch);
  }

  addTrauma(t: number) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  kickFov(amount = CAMERA.dashFovKick) {
    this.fovKick = amount;
  }

  snap(target: THREE.Vector3) {
    this.smoothPivot.set(target.x, target.y + CAMERA.pivotHeight, target.z);
  }

  update(dt: number, time: number, target: THREE.Vector3, aimTargets: readonly AimTarget[] = []) {
    const pivotGoal = new THREE.Vector3(target.x, target.y + CAMERA.pivotHeight, target.z);
    this.smoothPivot.lerp(pivotGoal, damp(18, dt));

    const rot = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(rot);
    this.forward.set(0, 0, -1).applyQuaternion(q);

    const { x: sx, y: sy, z: sz } = CAMERA.shoulder;
    const shoulder = new THREE.Vector3(sx, sy, 0).applyQuaternion(q).add(this.smoothPivot);

    // Boom collision: sample along the boom against pillar cylinders and the arena wall.
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let allowed = sz;
    for (let d = 0.5; d <= sz; d += 0.25) {
      const p = shoulder.clone().addScaledVector(back, d);
      if (this.blocked(p)) {
        allowed = Math.max(0.6, d - 0.4);
        break;
      }
    }
    // Pull in fast, ease back out slowly.
    this.boom = allowed < this.boom ? allowed : THREE.MathUtils.lerp(this.boom, allowed, damp(4, dt));
    const camPos = shoulder.clone().addScaledVector(back, this.boom);
    if (camPos.y < 0.3) camPos.y = 0.3;

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;
    camPos.x += (Math.sin(time * 71) + Math.sin(time * 37)) * 0.12 * shake;
    camPos.y += (Math.sin(time * 83) + Math.sin(time * 29)) * 0.12 * shake;
    this.camera.position.copy(camPos);
    this.camera.quaternion.copy(q);
    this.camera.rotateZ((Math.sin(time * 47) * 0.02) * shake);

    this.fovKick = THREE.MathUtils.lerp(this.fovKick, 0, damp(6, dt));
    const fov = CAMERA.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Where the crosshair points: first pillar/floor hit along the view ray, else far away.
    this.aimPoint.copy(this.raycastAim(camPos, this.forward, aimTargets));
  }

  private blocked(p: THREE.Vector3) {
    if (Math.hypot(p.x, p.z) > ARENA.wallRadius - 0.3) return true;
    if (p.y > ARENA.pillarHeight) return false;
    for (const c of this.pillars) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.35) return true;
    return false;
  }

  private raycastAim(origin: THREE.Vector3, dir: THREE.Vector3, targets: readonly AimTarget[]) {
    // Skip the first few metres so the ray starts in front of the player.
    const p = new THREE.Vector3();
    for (let d = 3; d < 90; d += 0.5) {
      p.copy(origin).addScaledVector(dir, d);
      if (p.y <= 0) return p.setY(0);
      for (const t of targets) if (p.distanceToSquared(t.pos) < t.r * t.r) return p;
      if (p.y < ARENA.pillarHeight) {
        for (const c of this.pillars) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r) return p;
      }
    }
    return p.copy(origin).addScaledVector(dir, 90);
  }
}
