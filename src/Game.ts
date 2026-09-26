import * as THREE from 'three';
import { COLORS, PLAYER } from './core/config';
import { Events } from './core/Events';
import { Input } from './core/Input';
import { Player } from './entities/Player';
import { ProjectileSystem } from './entities/Projectile';
import { ThirdPersonCamera } from './entities/ThirdPersonCamera';
import type { Glow } from './render/FloorMaterial';
import { Renderer } from './render/Renderer';
import { Sky } from './render/Sky';
import { Arena } from './world/Arena';

export class Game {
  readonly events = new Events();
  readonly gfx: Renderer;
  readonly input: Input;
  readonly arena = new Arena();
  readonly sky = new Sky();
  readonly player: Player;
  readonly cam: ThirdPersonCamera;
  readonly projectiles: ProjectileSystem;
  private last = performance.now();
  private time = 0;
  private glows: Glow[] = [];

  constructor(container: HTMLElement) {
    this.gfx = new Renderer(container);
    this.input = new Input(this.gfx.renderer.domElement);
    this.player = new Player(this.events);
    this.cam = new ThirdPersonCamera(this.gfx.camera, this.arena.pillars);
    this.projectiles = new ProjectileSystem(this.arena.pillars);
    this.gfx.scene.add(this.sky.group, this.arena.group, this.player.group, this.projectiles.group);
    this.cam.snap(this.player.pos);

    this.gfx.renderer.domElement.addEventListener('click', () => this.input.lock());
    this.events.on('dash', () => this.cam.kickFov());
  }

  start() {
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    this.time += dt;
    const t = this.time;

    const { dx, dy } = this.input.consumeMouse();
    this.cam.look(dx, dy);

    this.player.update(dt, t, this.input, this.cam.yaw, this.cam.aimPoint, ({ from, dir }) => {
      this.projectiles.fire('player', from, dir, PLAYER.bulletSpeed, PLAYER.bulletDamage);
      this.events.emit('shot', from);
    });
    this.projectiles.update(dt, (p) => this.arena.floor.ripple(p.x, p.z, 0.25, t));
    this.cam.update(dt, t, this.player.pos);

    this.glows.length = 0;
    this.glows.push({ x: this.player.pos.x, z: this.player.pos.z, radius: 2.2, intensity: 0.9, color: new THREE.Color(COLORS.player) });
    this.arena.floor.setGlows(this.glows, t);
    this.arena.update(t);
    this.sky.update(t);

    this.gfx.render(dt);
    this.input.endFrame();
  }
}
