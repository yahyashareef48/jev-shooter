import * as THREE from 'three';
import { PLAYER } from '../core/config';
import type { Game } from '../Game';
import { h, fmt } from './dom';

interface DamageNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  alive: boolean;
}

const HEAT_CIRC = 2 * Math.PI * 26;

/** In-game heads-up display: crosshair+heat, HP, dash, wave/score/combo, banners, alerts. */
export class Hud {
  readonly root = h('div.hud');
  private heatArc: SVGCircleElement;
  private crosshair: HTMLElement;
  private hitMarker = h('div.hitmarker');
  private hpFill = h('div.hp-fill');
  private hpGhost = h('div.hp-ghost');
  private hpText = h('span.hp-text');
  private dashPip = h('div.dash-pip');
  private wave = h('div.stat-value');
  private score = h('div.stat-value');
  private combo = h('div.combo');
  private banner = h('div.banner');
  private flanked = h('div.flanked', {}, h('span.flanked-chev', {}, '⟪'), h('span', {}, 'FLANKED'), h('span.flanked-chev', {}, '⟫'));
  private overheat = h('div.overheat', {}, 'OVERHEATED');
  private vignette = h('div.hurt-vignette');
  private numbers: DamageNumber[] = [];
  private numberLayer = h('div.numbers');
  private hitT = 0;
  private hurtT = 0;
  private flankT = 0;
  private bannerT = 0;
  private ghostHp: number = PLAYER.maxHp;
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.classList.add('heat-ring');
    const track = document.createElementNS(svgNS, 'circle');
    const arc = document.createElementNS(svgNS, 'circle');
    for (const c of [track, arc]) {
      c.setAttribute('cx', '32');
      c.setAttribute('cy', '32');
      c.setAttribute('r', '26');
    }
    track.classList.add('heat-track');
    arc.classList.add('heat-arc');
    arc.setAttribute('stroke-dasharray', `${HEAT_CIRC}`);
    svg.append(track, arc);
    this.heatArc = arc;

    this.crosshair = h('div.crosshair', {}, h('i.t'), h('i.r'), h('i.b'), h('i.l'), h('b.dot'));
    const center = h('div.center', {}, svg as unknown as HTMLElement, this.crosshair, this.hitMarker, this.overheat);

    const top = h(
      'div.top',
      {},
      h('div.stat', {}, h('div.stat-label', {}, 'WAVE'), this.wave),
      h('div.stat', {}, h('div.stat-label', {}, 'SCORE'), this.score),
      this.combo,
    );

    const hp = h('div.hp', {}, h('div.hp-bar', {}, this.hpGhost, this.hpFill), this.hpText);
    const bottom = h('div.bottom', {}, hp, h('div.dash', {}, h('span.dash-label', {}, 'DASH'), this.dashPip));

    this.root.append(this.vignette, top, center, bottom, this.banner, this.flanked, this.numberLayer);

    for (let i = 0; i < 40; i++) {
      const el = h('div.dmg');
      this.numberLayer.append(el);
      this.numbers.push({ el, pos: new THREE.Vector3(), age: 0, alive: false });
    }

    const ev = game.events;
    ev.on('enemyHit', (e) => {
      this.hitT = 0.12;
      this.spawnNumber(e.x, e.y + 0.6, e.z, e.damage, e.shielded);
    });
    ev.on('enemyKilled', () => {
      this.hitT = 0.25;
      this.hitMarker.classList.add('kill');
    });
    ev.on('playerHit', ({ damage }) => (this.hurtT = Math.min(1, this.hurtT + damage / 20)));
    ev.on('flanked', () => (this.flankT = 1.6));
    ev.on('waveStart', ({ wave }) => this.showBanner(`WAVE ${wave}`, 'Jev is deciding…'));
    ev.on('waveCleared', ({ wave }) => this.showBanner(`WAVE ${wave} CLEARED`, 'Next wave incoming'));
  }

  private showBanner(title: string, sub: string) {
    this.banner.replaceChildren(h('div.banner-title', {}, title), h('div.banner-sub', {}, sub));
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // restart animation
    this.banner.classList.add('show');
    this.bannerT = 2.6;
  }

  private spawnNumber(x: number, y: number, z: number, dmg: number, shielded: boolean) {
    const n = this.numbers.find((d) => !d.alive) ?? this.numbers[0];
    n.alive = true;
    n.age = 0;
    n.pos.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
    n.el.textContent = String(dmg);
    n.el.classList.toggle('shielded', shielded);
    n.el.style.display = 'block';
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.root.classList.toggle('hidden', g.state === 'title');

    // Crosshair + heat
    this.heatArc.setAttribute('stroke-dashoffset', `${HEAT_CIRC * (1 - p.heat)}`);
    this.heatArc.classList.toggle('hot', p.heat > 0.7);
    this.heatArc.classList.toggle('jammed', p.overheated);
    this.overheat.classList.toggle('show', p.overheated);
    this.crosshair.classList.toggle('firing', g.input.mouseDown && !p.overheated);

    this.hitT = Math.max(0, this.hitT - dt);
    this.hitMarker.style.opacity = String(Math.min(1, this.hitT * 8));
    if (this.hitT === 0) this.hitMarker.classList.remove('kill');

    // HP with a trailing "ghost" bar
    const frac = p.hp / PLAYER.maxHp;
    this.ghostHp = Math.max(p.hp, this.ghostHp - dt * 30);
    this.hpFill.style.width = `${frac * 100}%`;
    this.hpGhost.style.width = `${(this.ghostHp / PLAYER.maxHp) * 100}%`;
    this.hpFill.classList.toggle('low', frac < 0.3);
    this.hpText.textContent = `${Math.ceil(p.hp)}`;
    this.dashPip.style.setProperty('--fill', `${(1 - p.dashCooldown / PLAYER.dashCooldown) * 100}%`);
    this.dashPip.classList.toggle('ready', p.dashCooldown <= 0);

    // Wave / score / combo
    this.wave.textContent = String(Math.max(1, g.waves.wave));
    this.score.textContent = fmt.int(g.combat.stats.score);
    const mult = g.combat.multiplier;
    this.combo.textContent = mult > 1 ? `×${mult}` : '';
    this.combo.classList.toggle('show', mult > 1);

    // Alerts
    this.hurtT = Math.max(0, this.hurtT - dt * 1.8);
    this.vignette.style.opacity = String(Math.max(this.hurtT, frac < 0.3 ? 0.35 + Math.sin(g.time * 6) * 0.1 : 0));
    this.flankT = Math.max(0, this.flankT - dt);
    this.flanked.classList.toggle('show', this.flankT > 0);
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.bannerT === 0) this.banner.classList.remove('show');

    // Floating damage numbers
    const cam = g.gfx.camera;
    for (const n of this.numbers) {
      if (!n.alive) continue;
      n.age += dt;
      if (n.age > 0.75) {
        n.alive = false;
        n.el.style.display = 'none';
        continue;
      }
      this.tmp.copy(n.pos).setY(n.pos.y + n.age * 1.4).project(cam);
      if (this.tmp.z > 1) {
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = 'block';
      const x = (this.tmp.x * 0.5 + 0.5) * innerWidth;
      const y = (-this.tmp.y * 0.5 + 0.5) * innerHeight;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1.25 - n.age * 0.5})`;
      n.el.style.opacity = String(1 - n.age / 0.75);
    }
  }
}
