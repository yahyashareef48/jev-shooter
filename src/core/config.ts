// All gameplay tunables live here so balancing never means hunting through systems.

export const ARENA = {
  radius: 58,
  wallRadius: 60,
  pillarHeight: 7,
  pillarRadius: 2.2,
};

export const PLAYER = {
  maxHp: 100,
  radius: 0.8,
  speed: 11,
  accel: 14,
  dashSpeed: 38,
  dashTime: 0.18,
  dashCooldown: 1.6,
  fireRate: 9,
  heatPerShot: 0.07,
  heatCoolRate: 0.45,
  overheatRecover: 0.35,
  bulletSpeed: 75,
  bulletDamage: 15,
  hitInvuln: 0.25,
};

export const CAMERA = {
  fov: 70,
  dashFovKick: 9,
  sensitivity: 0.0022,
  shoulder: { x: 0.95, y: 0.45, z: 4.8 },
  pivotHeight: 1.9,
  minPitch: -0.9,
  maxPitch: 0.55,
};

export const WAVES = {
  intermission: 5,
  spawnInterval: 0.35,
  maxEnemies: 40,
};

export const DIRECTOR = {
  interval: 1.5,
  minInterval: 0.8,
  maxBatch: 40,
  confidenceGate: 0.35,
  minCommit: 1.0,
  switchMargin: 0.25,
  /** Squad-level caps applied on top of Jev's per-enemy answers. */
  maxShare: { flank: 0.45, retreat: 0.5 } as Partial<Record<'chase' | 'flank' | 'retreat', number>>,
  backoffMin: 1,
  backoffMax: 8,
  requestTimeoutMs: 4000,
  /** USD per 1M input tokens (output is free). */
  pricePerMTok: 0.042,
};

export const COLORS = {
  chase: 0xff3b5c,
  flank: 0xffb020,
  retreat: 0x33e1ff,
  player: 0x7df9ff,
  playerBolt: 0xbff8ff,
  enemyBolt: 0xff4fd8,
  grid: 0x1a6b8a,
  fog: 0x05070d,
};
