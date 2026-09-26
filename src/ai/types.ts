import type { XZ } from '../core/math';

export const INTENTS = ['chase', 'flank', 'retreat'] as const;
export type Intent = (typeof INTENTS)[number];

export type EnemyType = 'drone' | 'gunner' | 'brute';

/** Movement tactics Jev can pick when it pilots the player. */
export const PLAYER_MOVES = ['advance', 'strafe_left', 'strafe_right', 'retreat', 'take_cover', 'dash_away'] as const;
export type PlayerMove = (typeof PLAYER_MOVES)[number];

/** Who made an enemy's current decision. */
export type DecisionSource = 'jev' | 'mock' | 'fallback';

/** Plain-data view of the world the AI layer reads. No three.js types, so it is unit-testable. */
export interface EnemySnapshot {
  id: string;
  type: EnemyType;
  pos: XZ;
  hp: number;
  maxHp: number;
  intent: Intent;
}

export interface WorldSnapshot {
  wave: number;
  player: {
    pos: XZ;
    facing: XZ;
    hp: number;
    maxHp: number;
    heat: number;
    overheated: boolean;
    speed: number;
    strafing: boolean;
    recentlyDashed: boolean;
    dashReady?: boolean;
    /** Player bolts have hit something in the last few seconds. */
    landingShots?: boolean;
  };
  enemies: EnemySnapshot[];
  pillars: { x: number; z: number; r: number }[];
}

// ---- Jev wire types (https://docs.typesafe.ai/api) ----

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface DecideRequest {
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
}

export interface ChoiceAnswer {
  type?: 'choice';
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface DecideResponse {
  answers: Record<string, ChoiceAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  latencyMs: number;
  mode: 'live' | 'mock';
}
