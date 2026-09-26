import type { Game } from '../Game';
import { session } from '../settings/session';
import { fmt, h } from './dom';

const CONTROLS: [string, string][] = [
  ['WASD', 'move'],
  ['Mouse', 'aim'],
  ['Click', 'fire'],
  ['Shift / Space', 'dash'],
  ['Tab', 'AI panel'],
  ['J', 'live ↔ mock'],
  ['P', 'Jev pilots you'],
  ['O', 'settings'],
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
  private modeLine = h('div.mode-line');
  private modeText = '';

  constructor(
    private game: Game,
    openSettings: () => void,
  ) {
    const modeLine = this.modeLine;
    const settingsBtn = () => {
      const b = h('button.settings-btn', {}, '⚙ Settings ', h('kbd', {}, 'O'));
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation(); // don't start the run
        openSettings();
      });
      return b;
    };

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
      h('div.pilot-hint', {}, 'or press ', h('kbd', {}, 'P'), ' to let Jev pilot you and watch it fight itself'),
      settingsBtn(),
      h('div.controls', {}, ...CONTROLS.map(([k, v]) => h('div.ctl', {}, h('kbd', {}, k), h('span', {}, v)))),
    );
    this.pause = h('div.screen.pause', {}, h('div.big', {}, 'PAUSED'), h('div.cta', {}, 'CLICK TO RESUME'), settingsBtn());
    this.root.append(this.title, this.pause, this.over);
  }

  update() {
    const g = this.game;
    const live = !g.director.useMock && session.hasKey();
    const text = live
      ? `LIVE · ${session.effectiveModel()}`
      : session.hasKey()
        ? 'MOCK MODE · press J to go live'
        : 'MOCK MODE · add your Jev key in Settings (O) to go live';
    if (text !== this.modeText) {
      this.modeText = text;
      this.modeLine.className = `mode-line ${live ? 'live' : 'mock'}`;
      this.modeLine.replaceChildren(h('i'), text);
    }
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
      h('div.cta', {}, g.pilot.enabled ? 'JEV REDEPLOYS IN A MOMENT…' : 'CLICK TO REDEPLOY'),
    );
  }
}
