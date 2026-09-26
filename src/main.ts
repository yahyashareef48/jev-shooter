import './ui/styles.css';
import { decideViaProxy, fetchStatus } from './ai/jevClient';
import { Game } from './Game';
import { registerSettings } from './settings/schema';
import { session } from './settings/session';
import { mountUI } from './ui';

// Apply saved settings before anything reads the config objects.
registerSettings();

const status = await fetchStatus();
session.envKey = status.hasKey;
session.envModel = status.model;
session.proxyReachable = status.reachable;

// Mock when forced via ?mock, or when there is no key (from Settings or .env) to go live with.
const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('app')!, decideViaProxy, params.has('mock') || !session.hasKey());
const { settingsPanel } = mountUI(game, document.getElementById('ui')!);
game.start();
// ?pilot starts a run with Jev flying the player too.
if (params.has('pilot')) game.togglePilot();

addEventListener('mousedown', (e) => {
  if (e.button !== 0 || game.input.locked) return;
  if ((e.target as HTMLElement).closest('.ai-panel.interactive, .settings, button')) return;
  settingsPanel.close(); // clicking back into the game closes the drawer
  if (game.state === 'title' || game.state === 'over') game.newRun();
  game.input.lock();
});

if (import.meta.env.DEV) Object.assign(window, { game, session });
