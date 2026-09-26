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
  player?: { health?: string; weapon?: string };
  squad?: { alive?: number; chasing?: number; flanking?: number };
  enemies?: MockEnemy[];
}

const TACTICS = ['chase', 'flank', 'retreat'] as const;

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
