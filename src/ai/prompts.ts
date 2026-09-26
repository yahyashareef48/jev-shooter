// Everything Jev is told, in one editable place. The settings panel mutates these objects at
// runtime, so edits take effect on the very next batched call.

import type { EnemyType, Intent, PlayerMove } from './types';

export const PROMPTS = {
  /** `{id}` is replaced with the enemy id. */
  enemyInstructions:
    'Pick the next tactic for enemy {id} (its entry is in state.enemies). ' +
    'Enemies share one goal: kill the player. Coordinate as a squad: not everyone should do the same thing; ' +
    'badly wounded units should survive to fight later; punish an overheated, low-health or distracted player; ' +
    'the nearest units (low closeness_rank) should usually keep the pressure on while others flank; ' +
    'flank when the front is crowded; keep committed to a tactic unless the situation clearly changed.',

  enemyCriteria: {
    drone: {
      chase: 'Rush straight at the player and zap them up close',
      flank: "Swing wide around to the player's side or back, then strike",
      retreat: 'Break line of sight behind a pillar and recover health',
    },
    gunner: {
      chase: 'Advance to firing range and shoot the player head-on',
      flank: "Reposition to the player's side or back and fire from there",
      retreat: 'Fall back to cover behind a pillar, firing only if exposed',
    },
    brute: {
      chase: 'Push forward shield-first and charge when close',
      flank: "Circle slowly to hit the player's unshielded side or back",
      retreat: 'Withdraw behind a pillar to regenerate',
    },
  } as Record<EnemyType, Record<Intent, string>>,

  pilotInstructions:
    'You are now piloting the PLAYER (state.player) against this squad. Goal: survive and kill every enemy. ' +
    'Use cover when hurt or when the weapon is overheated, dash only to escape point-blank danger, ' +
    'circle-strafe ranged gunners, never let flankers get behind you, ' +
    'grab a health orb only when hurt and it is close and safe, ' +
    'and if shots keep missing or the fight is stuck circling, advance on the target to finish it.',
  pilotMoveQuestion: 'Pick how the player moves next.',
  pilotTargetQuestion: 'Pick which enemy the player should shoot now: prefer the most dangerous one you can hit.',

  moveCriteria: {
    advance: 'Push toward the target to finish it off',
    strafe_left: 'Circle-strafe to the left around the target while shooting',
    strafe_right: 'Circle-strafe to the right around the target while shooting',
    retreat: 'Back away from the nearest threats while shooting',
    take_cover: 'Move behind a pillar to break line of sight, heal up and let the gun cool',
    dash_away: 'Dash out of immediate danger (only when dash is ready and enemies are point-blank)',
    grab_health: 'Detour to the nearest health orb (only when hurt and an orb is close and safe)',
  } as Record<PlayerMove, string>,
};

/** Which bucketed fields go into `state`. Turn some off to see how Jev copes without them. */
export const STATE_FIELDS = {
  enemy: {
    type: true,
    closeness_rank: true,
    health: true,
    distance: true,
    position: true,
    in_cover: true,
    current_tactic: true,
    allies_nearby: true,
  },
  player: {
    health: true,
    weapon: true,
    movement: true,
    // pilot-only fields
    dash: true,
    enemies_point_blank: true,
    enemies_behind: true,
    shots: true,
    health_orbs: true,
  },
  squad: { counts: true },
};
