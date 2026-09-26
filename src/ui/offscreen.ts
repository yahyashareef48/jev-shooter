import * as THREE from 'three';
import type { Game } from '../Game';
import { h } from './dom';

const MAX_ARROWS = 24;
const SHOW_WITHIN = 32;

/** Edge-of-screen arrows for nearby enemies you cannot see (mostly flankers behind you). */
export class OffscreenIndicators {
  readonly root = h('div.offscreen');
  private arrows: HTMLElement[] = [];
  private v = new THREE.Vector3();
  private ndc = new THREE.Vector3();

  constructor(private game: Game) {
    for (let i = 0; i < MAX_ARROWS; i++) {
      const a = h('div.arrow');
      this.root.append(a);
      this.arrows.push(a);
    }
  }

  update() {
    const g = this.game;
    const cam = g.gfx.camera;
    let used = 0;
    if (g.state === 'playing') {
      const sorted = [...g.enemies].sort((a, b) => a.pos.distanceToSquared(g.player.pos) - b.pos.distanceToSquared(g.player.pos));
      for (const e of sorted) {
        if (used >= MAX_ARROWS) break;
        const d = e.pos.distanceTo(g.player.pos);
        if (d > SHOW_WITHIN) break;
        const c = e.center;
        this.ndc.copy(c).project(cam);
        const onScreen = this.ndc.z < 1 && Math.abs(this.ndc.x) < 0.95 && Math.abs(this.ndc.y) < 0.92;
        if (onScreen) continue;

        this.v.copy(c).applyMatrix4(cam.matrixWorldInverse);
        let dx = this.v.x;
        let dy = this.v.y;
        if (this.v.z > 0) dy = Math.min(dy, -Math.abs(this.v.z) * 0.6); // behind: pull to bottom edge
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const x = innerWidth / 2 + dx * innerWidth * 0.44;
        const y = innerHeight / 2 - dy * innerHeight * 0.4;
        const ang = Math.atan2(-dy, dx);
        const a = this.arrows[used++];
        a.className = `arrow ${e.intent}${d < 10 ? ' near' : ''}`;
        a.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${ang}rad) scale(${1.25 - d / SHOW_WITHIN * 0.6})`;
        a.style.display = 'block';
      }
    }
    for (let i = used; i < MAX_ARROWS; i++) this.arrows[i].style.display = 'none';
  }
}
