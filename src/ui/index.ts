import type { ProxyStatus } from '../ai/jevClient';
import type { Game } from '../Game';
import { AiPanel } from './aiPanel';
import { h } from './dom';
import { Hud } from './hud';
import { OffscreenIndicators } from './offscreen';
import { Radar } from './radar';
import { Screens } from './screens';

export function mountUI(game: Game, status: ProxyStatus, root: HTMLElement) {
  const hud = new Hud(game);
  const radar = new Radar(game);
  const offscreen = new OffscreenIndicators(game);
  const panel = new AiPanel(game, status);
  const screens = new Screens(game, status);
  const corner = h('div.corner', {}, panel.badge);
  root.append(offscreen.root, hud.root, radar.root, corner, panel.root, screens.root);

  game.onFrame((dt) => {
    hud.update(dt);
    radar.update(dt);
    offscreen.update();
    panel.update(dt);
    screens.update();
    corner.classList.toggle('hidden', game.state === 'title');
  });
}
