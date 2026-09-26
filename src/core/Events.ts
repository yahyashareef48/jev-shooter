import type { Intent } from '../ai/types';

export interface GameEvents {
  shot: { x: number; y: number; z: number };
  enemyShot: { x: number; y: number; z: number };
  enemyHit: { x: number; y: number; z: number; damage: number; shielded: boolean };
  enemyKilled: { x: number; y: number; z: number; color: number; score: number; intent: Intent; big: boolean };
  playerHit: { damage: number };
  impact: { x: number; y: number; z: number; color: number };
  dash: Record<string, never>;
  overheat: Record<string, never>;
  pickup: { heal: number };
  intentChanged: { id: string; intent: Intent };
  flanked: { id: string };
  waveStart: { wave: number };
  waveCleared: { wave: number };
  spawn: { x: number; z: number };
  gameOver: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class Events {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<GameEvents[K]>)(payload));
  }
}
