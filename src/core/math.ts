// Flat-ground 2D math on the XZ plane. Works on anything shaped like {x, z}
// (including THREE.Vector3) so AI code stays three-free and unit-testable.

export interface XZ {
  x: number;
  z: number;
}

export const xz = (x = 0, z = 0): XZ => ({ x, z });
export const sub = (a: XZ, b: XZ): XZ => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a: XZ, b: XZ): XZ => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: XZ, s: number): XZ => ({ x: a.x * s, z: a.z * s });
export const len = (a: XZ) => Math.hypot(a.x, a.z);
export const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
export const dot = (a: XZ, b: XZ) => a.x * b.x + a.z * b.z;
export const cross = (a: XZ, b: XZ) => a.x * b.z - a.z * b.x;

export function norm(a: XZ): XZ {
  const l = len(a);
  return l > 1e-6 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}

export function clampLen(a: XZ, max: number): XZ {
  const l = len(a);
  return l > max ? scale(a, max / l) : a;
}

export function rotate(a: XZ, rad: number): XZ {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.z * s, z: a.x * s + a.z * c };
}

/** Signed angle from a to b in radians, (-PI, PI]. */
export const angleBetween = (a: XZ, b: XZ) => Math.atan2(cross(a, b), dot(a, b));

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

export interface Circle extends XZ {
  r: number;
}

/** True if segment a→b passes through any circle (line-of-sight blocking). */
export function segmentHitsCircle(a: XZ, b: XZ, c: Circle): boolean {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const abLen2 = dot(ab, ab);
  const t = abLen2 > 0 ? clamp(dot(ac, ab) / abLen2, 0, 1) : 0;
  const closest = add(a, scale(ab, t));
  return dist(closest, c) < c.r;
}

export function hasLineOfSight(a: XZ, b: XZ, blockers: readonly Circle[]): boolean {
  for (const c of blockers) if (segmentHitsCircle(a, b, c)) return false;
  return true;
}

/** Deterministic small hash → [0,1) for stable per-entity variety. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
