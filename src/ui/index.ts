import type { Game } from '../Game';
import { AiPanel } from './aiPanel';
import { h } from './dom';
import { Hud } from './hud';
import { OffscreenIndicators } from './offscreen';
import { Radar } from './radar';
import { Screens } from './screens';
import { SettingsPanel } from './settingsPanel';

export function mountUI(game: Game, root: HTMLElement) {
  const hud = new Hud(game);
  const radar = new Radar(game);
  const offscreen = new OffscreenIndicators(game);
  const panel = new AiPanel(game);
  const settingsPanel = new SettingsPanel(game);
  const screens = new Screens(game, () => settingsPanel.open());

  const gear = h('button.gear', { title: 'Settings (O)' }, '⚙');
  gear.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    settingsPanel.toggle();
  });
  const corner = h('div.corner', {}, panel.badge, gear);
  root.append(offscreen.root, hud.root, radar.root, corner, panel.root, screens.root, settingsPanel.root);

  game.onFrame((dt) => {
    hud.update(dt);
    radar.update(dt);
    offscreen.update();
    panel.update(dt);
    screens.update();
    corner.classList.toggle('hidden', game.state === 'title');
  });
  return { settingsPanel };
}
