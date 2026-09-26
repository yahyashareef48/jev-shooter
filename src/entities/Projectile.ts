import * as THREE from 'three';
import { ARENA } from '../core/config';
import type { Circle } from '../core/math';

export type Owner = 'player' | 'enemy';

export interface Projectile {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  alive: boolean;
}

const MAX = 256;
const Z = new THREE.Vector3(0, 0, 1);

/** Pooled bolts rendered as one InstancedMesh per owner. */
class BoltPool {
  readonly items: Projectile[] = [];
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(color: THREE.Color, length: number, thickness: number) {
    const geo = new THREE.CapsuleGeometry(thickness, length, 4, 8).rotateX(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < MAX; i++) {
      this.items.push({
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        damage: 0,
        alive: false,
      });
    }
  }

  spawn(from: THREE.Vector3, vel: THREE.Vector3, damage: number, life: number) {
    const p = this.items.find((b) => !b.alive);
    if (!p) return;
    p.pos.copy(from);
    p.prev.copy(from);
    p.vel.copy(vel);
    p.damage = damage;
    p.life = life;
    p.alive = true;
  }

  sync() {
    let n = 0;
    for (const p of this.items) {
      if (!p.alive) continue;
      this.q.setFromUnitVectors(Z, this.dir.copy(p.vel).normalize());
      this.m.compose(p.pos, this.q, this.s.set(1, 1, 1));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const p of this.items) p.alive = false;
  }
}

export class ProjectileSystem {
  readonly player = new BoltPool(new THREE.Color().setRGB(1.6, 3.4, 4), 1.1, 0.07);
  readonly enemy = new BoltPool(new THREE.Color().setRGB(4, 0.6, 3), 0.7, 0.13);
  readonly group = new THREE.Group();

  constructor(private pillars: readonly Circle[]) {
    this.group.add(this.player.mesh, this.enemy.mesh);
  }

  fire(owner: Owner, from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number) {
    const pool = owner === 'player' ? this.player : this.enemy;
    pool.spawn(from, dir.clone().multiplyScalar(speed), damage, 2.2);
  }

  /** Moves bolts; calls onImpact for bolts that hit the floor, a pillar or the wall. */
  update(dt: number, onImpact: (p: THREE.Vector3, owner: Owner) => void) {
    for (const [owner, pool] of [['player', this.player], ['enemy', this.enemy]] as const) {
      for (const p of pool.items) {
        if (!p.alive) continue;
        p.prev.copy(p.pos);
        p.pos.addScaledVector(p.vel, dt);
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          continue;
        }
        if (p.pos.y <= 0.02 || Math.hypot(p.pos.x, p.pos.z) > ARENA.wallRadius || this.hitsPillar(p.pos)) {
          p.alive = false;
          onImpact(p.pos.clone().setY(Math.max(0.05, p.pos.y)), owner);
        }
      }
      pool.sync();
    }
  }

  private hitsPillar(p: THREE.Vector3) {
    if (p.y > ARENA.pillarHeight) return false;
    for (const c of this.pillars) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r) return true;
    return false;
  }

  clear() {
    this.player.clear();
    this.enemy.clear();
  }
}
