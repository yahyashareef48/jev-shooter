import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { ARENA, COLORS } from '../core/config';

export const MAX_GLOWS = 48;
const MAX_RIPPLES = 10;

/**
 * Glossy reflective floor: blurred planar reflection + neon grid + coloured light pools
 * under every entity (cheap stand-in for 48 point lights) + expanding ripple rings.
 */
const FloorShader = {
  name: 'NeonFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uGlows: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4()) },
    uGlowColors: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Color()) },
    uGlowCount: { value: 0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
    uGridColor: { value: new THREE.Color(COLORS.grid) },
    uFogColor: { value: new THREE.Color(COLORS.fog) },
    uFogDensity: { value: 0.012 },
    uArenaRadius: { value: ARENA.wallRadius },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    varying float vViewDepth;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vec4 mv = viewMatrix * world;
      vViewDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    #define MAX_GLOWS ${MAX_GLOWS}
    #define MAX_RIPPLES ${MAX_RIPPLES}
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec4 uGlows[MAX_GLOWS];
    uniform vec3 uGlowColors[MAX_GLOWS];
    uniform int uGlowCount;
    uniform vec4 uRipples[MAX_RIPPLES];
    uniform vec3 uGridColor;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uArenaRadius;
    varying vec4 vUv;
    varying vec3 vWorld;
    varying float vViewDepth;

    float gridLine(vec2 p, float cell, float width) {
      vec2 q = p / cell;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      return 1.0 - min(min(g.x, g.y) / width, 1.0);
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 p = vWorld.xz;
      float r = length(p);

      // blurred reflection (5 taps, slightly jittered for a brushed look)
      vec2 ruv = vUv.xy / vUv.w;
      float j = (hash(p * 3.0) - 0.5) * 0.002;
      vec3 refl = texture2D(tDiffuse, ruv).rgb * 0.36;
      refl += texture2D(tDiffuse, ruv + vec2(0.004 + j, 0.0)).rgb * 0.16;
      refl += texture2D(tDiffuse, ruv - vec2(0.004 - j, 0.0)).rgb * 0.16;
      refl += texture2D(tDiffuse, ruv + vec2(0.0, 0.006 + j)).rgb * 0.16;
      refl += texture2D(tDiffuse, ruv - vec2(0.0, 0.006 - j)).rgb * 0.16;

      vec3 base = vec3(0.008, 0.011, 0.02);

      // light pools from entities
      vec3 glow = vec3(0.0);
      for (int i = 0; i < MAX_GLOWS; i++) {
        if (i >= uGlowCount) break;
        vec4 g = uGlows[i];
        vec2 d = p - g.xy;
        glow += uGlowColors[i] * g.w * exp(-dot(d, d) / (g.z * g.z));
      }

      // ripples
      float ripple = 0.0;
      for (int i = 0; i < MAX_RIPPLES; i++) {
        vec4 rp = uRipples[i];
        float age = uTime - rp.z;
        if (age < 0.0 || age > 1.6) continue;
        float rad = age * 22.0;
        float dd = length(p - rp.xy) - rad;
        ripple += exp(-dd * dd * 1.2) * (1.0 - age / 1.6) * rp.w;
      }

      float inside = 1.0 - smoothstep(uArenaRadius - 0.5, uArenaRadius + 6.0, r);
      float minor = gridLine(p, 2.0, 1.0);
      float major = gridLine(p, 10.0, 1.4);
      float pulse = 0.55 + 0.45 * sin(r * 0.35 - uTime * 1.4);
      float lines = (minor * 0.18 + major * 0.55 * pulse) * (0.35 + 0.65 * inside);

      // boundary ring on the floor
      float rd = (r - uArenaRadius) * 1.6;
      float ring = exp(-rd * rd);

      vec3 col = base + refl * 0.55;
      col += uGridColor * lines * (0.45 + ripple * 3.0);
      col += glow * (0.35 + lines * 2.5);
      col += uGridColor * ripple * 0.35;
      col += vec3(0.25, 0.8, 1.0) * ring * 1.6;

      float fog = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
      col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface Glow {
  x: number;
  z: number;
  radius: number;
  intensity: number;
  color: THREE.Color;
}

export class NeonFloor {
  readonly mesh: Reflector;
  private uniforms: Record<string, THREE.IUniform>;
  private rippleIdx = 0;

  constructor() {
    const scale = 0.5;
    this.mesh = new Reflector(new THREE.PlaneGeometry(320, 320), {
      shader: FloorShader,
      textureWidth: Math.round(innerWidth * scale),
      textureHeight: Math.round(innerHeight * scale),
      clipBias: 0.003,
      multisample: 0,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.uniforms = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    addEventListener('resize', () =>
      this.mesh.getRenderTarget().setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale)),
    );
  }

  setGlows(glows: readonly Glow[], time: number) {
    const n = Math.min(glows.length, MAX_GLOWS);
    const g = this.uniforms.uGlows.value as THREE.Vector4[];
    const c = this.uniforms.uGlowColors.value as THREE.Color[];
    for (let i = 0; i < n; i++) {
      const s = glows[i];
      g[i].set(s.x, s.z, s.radius, s.intensity);
      c[i].copy(s.color);
    }
    this.uniforms.uGlowCount.value = n;
    this.uniforms.uTime.value = time;
  }

  ripple(x: number, z: number, strength: number, time: number) {
    const r = this.uniforms.uRipples.value as THREE.Vector4[];
    r[this.rippleIdx].set(x, z, time, strength);
    this.rippleIdx = (this.rippleIdx + 1) % MAX_RIPPLES;
  }
}
