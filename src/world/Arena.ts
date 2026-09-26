import * as THREE from 'three';
import { ARENA } from '../core/config';
import type { Circle } from '../core/math';
import { NeonFloor } from '../render/FloorMaterial';

const hdr = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);

/** Floor, energy boundary wall, cover pillars and lighting. */
export class Arena {
  readonly group = new THREE.Group();
  readonly floor = new NeonFloor();
  readonly pillars: Circle[] = [];
  private wallMat: THREE.ShaderMaterial;
  private trimMat = new THREE.MeshBasicMaterial({ color: hdr(0.35, 1.7, 2.4) });

  constructor() {
    this.group.add(this.floor.mesh);

    this.group.add(new THREE.HemisphereLight(0x3a4a70, 0x05060a, 0.7));
    const key = new THREE.DirectionalLight(0xa8d8ff, 0.9);
    key.position.set(20, 40, 10);
    this.group.add(key);
    const rim = new THREE.DirectionalLight(0xff4fd8, 0.35);
    rim.position.set(-30, 12, -25);
    this.group.add(rim);

    // Pillar layout: inner ring of 3, outer ring of 6, offset so there are no straight lanes.
    const layout: [number, number][] = [];
    for (let i = 0; i < 3; i++) layout.push([15, (i / 3) * Math.PI * 2 + 0.5]);
    for (let i = 0; i < 6; i++) layout.push([34, (i / 6) * Math.PI * 2]);
    for (const [rad, a] of layout) this.addPillar(Math.cos(a) * rad, Math.sin(a) * rad);

    // Energy boundary wall.
    this.wallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float fy = clamp(1.0 - vUv.y, 0.0, 1.0);
          float fade = fy * fy;
          float scan = 0.5 + 0.5 * sin(vUv.y * 80.0 - uTime * 3.0);
          float cols = smoothstep(0.92, 1.0, abs(sin(vUv.x * 3.14159 * 90.0)));
          float sweep = smoothstep(0.97, 1.0, sin(vUv.x * 6.28318 * 2.0 - uTime * 0.7));
          float a = fade * (0.08 + scan * 0.05 + cols * 0.25 + sweep * 0.5);
          gl_FragColor = vec4(vec3(0.3, 0.85, 1.4) * a, a);
        }`,
    });
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA.wallRadius, ARENA.wallRadius, 6, 160, 1, true),
      this.wallMat,
    );
    wall.position.y = 3;
    this.group.add(wall);

    const rimRing = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA.wallRadius, 0.08, 8, 240),
      new THREE.MeshBasicMaterial({ color: hdr(0.5, 2.2, 3.2) }),
    );
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = 0.05;
    this.group.add(rimRing);
  }

  private addPillar(x: number, z: number) {
    const { pillarHeight: h, pillarRadius: r } = ARENA;
    const pillar = new THREE.Group();
    pillar.position.set(x, 0, z);
    pillar.rotation.y = Math.random() * Math.PI;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.9, r, h, 6),
      new THREE.MeshStandardMaterial({ color: 0x0b0f18, metalness: 0.85, roughness: 0.32, flatShading: true }),
    );
    body.position.y = h / 2;
    pillar.add(body);

    for (const y of [0.35, h - 1.2]) {
      const t = 1 - (y / h) * 0.1;
      const trim = new THREE.Mesh(new THREE.CylinderGeometry(r * t + 0.04, r * t + 0.04, 0.12, 6, 1, true), this.trimMat);
      trim.position.y = y;
      pillar.add(trim);
    }

    // Vertical light strips on alternating edges.
    for (let i = 0; i < 6; i += 2) {
      const a = (i / 6) * Math.PI * 2;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, h - 2, 0.07), this.trimMat);
      // CylinderGeometry puts vertex i at (sin θ, cos θ) — align strips with the hex corners.
      strip.position.set(Math.sin(a) * r * 0.96, h / 2, Math.cos(a) * r * 0.96);
      pillar.add(strip);
    }

    this.group.add(pillar);
    this.pillars.push({ x, z, r });
  }

  update(time: number) {
    this.wallMat.uniforms.uTime.value = time;
  }
}
