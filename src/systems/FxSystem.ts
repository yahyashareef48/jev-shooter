import * as THREE from 'three';
import type { Events } from '../core/Events';

const MAX_PARTICLES = 3000;
const MAX_SHARDS = 320;
const MAX_RINGS = 10;

interface Shard {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  maxScale: number;
}

const hdr = (hex: number, boost: number) => new THREE.Color(hex).multiplyScalar(boost);

/** GPU-cheap juice: additive point particles, instanced shards and floor shockwaves. */
export class FxSystem {
  readonly group = new THREE.Group();
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pCol = new Float32Array(MAX_PARTICLES * 3);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pAlpha = new Float32Array(MAX_PARTICLES);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pMax = new Float32Array(MAX_PARTICLES);
  private pDrag = new Float32Array(MAX_PARTICLES);
  private pGrav = new Float32Array(MAX_PARTICLES);
  private pCursor = 0;
  private points: THREE.Points;
  private shards: Shard[] = [];
  private shardMesh: THREE.InstancedMesh;
  private rings: Ring[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(events: Events, private playerPos: () => THREE.Vector3) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: innerHeight * 0.5 } },
        vertexShader: /* glsl */ `
          attribute vec3 color;
          attribute float size;
          attribute float alpha;
          uniform float uScale;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vColor = color;
            vAlpha = alpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = alpha > 0.0 ? size * uScale / max(0.1, -mv.z) : 0.0;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = max(0.0, 1.0 - d);
            a = a * a * vAlpha;
            gl_FragColor = vec4(vColor * a, a);
          }`,
      }),
    );
    this.points.frustumCulled = false;
    addEventListener('resize', () => ((this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = innerHeight * 0.5));

    this.shardMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), MAX_SHARDS);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.count = 0;
    this.shardMesh.setColorAt(0, new THREE.Color());
    for (let i = 0; i < MAX_SHARDS; i++) {
      this.shards.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 1, size: 0.2, color: new THREE.Color() });
    }

    const ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 0, maxScale: 1 });
    }
    this.group.add(this.points, this.shardMesh);

    const v = new THREE.Vector3();
    events.on('shot', (p) => this.burst(v.set(p.x, p.y, p.z), hdr(0x9ff6ff, 3), 4, 3, 0.12, 0.18, 0));
    events.on('enemyShot', (p) => this.burst(v.set(p.x, p.y, p.z), hdr(0xff4fd8, 3), 4, 2.5, 0.15, 0.2, 0));
    events.on('impact', (p) => this.burst(v.set(p.x, p.y, p.z), hdr(p.color, 2.5), 8, 6, 0.3, 0.12, 9));
    events.on('enemyHit', (p) => this.burst(v.set(p.x, p.y, p.z), p.shielded ? hdr(0x33e1ff, 3) : hdr(0xffffff, 2.5), p.shielded ? 10 : 7, 7, 0.3, 0.12, 9));
    events.on('enemyKilled', (p) => this.explode(v.set(p.x, p.y, p.z), p.color, p.big));
    events.on('playerHit', () => {
      const pp = this.playerPos();
      this.burst(v.set(pp.x, 1.2, pp.z), hdr(0xff3b5c, 3), 14, 6, 0.4, 0.14, 6);
    });
    events.on('spawn', (p) => {
      this.ring(v.set(p.x, 0.05, p.z), hdr(0xff4fd8, 3), 3, 0.7);
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        this.emit(p.x + Math.cos(a) * 1.2, 0.1, p.z + Math.sin(a) * 1.2, 0, 3 + Math.random() * 4, 0, hdr(0xff4fd8, 2.5), 0.2, 0.8, 1, -2);
      }
    });
    events.on('pickup', () => {
      const pp = this.playerPos();
      this.burst(v.set(pp.x, 1, pp.z), hdr(0x3dffa0, 3), 30, 5, 0.6, 0.16, -2);
      this.ring(v.set(pp.x, 0.05, pp.z), hdr(0x3dffa0, 2.5), 4, 0.5);
    });
    events.on('dash', () => {
      const pp = this.playerPos();
      this.ring(v.set(pp.x, 0.05, pp.z), hdr(0x7df9ff, 2), 3.5, 0.35);
    });
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, drag: number, grav: number) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    this.pPos.set([x, y, z], i * 3);
    this.pVel.set([vx, vy, vz], i * 3);
    this.pCol.set([color.r, color.g, color.b], i * 3);
    this.pSize[i] = size;
    this.pLife[i] = life;
    this.pMax[i] = life;
    this.pDrag[i] = drag;
    this.pGrav[i] = grav;
    this.pAlpha[i] = 1;
  }

  burst(p: THREE.Vector3, color: THREE.Color, n: number, speed: number, life: number, size: number, grav: number) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(p.x, p.y, p.z, Math.cos(a) * r * s, u * s, Math.sin(a) * r * s, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), 3, grav);
    }
  }

  private explode(p: THREE.Vector3, hex: number, big: boolean) {
    const color = hdr(hex, 2.6);
    this.burst(p, color, big ? 140 : 60, big ? 16 : 11, big ? 1.0 : 0.7, big ? 0.35 : 0.25, 4);
    this.burst(p, hdr(0xffffff, 4), big ? 30 : 14, 5, 0.18, 0.9, 0); // core flash
    this.ring(new THREE.Vector3(p.x, 0.06, p.z), color, big ? 11 : 6, big ? 0.7 : 0.5);
    const n = big ? 26 : 12;
    let spawned = 0;
    for (const s of this.shards) {
      if (spawned >= n) break;
      if (s.life > 0) continue;
      spawned++;
      s.pos.copy(p);
      s.vel.set((Math.random() - 0.5) * 14, 3 + Math.random() * 7, (Math.random() - 0.5) * 14);
      s.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      s.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.max = s.life = 0.9 + Math.random() * 0.8;
      s.size = (big ? 0.28 : 0.18) * (0.6 + Math.random() * 0.8);
      if (Math.random() < 0.5) s.color.copy(color);
      else s.color.setRGB(0.08, 0.1, 0.14);
    }
  }

  ring(p: THREE.Vector3, color: THREE.Color, maxScale: number, life: number) {
    const r = this.rings.find((x) => x.age >= x.life) ?? this.rings[0];
    r.mesh.position.copy(p);
    r.mat.color.copy(color);
    r.age = 0;
    r.life = life;
    r.maxScale = maxScale;
    r.mesh.visible = true;
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pAlpha[i] <= 0) continue;
      const life = (this.pLife[i] -= dt);
      if (life <= 0) {
        this.pAlpha[i] = 0;
        continue;
      }
      const k = Math.exp(-this.pDrag[i] * dt);
      const j = i * 3;
      this.pVel[j] *= k;
      this.pVel[j + 1] = this.pVel[j + 1] * k - this.pGrav[i] * dt;
      this.pVel[j + 2] *= k;
      this.pPos[j] += this.pVel[j] * dt;
      this.pPos[j + 1] = Math.max(0.03, this.pPos[j + 1] + this.pVel[j + 1] * dt);
      this.pPos[j + 2] += this.pVel[j + 2] * dt;
      this.pAlpha[i] = life / this.pMax[i];
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;

    let n = 0;
    for (let i = 0; i < MAX_SHARDS; i++) {
      const s = this.shards[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 22 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.1) {
        s.pos.y = 0.1;
        s.vel.y *= -0.35;
        s.vel.x *= 0.7;
        s.vel.z *= 0.7;
      }
      s.rot.x += s.spin.x * dt;
      s.rot.y += s.spin.y * dt;
      s.rot.z += s.spin.z * dt;
      const sc = s.size * Math.min(1, (s.life / s.max) * 2);
      this.m.compose(s.pos, this.q.setFromEuler(s.rot), this.s.set(sc, sc, sc));
      this.shardMesh.setMatrixAt(n, this.m);
      this.shardMesh.setColorAt(n, s.color);
      n++;
    }
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;

    for (const r of this.rings) {
      if (r.age >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      r.age += dt;
      const t = Math.min(1, r.age / r.life);
      const e = 1 - (1 - t) ** 3;
      r.mesh.scale.setScalar(0.3 + e * r.maxScale);
      r.mat.opacity = (1 - t) * 0.9;
    }
  }
}
