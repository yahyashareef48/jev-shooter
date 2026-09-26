import './ui/styles.css';
import type { DecideFn } from './ai/director';
import { Game } from './Game';

// Placeholder until the Jev proxy lands: always fails, so the director uses the fallback brain.
const decide: DecideFn = () => Promise.reject(new Error('Jev proxy not wired yet'));

const game = new Game(document.getElementById('app')!, decide, false);
game.start();
game.gfx.renderer.domElement.addEventListener('click', () => {
  if (game.state !== 'playing') game.newRun();
  game.input.lock();
});

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
