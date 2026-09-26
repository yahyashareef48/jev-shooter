// Jev reads numbers as text and is bad at comparing them, so every quantity is
// converted into a small vocabulary of semantic buckets before it goes on the wire.

import { angleBetween, dist, type XZ } from '../core/math';

export type HealthBucket = 'full' | 'high' | 'half' | 'low' | 'critical';
export function healthBucket(frac: number): HealthBucket {
  if (frac >= 0.99) return 'full';
  if (frac >= 0.75) return 'high';
  if (frac >= 0.5) return 'half';
  if (frac > 0.25) return 'low';
  return 'critical';
}

export type DistanceBucket = 'point-blank' | 'close' | 'mid-range' | 'far';
export function distanceBucket(d: number): DistanceBucket {
  if (d < 5) return 'point-blank';
  if (d < 12) return 'close';
  if (d < 24) return 'mid-range';
  return 'far';
}

export type BearingBucket = 'in front of the player' | "on the player's left" | "on the player's right" | 'behind the player';
/** Where `pos` sits relative to the direction the player is facing. */
export function bearingBucket(playerPos: XZ, facing: XZ, pos: XZ): BearingBucket {
  const rel = { x: pos.x - playerPos.x, z: pos.z - playerPos.z };
  const a = angleBetween(facing, rel);
  const deg = Math.abs(a) * (180 / Math.PI);
  if (deg < 45) return 'in front of the player';
  if (deg > 120) return 'behind the player';
  // With y up and the camera looking down -z, a positive signed angle is to the right.
  return a > 0 ? "on the player's right" : "on the player's left";
}

export function heatBucket(heat: number, overheated: boolean): string {
  if (overheated) return 'overheated (cannot shoot)';
  if (heat > 0.7) return 'overheating';
  if (heat > 0.35) return 'warm';
  return 'cool';
}

export function movementBucket(speed: number, strafing: boolean, recentlyDashed: boolean): string {
  if (recentlyDashed) return 'just dashed';
  if (speed < 1) return 'standing still';
  return strafing ? 'strafing' : 'moving';
}

export function alliesBucket(self: XZ, others: readonly XZ[], radius = 8): 'alone' | 'few' | 'many' {
  let n = 0;
  for (const o of others) if (o !== self && dist(o, self) < radius) n++;
  if (n === 0) return 'alone';
  return n <= 2 ? 'few' : 'many';
}
