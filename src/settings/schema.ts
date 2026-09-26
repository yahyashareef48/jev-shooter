// Every value the settings panel exposes, grouped into tabs. Fields point straight at the live
// config objects, so edits apply immediately (or on the next run/spawn where noted).

import { PROMPTS, STATE_FIELDS } from '../ai/prompts';
import { PLAYER_MOVES, type EnemyType } from '../ai/types';
import { CAMERA, DIRECTOR, PICKUPS, PILOT, PLAYER, WAVES } from '../core/config';
import { STATS } from '../entities/EnemyTypes';
import { settings } from './store';

export const TABS = ['Jev', 'Enemy AI', 'Player AI', 'State', 'Gameplay'] as const;
export type Tab = (typeof TABS)[number];

let registered = false;

export function registerSettings() {
  if (registered) return;
  registered = true;
  const maxShare = DIRECTOR.maxShare as Record<string, number>;

  // ---------------- Jev ----------------
  settings.group('Jev', 'Request cadence', [
    { label: 'Decision interval (s)', key: 'interval', obj: DIRECTOR, min: 0.5, max: 6, step: 0.1, help: 'How often one batched call is sent.' },
    { label: 'Min interval on events (s)', key: 'minInterval', obj: DIRECTOR, min: 0.3, max: 5, step: 0.1, help: 'Earliest re-ask after a wave start, dash or kill.' },
    { label: 'Max questions per batch', key: 'maxBatch', obj: DIRECTOR, min: 1, max: 60, step: 1, help: 'Nearest enemies get a Jev question; the rest use the local brain.' },
    { label: 'Request timeout (ms)', key: 'requestTimeoutMs', obj: DIRECTOR, min: 500, max: 15000, step: 100 },
    { label: 'Backoff min (s)', key: 'backoffMin', obj: DIRECTOR, min: 0.5, max: 10, step: 0.5 },
    { label: 'Backoff max (s)', key: 'backoffMax', obj: DIRECTOR, min: 1, max: 60, step: 1 },
    { label: 'Price per 1M input tokens ($)', key: 'pricePerMTok', obj: DIRECTOR, min: 0, max: 5, step: 0.001, help: 'Only used for the cost readout.' },
  ]);

  // ---------------- Enemy AI ----------------
  settings.group('Enemy AI', 'Applying answers', [
    { label: 'Confidence gate', key: 'confidenceGate', obj: DIRECTOR, min: 0, max: 1, step: 0.01, help: 'Answers below this go to the local fallback brain.' },
    { label: 'Min commit time (s)', key: 'minCommit', obj: DIRECTOR, min: 0, max: 5, step: 0.1, help: 'Hysteresis: keep a tactic at least this long…' },
    { label: 'Switch margin', key: 'switchMargin', obj: DIRECTOR, min: 0, max: 1, step: 0.01, help: '…unless the new choice beats it by this much probability.' },
    { label: 'Max share flanking', key: 'flank', obj: maxShare, min: 0, max: 1, step: 0.05, help: 'Squad balancer cap (1 = off).' },
    { label: 'Max share retreating', key: 'retreat', obj: maxShare, min: 0, max: 1, step: 0.05, help: 'Squad balancer cap (1 = off).' },
  ]);
  settings.group('Enemy AI', 'Question', [
    { label: 'Instructions ({id} = enemy id)', key: 'enemyInstructions', obj: PROMPTS, kind: 'textarea' },
  ]);
  for (const type of ['drone', 'gunner', 'brute'] as EnemyType[]) {
    settings.group('Enemy AI', `Answer options · ${type}`, [
      { label: 'chase', key: 'chase', obj: PROMPTS.enemyCriteria[type], kind: 'textarea' },
      { label: 'flank', key: 'flank', obj: PROMPTS.enemyCriteria[type], kind: 'textarea' },
      { label: 'retreat', key: 'retreat', obj: PROMPTS.enemyCriteria[type], kind: 'textarea' },
    ]);
  }

  // ---------------- Player AI (pilot) ----------------
  settings.group('Player AI', 'Questions', [
    { label: 'Pilot instructions (shared)', key: 'pilotInstructions', obj: PROMPTS, kind: 'textarea' },
    { label: 'Move question', key: 'pilotMoveQuestion', obj: PROMPTS, kind: 'textarea' },
    { label: 'Target question', key: 'pilotTargetQuestion', obj: PROMPTS, kind: 'textarea' },
  ]);
  settings.group(
    'Player AI',
    'Move options',
    PLAYER_MOVES.map((m) => ({ label: m.replace('_', ' '), key: m, obj: PROMPTS.moveCriteria, kind: 'textarea' as const })),
  );
  settings.group('Player AI', 'Reflexes', [
    { label: 'Turn rate (rad/s)', key: 'turnRate', obj: PILOT, min: 2, max: 30, step: 0.5 },
    { label: 'Aim gain', key: 'aimGain', obj: PILOT, min: 2, max: 60, step: 1 },
    { label: 'Stop firing above heat', key: 'heatLimit', obj: PILOT, min: 0.3, max: 1, step: 0.01 },
    { label: 'Stall after (s)', key: 'stallAfter', obj: PILOT, min: 1, max: 15, step: 0.5, help: 'No hits for this long → push in.' },
    { label: 'Unstick for (s)', key: 'unstickFor', obj: PILOT, min: 0.5, max: 8, step: 0.5 },
  ]);
  settings.group('Player AI', 'Health orbs', [
    { label: 'Urgent below health', key: 'orbUrgentHp', obj: PILOT, min: 0, max: 1, step: 0.05, help: 'Detour for an orb when this hurt.' },
    { label: 'Urgent range (m)', key: 'orbUrgentRange', obj: PILOT, min: 5, max: 60, step: 1 },
    { label: 'Opportunistic below health', key: 'orbOpportunisticHp', obj: PILOT, min: 0, max: 1, step: 0.05, help: 'Grab a close, unguarded orb in passing.' },
    { label: 'Opportunistic range (m)', key: 'orbOpportunisticRange', obj: PILOT, min: 2, max: 30, step: 1 },
    { label: 'Guard radius (m)', key: 'orbGuardRadius', obj: PILOT, min: 1, max: 15, step: 0.5, help: 'An enemy this close makes an orb unsafe.' },
  ]);

  // ---------------- State ----------------
  const ef = STATE_FIELDS.enemy as Record<string, boolean>;
  const pf = STATE_FIELDS.player as Record<string, boolean>;
  settings.group('State', 'Per-enemy fields', Object.keys(ef).map((k) => ({ label: k, key: k, obj: ef })));
  settings.group(
    'State',
    'Player fields',
    Object.keys(pf).map((k) => ({
      label: k,
      key: k,
      obj: pf,
      help: ['health', 'weapon', 'movement'].includes(k) ? undefined : 'Only sent while Jev pilots the player.',
    })),
  );
  settings.group('State', 'Squad', [{ label: 'squad counts (alive / chasing / flanking / retreating)', key: 'counts', obj: STATE_FIELDS.squad }]);

  // ---------------- Gameplay ----------------
  settings.group('Gameplay', 'Player', [
    { label: 'Max health', key: 'maxHp', obj: PLAYER, min: 10, max: 1000, step: 10, applies: 'next run' },
    { label: 'Move speed', key: 'speed', obj: PLAYER, min: 2, max: 30, step: 0.5 },
    { label: 'Dash cooldown (s)', key: 'dashCooldown', obj: PLAYER, min: 0.2, max: 10, step: 0.1 },
    { label: 'Fire rate (shots/s)', key: 'fireRate', obj: PLAYER, min: 1, max: 30, step: 0.5 },
    { label: 'Bullet damage', key: 'bulletDamage', obj: PLAYER, min: 1, max: 200, step: 1 },
    { label: 'Heat per shot', key: 'heatPerShot', obj: PLAYER, min: 0, max: 0.5, step: 0.005 },
    { label: 'Heat cool rate (/s)', key: 'heatCoolRate', obj: PLAYER, min: 0.05, max: 3, step: 0.05 },
  ]);
  for (const type of ['drone', 'gunner', 'brute'] as EnemyType[]) {
    settings.group('Gameplay', `Enemy · ${type}`, [
      { label: 'Health', key: 'hp', obj: STATS[type], min: 1, max: 2000, step: 1, applies: 'new spawns' },
      { label: 'Speed', key: 'speed', obj: STATS[type], min: 0.5, max: 25, step: 0.5 },
      { label: 'Damage', key: 'damage', obj: STATS[type], min: 0, max: 200, step: 1 },
      { label: 'Attack cooldown (s)', key: 'attackCooldown', obj: STATS[type], min: 0.1, max: 10, step: 0.1 },
    ]);
  }
  settings.group('Gameplay', 'Waves & pickups', [
    { label: 'Break between waves (s)', key: 'intermission', obj: WAVES, min: 0, max: 30, step: 0.5 },
    { label: 'Spawn interval (s)', key: 'spawnInterval', obj: WAVES, min: 0.05, max: 3, step: 0.05 },
    { label: 'Max enemies per wave', key: 'maxEnemies', obj: WAVES, min: 1, max: 60, step: 1 },
    { label: 'Health orb drop chance', key: 'dropChance', obj: PICKUPS, min: 0, max: 1, step: 0.05 },
    { label: 'Health orb heal', key: 'heal', obj: PICKUPS, min: 1, max: 200, step: 1 },
    { label: 'Health orb lifetime (s)', key: 'lifetime', obj: PICKUPS, min: 2, max: 60, step: 1 },
  ]);
  settings.group('Gameplay', 'Camera', [
    { label: 'Mouse sensitivity', key: 'sensitivity', obj: CAMERA, min: 0.0005, max: 0.008, step: 0.0001 },
    { label: 'Field of view', key: 'fov', obj: CAMERA, min: 50, max: 110, step: 1 },
  ]);

  settings.load();
}
