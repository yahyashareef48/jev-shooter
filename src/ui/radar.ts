import { ARENA } from '../core/config';
import type { Game } from '../Game';
import { h } from './dom';

const RANGE = 42;
const INTENT_CSS = { chase: '#ff3b5c', flank: '#ffb020', retreat: '#33e1ff' } as const;

/** Rotating minimap: player at centre facing up, enemies coloured by current tactic. */
export class Radar {
  readonly root = h('div.radar');
  private canvas = h('canvas');
  private ctx: CanvasRenderingContext2D;
  private size = 176;
  private acc = 0;

  constructor(private game: Game) {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = this.canvas.height = this.size * dpr;
    this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.root.append(this.canvas, h('div.radar-label', {}, 'RADAR'));
  }

  update(dt: number) {
    const g = this.game;
    this.root.classList.toggle('hidden', g.state === 'title');
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;

    const c = this.ctx;
    const s = this.size;
    const R = s / 2 - 4;
    const k = R / RANGE;
    const p = g.player.pos;
    const f = g.player.facing;
    // right = facing rotated +90° about y (screen right when looking along facing)
    const rx = -f.z;
    const rz = f.x;
    const toRadar = (x: number, z: number) => {
      const dx = x - p.x;
      const dz = z - p.z;
      return [s / 2 + (dx * rx + dz * rz) * k, s / 2 - (dx * f.x + dz * f.z) * k] as const;
    };

    c.clearRect(0, 0, s, s);
    c.save();
    c.beginPath();
    c.arc(s / 2, s / 2, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(6, 14, 24, 0.72)';
    c.fillRect(0, 0, s, s);

    // range rings + sweep
    c.strokeStyle = 'rgba(90, 200, 255, 0.14)';
    c.lineWidth = 1;
    for (const r of [0.33, 0.66]) {
      c.beginPath();
      c.arc(s / 2, s / 2, R * r, 0, Math.PI * 2);
      c.stroke();
    }
    const sweep = (g.time * 1.6) % (Math.PI * 2);
    const grad = c.createConicGradient(sweep, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(90,220,255,0.18)');
    grad.addColorStop(0.12, 'rgba(90,220,255,0)');
    grad.addColorStop(1, 'rgba(90,220,255,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, s, s);

    // back arc warning zone
    c.fillStyle = 'rgba(255, 176, 32, 0.05)';
    c.beginPath();
    c.moveTo(s / 2, s / 2);
    c.arc(s / 2, s / 2, R, Math.PI / 2 - 0.9, Math.PI / 2 + 0.9);
    c.fill();

    // arena wall
    const [wx, wy] = toRadar(0, 0);
    c.strokeStyle = 'rgba(90, 220, 255, 0.45)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(wx, wy, ARENA.wallRadius * k, 0, Math.PI * 2);
    c.stroke();

    // pillars
    c.fillStyle = 'rgba(160, 190, 220, 0.28)';
    for (const pl of g.arena.pillars) {
      const [x, y] = toRadar(pl.x, pl.z);
      c.beginPath();
      c.arc(x, y, pl.r * k, 0, Math.PI * 2);
      c.fill();
    }

    // enemies
    for (const e of g.enemies) {
      const [x, y] = toRadar(e.pos.x, e.pos.z);
      const r = e.type === 'brute' ? 4.2 : e.type === 'gunner' ? 3.2 : 2.6;
      c.fillStyle = INTENT_CSS[e.intent];
      c.shadowColor = INTENT_CSS[e.intent];
      c.shadowBlur = 6;
      c.beginPath();
      if (e.type === 'gunner') c.rect(x - r, y - r, r * 2, r * 2);
      else c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.shadowBlur = 0;

    // player
    c.fillStyle = '#e8fbff';
    c.beginPath();
    c.moveTo(s / 2, s / 2 - 7);
    c.lineTo(s / 2 + 5, s / 2 + 5);
    c.lineTo(s / 2, s / 2 + 2);
    c.lineTo(s / 2 - 5, s / 2 + 5);
    c.closePath();
    c.fill();
    c.restore();

    c.strokeStyle = 'rgba(120, 220, 255, 0.5)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(s / 2, s / 2, R, 0, Math.PI * 2);
    c.stroke();
  }
}
