import './ui/styles.css';
import { decideViaProxy, fetchStatus } from './ai/jevClient';
import { Game } from './Game';
import { mountUI } from './ui';

const status = await fetchStatus();
// Mock when forced via ?mock, or when there is no key to go live with.
const forceMock = new URLSearchParams(location.search).has('mock');
const game = new Game(document.getElementById('app')!, decideViaProxy, forceMock || !status.hasKey);
mountUI(game, status, document.getElementById('ui')!);
game.start();

addEventListener('mousedown', (e) => {
  if (e.button !== 0 || game.input.locked) return;
  if ((e.target as HTMLElement).closest('.ai-panel.interactive')) return;
  if (game.state === 'title' || game.state === 'over') game.newRun();
  game.input.lock();
});

if (import.meta.env.DEV) Object.assign(window, { game, jevStatus: status });
