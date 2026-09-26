import type { ProxyStatus } from '../ai/jevClient';
import type { Game } from '../Game';
import { fmt, h } from './dom';

const CONTROLS: [string, string][] = [
  ['WASD', 'move'],
  ['Mouse', 'aim'],
  ['Click', 'fire'],
  ['Shift / Space', 'dash'],
  ['Tab', 'AI panel'],
  ['J', 'live ↔ mock'],
  ['M', 'mute'],
  ['Esc', 'pause'],
];

/** Title, pause and game-over overlays. */
export class Screens {
  readonly root = h('div.screens');
  private title: HTMLElement;
  private pause: HTMLElement;
  private over = h('div.screen.over');
  private shownOver = false;

  constructor(
    private game: Game,
    status: ProxyStatus,
  ) {
    const modeLine = status.hasKey
      ? h('div.mode-line.live', {}, h('i'), `LIVE · ${status.model}`)
      : h('div.mode-line.mock', {}, h('i'), 'MOCK MODE · add JEV_API_KEY to .env to go live');

    this.title = h(
      'div.screen.title',
      {},
      h('div.logo', {}, h('span.logo-a', {}, 'JEV'), h('span.logo-b', {}, 'SHOOTER')),
      h('div.tagline', {}, 'Enemies that think. Every tick, the whole squad asks ', h('b', {}, 'Jev'), ' one batched question:'),
      h(
        'div.tactics',
        {},
        h('span.chip.chase', {}, 'chase'),
        h('span.slash', {}, '/'),
        h('span.chip.flank', {}, 'flank'),
        h('span.slash', {}, '/'),
        h('span.chip.retreat', {}, 'retreat'),
      ),
      modeLine,
      h('div.cta', {}, 'CLICK TO DEPLOY'),
      h('div.controls', {}, ...CONTROLS.map(([k, v]) => h('div.ctl', {}, h('kbd', {}, k), h('span', {}, v)))),
    );
    this.pause = h('div.screen.pause', {}, h('div.big', {}, 'PAUSED'), h('div.cta', {}, 'CLICK TO RESUME'));
    this.root.append(this.title, this.pause, this.over);
  }

  update() {
    const g = this.game;
    this.title.classList.toggle('show', g.state === 'title');
    this.pause.classList.toggle('show', g.state === 'paused');
    const over = g.state === 'over' && !g.player.alive;
    if (over && !this.shownOver) this.renderOver();
    this.shownOver = over;
    this.over.classList.toggle('show', over);
  }

  private renderOver() {
    const g = this.game;
    const c = g.combat.stats;
    const d = g.director.stats;
    const stat = (label: string, value: string) => h('div.os', {}, h('b', {}, value), h('span', {}, label));
    this.over.replaceChildren(
      h('div.big.red', {}, 'SQUAD WINS'),
      h('div.sub', {}, `You fell on wave ${g.waves.wave}`),
      h(
        'div.over-grid',
        {},
        stat('score', fmt.int(c.score)),
        stat('kills', fmt.int(c.kills)),
        stat('flankers killed', fmt.int(c.flankKills)),
        stat('best combo', `×${Math.min(8, 1 + Math.floor(c.bestCombo / 3))}`),
        stat('jev calls', fmt.int(d.calls)),
        stat('jev decisions', fmt.int(d.jevDecisions)),
        stat('avg latency', d.avgLatency ? fmt.ms(d.avgLatency) : '—'),
        stat('cost', fmt.usd(d.costUsd)),
      ),
      h('div.cta', {}, 'CLICK TO REDEPLOY'),
    );
  }
}
