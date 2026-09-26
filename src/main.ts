import './ui/styles.css';
import { Game } from './Game';

const game = new Game(document.getElementById('app')!);
game.start();

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
