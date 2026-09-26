// Deterministic local tactic picker. Used when Jev is unreachable, when an answer is
// low-confidence, and for enemies beyond the batch cap.

import type { EnemyType, Intent } from './types';

export interface FallbackInput {
  type: EnemyType;
  hpFrac: number;
  current: Intent;
  /** Distance rank among the squad: 0 = closest to the player. */
  proximityRank: number;
  squad: { alive: number; chasing: number; flanking: number; retreating: number };
}

export function fallbackDecide(e: FallbackInput): Intent {
  const { squad } = e;
  // Hurt units back off (brutes are too stubborn unless nearly dead)...
  const retreatAt = e.type === 'brute' ? 0.2 : 0.35;
  if (e.hpFrac < retreatAt) return 'retreat';
  // ...and stay back until mostly recovered.
  if (e.current === 'retreat' && e.hpFrac < 0.8) return 'retreat';

  // The closest few keep the pressure on.
  if (e.proximityRank < 2) return 'chase';

  // If most of the squad is already charging, peel off to flank — but not everyone.
  const chaseShare = squad.alive > 0 ? squad.chasing / squad.alive : 0;
  const flankShare = squad.alive > 0 ? squad.flanking / squad.alive : 0;
  if (chaseShare > 0.5 && flankShare < 0.4) return 'flank';
  if (e.current === 'flank' && flankShare <= 0.5) return 'flank';
  return 'chase';
}
