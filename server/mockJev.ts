// Offline stand-in for Jev with the exact same response shape. Scores each tactic from the
// bucketed state with a few heuristics + noise, then softmaxes into probabilities.

interface MockEnemy {
  id: string;
  type?: string;
  health?: string;
  distance?: string;
  position?: string;
  in_cover?: boolean;
  current_tactic?: string;
}

interface MockState {
  player?: { health?: string; weapon?: string; dash?: string; enemies_point_blank?: boolean; health_orbs?: string };
  squad?: { alive?: number; chasing?: number; flanking?: number };
  enemies?: MockEnemy[];
}

const TACTICS = ['chase', 'flank', 'retreat'] as const;

function softmaxAnswer(scores: Record<string, number>, temperature = 1.6) {
  const keys = Object.keys(scores);
  for (const k of keys) scores[k] += (Math.random() - 0.5) * 0.6;
  const max = Math.max(...keys.map((k) => scores[k]));
  const exp = keys.map((k) => Math.exp((scores[k] - max) * temperature));
  const sum = exp.reduce((a, b) => a + b, 0);
  const probabilities: Record<string, number> = {};
  keys.forEach((k, i) => (probabilities[k] = +(exp[i] / sum).toFixed(3)));
  const choice = keys.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
  return { type: 'choice', choice, probabilities, confidence: probabilities[choice] };
}

/** Mock answers for the two questions asked when Jev pilots the player. */
function mockPilot(id: string, criteria: Record<string, unknown>, state: MockState) {
  const pl = state.player ?? {};
  if (id === 'player_move') {
    const hurt = pl.health === 'low' || pl.health === 'critical';
    const jammed = pl.weapon?.startsWith('overheated') ?? false;
    const base: Record<string, number> = { advance: 0.4, strafe_left: 1, strafe_right: 1, retreat: 0.5, take_cover: 0.2, dash_away: -1, grab_health: -0.5 };
    const s: Record<string, number> = {};
    for (const k of Object.keys(criteria)) s[k] = base[k] ?? 0; // only offer what was asked
    if ((hurt || jammed) && 'take_cover' in s) s.take_cover += 2.2;
    if (pl.enemies_point_blank) {
      if ('retreat' in s) s.retreat += 1.2;
      if ('dash_away' in s && pl.dash === 'ready') s.dash_away += 2.5;
    }
    if ('grab_health' in s && pl.health_orbs?.includes('safe')) s.grab_health += hurt ? 3 : pl.health_orbs.startsWith('close') ? 1 : 0;
    return softmaxAnswer(s);
  }
  // player_target: prefer weak, close, flanking enemies.
  const byId = new Map((state.enemies ?? []).map((e) => [e.id, e]));
  const s: Record<string, number> = {};
  for (const key of Object.keys(criteria)) {
    const e = byId.get(key);
    let v = 0;
    if (e?.distance === 'point-blank' || e?.distance === 'close') v += 1.5;
    if (e?.health === 'low' || e?.health === 'critical') v += 1;
    if (e?.current_tactic === 'flank') v += 0.8;
    if (e?.in_cover) v -= 1.5;
    s[key] = v;
  }
  return softmaxAnswer(s, 2.2);
}

export function mockDecide(request: { state: unknown; questions: Record<string, unknown> }) {
  const state = (request.state ?? {}) as MockState;
  const byId = new Map((state.enemies ?? []).map((e) => [e.id, e]));
  const squad = state.squad ?? {};
  const chaseShare = (squad.chasing ?? 0) / Math.max(1, squad.alive ?? 1);
  const flankShare = (squad.flanking ?? 0) / Math.max(1, squad.alive ?? 1);
  const playerWeak = state.player?.health === 'low' || state.player?.health === 'critical';
  const playerJammed = state.player?.weapon?.startsWith('overheated') ?? false;

  const answers: Record<string, unknown> = {};
  for (const id of Object.keys(request.questions)) {
    if (id.startsWith('player_')) {
      const q = request.questions[id] as { criteria?: Record<string, unknown> };
      answers[id] = mockPilot(id, q.criteria ?? {}, state);
      continue;
    }
    const e: MockEnemy = byId.get(id) ?? { id };
    const s = { chase: 1, flank: 0.6, retreat: 0.1 };
    if (e.health === 'critical') s.retreat += 2.6;
    if (e.health === 'low') s.retreat += 1.2;
    if (e.current_tactic === 'retreat' && e.health !== 'full' && e.health !== 'high') s.retreat += 1;
    if (e.distance === 'point-blank' || e.distance === 'close') s.chase += 1;
    if (chaseShare > 0.5) s.flank += 1.3;
    if (flankShare > 0.45) s.flank -= 1;
    if (e.position && e.position !== 'in front of the player') s.flank += 0.5;
    if (playerJammed) s.chase += 1.6;
    if (playerWeak) s.chase += 1;
    if (e.type === 'brute') s.retreat -= 0.8;
    if (e.current_tactic && e.current_tactic in s) s[e.current_tactic as keyof typeof s] += 0.4;
    for (const t of TACTICS) s[t] += (Math.random() - 0.5) * 0.8;

    const max = Math.max(s.chase, s.flank, s.retreat);
    const exp = TACTICS.map((t) => Math.exp((s[t] - max) * 1.6));
    const sum = exp.reduce((a, b) => a + b, 0);
    const probabilities: Record<string, number> = {};
    TACTICS.forEach((t, i) => (probabilities[t] = +(exp[i] / sum).toFixed(3)));
    const choice = TACTICS.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
    answers[id] = { type: 'choice', choice, probabilities, confidence: probabilities[choice] };
  }
  const input_tokens = Math.round(JSON.stringify(request).length / 4);
  return { model: 'mock-jev', answers, usage: { input_tokens, output_tokens: 0 } };
}
