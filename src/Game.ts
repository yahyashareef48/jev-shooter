import * as THREE from 'three';
import { Director, type DecideFn } from './ai/director';
import type { EnemyType, WorldSnapshot } from './ai/types';
import { COLORS, PLAYER } from './core/config';
import { Events } from './core/Events';
import { Input } from './core/Input';
import { angleBetween } from './core/math';
import { Enemy, resetEnemyIds } from './entities/Enemy';
import { INTENT_COLOR } from './entities/EnemyTypes';
import { Pickups } from './entities/Pickup';
import { Player } from './entities/Player';
import { ProjectileSystem } from './entities/Projectile';
import { ThirdPersonCamera } from './entities/ThirdPersonCamera';
import type { Glow } from './render/FloorMaterial';
import { Renderer } from './render/Renderer';
import { Sky } from './render/Sky';
import { AudioSystem } from './systems/AudioSystem';
import { resolveCollisions } from './systems/CollisionSystem';
import { CombatSystem } from './systems/CombatSystem';
import { FxSystem } from './systems/FxSystem';
import { spawnPoint, WaveSystem } from './systems/WaveSystem';
import { Arena } from './world/Arena';

export type GameState = 'title' | 'playing' | 'paused' | 'over';

const PICKUP_CHANCE = 0.15;
const PICKUP_HEAL = 20;

export class Game {
  readonly events = new Events();
  readonly gfx: Renderer;
  readonly input: Input;
  readonly arena = new Arena();
  readonly sky = new Sky();
  readonly player: Player;
  readonly cam: ThirdPersonCamera;
  readonly projectiles: ProjectileSystem;
  readonly combat: CombatSystem;
  readonly waves: WaveSystem;
  readonly pickups = new Pickups();
  readonly director: Director;
  readonly fx: FxSystem;
  readonly audio: AudioSystem;
  enemies: Enemy[] = [];
  state: GameState = 'title';
  time = 0;
  /** Seconds of frozen simulation left (hit-stop on kills). */
  hitStop = 0;
  private last = performance.now();
  private glows: Glow[] = [];
  private enemyGroup = new THREE.Group();
  private playerGlow = new THREE.Color(COLORS.player);
  private pickupGlow = new THREE.Color().setRGB(0.3, 1.6, 0.6);
  private frameHooks: ((dt: number) => void)[] = [];

