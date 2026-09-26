import './ui/styles.css';
import { decideViaProxy, fetchStatus } from './ai/jevClient';
import { Game } from './Game';

const status = await fetchStatus();
// Mock when forced via ?mock, or when there is no key to go live with.
const forceMock = new URLSearchParams(location.search).has('mock');
const game = new Game(document.getElementById('app')!, decideViaProxy, forceMock || !status.hasKey);
game.start();
game.gfx.renderer.domElement.addEventListener('click', () => {
  if (game.state !== 'playing') game.newRun();
  game.input.lock();
});

if (import.meta.env.DEV) Object.assign(window, { game, jevStatus: status });