  constructor(container: HTMLElement, decide: DecideFn, useMock: boolean) {
    this.gfx = new Renderer(container);
    this.input = new Input(this.gfx.renderer.domElement);
    this.player = new Player(this.events);
    this.cam = new ThirdPersonCamera(this.gfx.camera, this.arena.pillars);
    this.projectiles = new ProjectileSystem(this.arena.pillars);
    this.combat = new CombatSystem(this.events, this.projectiles);
    this.waves = new WaveSystem(this.events);
    this.director = new Director(
      decide,
      () => this.enemies,
      () => this.time,
      (id, intent) => this.events.emit('intentChanged', { id, intent }),
      useMock,
    );
    this.fx = new FxSystem(this.events, () => this.player.pos);
    this.audio = new AudioSystem(this.events, () => this.player.pos);
    this.gfx.scene.add(
      this.fx.group,
      this.sky.group,
      this.arena.group,
      this.player.group,
      this.enemyGroup,
      this.projectiles.group,
      this.pickups.group,
    );
    this.cam.snap(this.player.pos);

    this.events.on('dash', () => {
      this.cam.kickFov();
      this.director.trigger();
    });
    this.events.on('playerHit', ({ damage }) => {
      this.gfx.flashHurt(Math.min(1, damage / 15));
      this.cam.addTrauma(Math.min(0.6, damage / 30));
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked && this.state === 'paused') this.state = 'playing';
      else if (!this.input.locked && this.state === 'playing') this.state = 'paused';
    });
    this.events.on('intentChanged', ({ id, intent }) => {
      const e = this.enemies.find((x) => x.id === id);
      if (e && this.state === 'playing') {
        this.fx.ring(new THREE.Vector3(e.pos.x, 0.06, e.pos.z), INTENT_COLOR[intent].clone().multiplyScalar(0.8), 2.2 + e.stats.radius, 0.45);
      }
    });
    this.events.on('gameOver', () => {
      this.state = 'over';
      this.input.unlock();
    });
  }

  /** Register a per-frame callback (UI, FX, audio). */
  onFrame(fn: (dt: number) => void) {
    this.frameHooks.push(fn);
  }

  start() {
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }

  newRun() {
    for (const e of this.enemies) this.removeEnemy(e);
    this.enemies = [];
    resetEnemyIds();
    this.projectiles.clear();
    this.pickups.clear();
    this.player.reset();
    this.combat.reset();
    this.waves.reset();
    this.director.reset();
    this.cam.yaw = 0;
    this.cam.pitch = -0.12;
    this.cam.snap(this.player.pos);
    this.state = 'playing';
  }

  private spawn(type: EnemyType) {
    const p = spawnPoint(this.player.pos, this.arena.pillars);
    const e = new Enemy(type, p.x, p.z);
    e.intentSince = this.time;
    this.enemies.push(e);
    this.enemyGroup.add(e.group);
    this.events.emit('spawn', { x: p.x, z: p.z });
  }

  private removeEnemy(e: Enemy) {
    this.enemyGroup.remove(e.group);
    e.dispose();
  }

  snapshot(): WorldSnapshot {
    const p = this.player;
    return {
      wave: this.waves.wave,
      player: {
        pos: { x: p.pos.x, z: p.pos.z },
        facing: { x: p.facing.x, z: p.facing.z },
        hp: p.hp,
        maxHp: PLAYER.maxHp,
        heat: p.heat,
        overheated: p.overheated,
        speed: p.speed,
        strafing: p.strafing,
        recentlyDashed: p.recentlyDashed,
      },
      enemies: this.enemies.map((e) => ({
        id: e.id,
        type: e.type,
        pos: { x: e.pos.x, z: e.pos.z },
        hp: e.hp,
        maxHp: e.stats.hp,
        intent: e.intent,
      })),
      pillars: this.arena.pillars,
    };
  }

  private frame() {
    const now = performance.now();
    const rawDt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;

    let dt = rawDt;
    if (this.hitStop > 0) {
      this.hitStop -= rawDt;
      dt = rawDt * 0.05;
    }
    const simulate = this.state === 'playing' || this.state === 'over';
    if (simulate) this.step(dt);
    else this.idle(rawDt);

    this.fx.update(dt);
    this.arena.update(this.time);
    this.sky.update(this.time);
    this.updateGlows();
    for (const fn of this.frameHooks) fn(rawDt);
    this.gfx.render(rawDt);
    this.input.endFrame();
  }

  /** Title/pause: slow orbit camera, no simulation. */
  private idle(dt: number) {
    if (this.state === 'title') {
      this.time += dt;
      this.cam.yaw += dt * 0.08;
      this.cam.pitch = -0.18;
    } else {
      this.input.consumeMouse();
    }
    this.cam.update(dt, this.time, this.player.pos);
  }

  private step(dt: number) {
    this.time += dt;
    const t = this.time;
    const playing = this.state === 'playing';

    const { dx, dy } = this.input.consumeMouse();
    if (playing) this.cam.look(dx, dy);

    this.player.update(dt, t, this.input, this.cam.yaw, this.cam.aimPoint, ({ from, dir }) => {
      this.projectiles.fire('player', from, dir, PLAYER.bulletSpeed, PLAYER.bulletDamage);
      this.events.emit('shot', { x: from.x, y: from.y, z: from.z });
    });

    if (playing) {
      this.waves.update(dt, this.enemies.length, (type) => this.spawn(type));
      this.director.update(this.snapshot());
    }

    const neighbours = this.enemies.map((e) => e.pos);
    for (const e of this.enemies) {
      e.update(dt, {
        time: t,
        playerPos: this.player.pos,
        playerFacing: this.player.facing,
        playerAlive: this.player.alive,
        pillars: this.arena.pillars,
        neighbours,
        meleePlayer: (dmg) => {
          if (!this.player.dashing) this.player.damage(dmg);
        },
        shoot: (from, dir, dmg) => {
          this.projectiles.fire('enemy', from, dir, 26, dmg);
          this.events.emit('enemyShot', { x: from.x, y: from.y, z: from.z });
        },
      });
      this.checkFlanked(e);
    }

    this.projectiles.update(dt, (p, owner) => {
      this.arena.floor.ripple(p.x, p.z, owner === 'player' ? 0.25 : 0.15, t);
      this.events.emit('impact', { x: p.x, y: p.y, z: p.z, color: owner === 'player' ? 0x7df9ff : 0xff4fd8 });
    });

    const killed = this.combat.update(dt, t, this.player, this.enemies);
    for (const e of killed) {
      this.arena.floor.ripple(e.pos.x, e.pos.z, e.type === 'brute' ? 1.5 : 0.8, t);
      this.cam.addTrauma(e.type === 'brute' ? 0.5 : 0.22);
      this.hitStop = e.type === 'brute' ? 0.08 : 0.04;
      if (Math.random() < PICKUP_CHANCE || e.type === 'brute') this.pickups.spawn(e.pos.x, e.pos.z);
      this.removeEnemy(e);
    }
    if (killed.length) this.enemies = this.enemies.filter((e) => e.alive);

    resolveCollisions(this.player, this.enemies, this.arena.pillars);

    const got = this.pickups.update(dt, t, this.player.pos);
    for (let i = 0; i < got; i++) {
      this.player.heal(PICKUP_HEAL);
      this.events.emit('pickup', { heal: PICKUP_HEAL });
    }

    this.cam.update(
      dt,
      t,
      this.player.pos,
      this.enemies.map((e) => ({ pos: e.center, r: e.stats.radius })),
    );
  }

  /** Fire the FLANKED warning once when a flanker gets into the player's back arc. */
  private checkFlanked(e: Enemy) {
    if (e.intent !== 'flank' || e.flankAlerted || !this.player.alive) return;
    const rel = { x: e.pos.x - this.player.pos.x, z: e.pos.z - this.player.pos.z };
    const d = Math.hypot(rel.x, rel.z);
    if (d > 14) return;
    const a = Math.abs(angleBetween(this.player.facing, rel));
    if (a > (115 * Math.PI) / 180) {
      e.flankAlerted = true;
      this.events.emit('flanked', { id: e.id });
    }
  }

  private updateGlows() {
    const g = this.glows;
    g.length = 0;
    if (this.player.alive) {
      g.push({ x: this.player.pos.x, z: this.player.pos.z, radius: 1.8, intensity: 0.55, color: this.playerGlow });
    }
    for (const e of this.enemies) {
      g.push({ x: e.pos.x, z: e.pos.z, radius: 1.2 + e.stats.radius, intensity: 0.22, color: e.glowColor });
    }
    for (const p of this.pickups.positions()) g.push({ x: p.x, z: p.z, radius: 1.2, intensity: 0.6, color: this.pickupGlow });
    this.arena.floor.setGlows(g, this.time);
  }
}
