// The AI Director: every tick it asks Jev ONE batched question set covering the whole squad,
// then gates, de-flaps and applies the answers. Falls back to a local brain whenever Jev
// is unavailable, slow to answer, or unsure.

import { DIRECTOR } from '../core/config';
import { angleBetween, dist, sub, type XZ } from '../core/math';
import { fallbackDecide } from './fallbackBrain';
import type { Pilot } from './pilot';
import { buildRequest, PILOT_MOVE_Q, PILOT_TARGET_Q } from './stateBuilder';
import {
  INTENTS,
  type DecideRequest,
  type DecideResponse,
  type DecisionSource,
  type EnemyType,
  type Intent,
  type WorldSnapshot,
} from './types';

/** What the director needs from an enemy. Enemy implements this; tests use plain objects. */
export interface DirectedUnit {
  readonly id: string;
  readonly type: EnemyType;
  readonly pos: XZ;
  readonly hpFrac: number;
  readonly alive: boolean;
  intent: Intent;
  intentSince: number;
  flankSide: 1 | -1;
  setIntent(intent: Intent, source: DecisionSource, now: number, probs?: Partial<Record<Intent, number>>, confidence?: number): boolean;
}

export type DecideFn = (req: DecideRequest, opts: { mock: boolean; signal: AbortSignal }) => Promise<DecideResponse>;

export type DirectorStatus = 'idle' | 'waiting' | 'ok' | 'error' | 'disabled';

export interface DirectorStats {
  calls: number;
  errors: number;
  jevDecisions: number;
  fallbackDecisions: number;
  lowConfidence: number;
  rebalanced: number;
  staleDropped: number;
  lastBatch: number;
  lastLatency: number;
  avgLatency: number;
  tokens: number;
  costUsd: number;
  status: DirectorStatus;
  lastError: string | null;
  lastMode: 'live' | 'mock' | null;
  lastRequest: DecideRequest | null;
  lastResponse: DecideResponse | null;
  backoffUntil: number;
}

export interface ApplyConfig {
  gate: number;
  minCommit: number;
  switchMargin: number;
  maxShare?: Partial<Record<Intent, number>>;
}

export interface ApplyResult {
  applied: number;
  lowConfidence: string[];
  stale: number;
  changed: string[];
  rebalanced: number;
}

const isIntent = (s: unknown): s is Intent => typeof s === 'string' && (INTENTS as readonly string[]).includes(s);

interface Pending {
  u: DirectedUnit;
  choice: Intent;
  probs: Partial<Record<Intent, number>>;
  conf: number;
}

/**
 * Jev answers each question independently, so a squad can all pick the same tactic.
 * Cap flank/retreat to a share of the squad, demoting the units that wanted it least
 * to their next-best option according to Jev's own probabilities.
 */
export function balanceSquad(
  pending: Pending[],
  aliveUnits: readonly DirectedUnit[],
  maxShare: Partial<Record<Intent, number>>,
): number {
  let moved = 0;
  const deciding = new Set(pending.map((p) => p.u.id));
  const capped = new Set<Intent>();
  for (const intent of INTENTS) {
    const share = maxShare[intent];
    if (share === undefined) continue;
    const limit = Math.max(1, Math.floor(aliveUnits.length * share));
    const keeping = aliveUnits.filter((u) => !deciding.has(u.id) && u.intent === intent).length;
    const wanting = pending.filter((p) => p.choice === intent).sort((a, b) => (a.probs[intent] ?? 0) - (b.probs[intent] ?? 0));
    let excess = keeping + wanting.length - limit;
    capped.add(intent);
    // Never demote into a tactic whose cap was already enforced.
    const alt = INTENTS.filter((i) => !capped.has(i));
    for (const p of wanting) {
      if (excess <= 0 || !alt.length) break;
      p.choice = alt.reduce((a, b) => ((p.probs[b] ?? 0) > (p.probs[a] ?? 0) ? b : a));
      moved++;
      excess--;
    }
  }
  return moved;
}

/**
 * Apply one Jev response. Units that died since the request are counted stale.
 * Low-confidence / invalid answers are returned so the caller can fall back for them.
 * Hysteresis: a unit keeps its tactic for `minCommit` seconds unless the new choice
 * beats the current one by more than `switchMargin` probability.
 */
export function applyAnswers(
  res: DecideResponse,
  units: ReadonlyMap<string, DirectedUnit>,
  now: number,
  cfg: ApplyConfig,
  source: DecisionSource,
): ApplyResult {
  const out: ApplyResult = { applied: 0, lowConfidence: [], stale: 0, changed: [], rebalanced: 0 };
  const pending: Pending[] = [];
  for (const [id, ans] of Object.entries(res.answers ?? {})) {
    const u = units.get(id);
    if (!u || !u.alive) {
      out.stale++;
      continue;
    }
    const probs: Partial<Record<Intent, number>> = {};
    for (const i of INTENTS) if (typeof ans.probabilities?.[i] === 'number') probs[i] = ans.probabilities[i];
    const conf = typeof ans.confidence === 'number' ? ans.confidence : Math.max(0, ...Object.values(probs));
    if (!isIntent(ans.choice) || conf < cfg.gate) {
      out.lowConfidence.push(id);
      continue;
    }
    pending.push({ u, choice: ans.choice, probs, conf });
  }

  if (cfg.maxShare) {
    const alive = [...units.values()].filter((u) => u.alive);
    out.rebalanced = balanceSquad(pending, alive, cfg.maxShare);
  }

  for (const { u, probs, conf, choice: wanted } of pending) {
    let choice = wanted;
    if (choice !== u.intent && now - u.intentSince < cfg.minCommit) {
      const margin = (probs[choice] ?? 1) - (probs[u.intent] ?? 0);
      if (margin < cfg.switchMargin) choice = u.intent;
    }
    if (u.setIntent(choice, source, now, probs, conf)) out.changed.push(u.id);
    out.applied++;
  }
  return out;
}

/** Side (+1 right / -1 left of the player's facing) a unit is already on. */
export function naturalSide(u: XZ, playerPos: XZ, facing: XZ): 1 | -1 {
  return angleBetween(facing, sub(u, playerPos)) >= 0 ? 1 : -1;
}

export class Director {
  useMock: boolean;
  enabled = true;
  /** When set and enabled, the player's tactic rides along in the same batched call. */
  pilot: Pilot | null = null;
  readonly stats: DirectorStats = {
    calls: 0,
    errors: 0,
    jevDecisions: 0,
    fallbackDecisions: 0,
    lowConfidence: 0,
    rebalanced: 0,
    staleDropped: 0,
    lastBatch: 0,
    lastLatency: 0,
    avgLatency: 0,
    tokens: 0,
    costUsd: 0,
    status: 'idle',
    lastError: null,
    lastMode: null,
    lastRequest: null,
    lastResponse: null,
    backoffUntil: 0,
  };
  private inFlight: AbortController | null = null;
  private nextAt = 0;
  private lastSentAt = -99;
  private triggered = false;
  private backoff = 0;
  private wave = 0;

  constructor(
    private decide: DecideFn,
    private getUnits: () => readonly DirectedUnit[],
    private clock: () => number,
    private onChanged: (id: string, intent: Intent) => void,
    useMock = false,
  ) {
    this.useMock = useMock;
  }

  /** Ask for a fresh decision soon (e.g. on wave start or when the player dashes). */
  trigger() {
    this.triggered = true;
  }

  reset() {
    this.inFlight?.abort();
    this.inFlight = null;
    this.nextAt = 0;
    this.triggered = false;
  }

  update(world: WorldSnapshot) {
    const now = this.clock();
    if (world.wave !== this.wave) {
      this.wave = world.wave;
      this.triggered = true;
    }
    const units = this.getUnits().filter((u) => u.alive);
    if (!units.length) return;

    const due = now >= this.nextAt || (this.triggered && now - this.lastSentAt >= DIRECTOR.minInterval);
    if (!due || this.inFlight) return;
    this.triggered = false;
    this.nextAt = now + DIRECTOR.interval;

    const piloting = !!this.pilot?.enabled;
    if (!this.enabled || now < this.stats.backoffUntil) {
      this.stats.status = this.enabled ? 'error' : 'disabled';
      this.runFallback(units, world, units.map((u) => u.id), now);
      if (piloting) this.pilot!.fallback(world, now);
      return;
    }

    const { request, ids } = buildRequest(world, DIRECTOR.maxBatch, { pilot: piloting });
    // Units beyond the batch cap are always handled locally.
    const extra = units.filter((u) => !ids.includes(u.id)).map((u) => u.id);
    if (extra.length) this.runFallback(units, world, extra, now);
    this.send(request, world);
  }

  private send(request: DecideRequest, world: WorldSnapshot) {
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    this.lastSentAt = this.clock();
    this.stats.status = 'waiting';
    this.stats.lastRequest = request;
    this.stats.lastBatch = Object.keys(request.questions).length;
    const timeout = setTimeout(() => ctrl.abort(), DIRECTOR.requestTimeoutMs);
    const waveAtSend = world.wave;

    this.decide(request, { mock: this.useMock, signal: ctrl.signal })
      .then((res) => {
        if (this.inFlight !== ctrl) return; // reset() while in flight
        const s = this.stats;
        s.calls++;
        s.status = 'ok';
        s.lastError = null;
        s.lastMode = res.mode;
        s.lastResponse = res;
        s.lastLatency = res.latencyMs;
        s.avgLatency = s.avgLatency ? s.avgLatency * 0.8 + res.latencyMs * 0.2 : res.latencyMs;
        const tok = res.usage?.input_tokens ?? 0;
        s.tokens += tok;
        if (res.mode === 'live') s.costUsd += (tok / 1e6) * DIRECTOR.pricePerMTok;
        this.backoff = 0;

        if (waveAtSend !== this.wave) {
          s.staleDropped += Object.keys(res.answers ?? {}).length;
          return;
        }
        const now = this.clock();
        const units = this.getUnits();
        const map = new Map(units.map((u) => [u.id, u]));
        const before = new Map(units.map((u) => [u.id, u.intent]));

        // Split off the player's answers; the rest belong to the squad.
        const { [PILOT_MOVE_Q]: pilotMove, [PILOT_TARGET_Q]: pilotTarget, ...squadAnswers } = res.answers ?? {};
        const source = res.mode === 'live' ? 'jev' : 'mock';
        if (this.pilot?.enabled && (pilotMove || pilotTarget)) {
          const alive = new Set(units.filter((u) => u.alive).map((u) => u.id));
          this.pilot.applyAnswers(pilotMove, pilotTarget, world, alive, now, DIRECTOR.confidenceGate, source);
        }

        const r = applyAnswers(
          { ...res, answers: squadAnswers },
          map,
          now,
          {
            gate: DIRECTOR.confidenceGate,
            minCommit: DIRECTOR.minCommit,
            switchMargin: DIRECTOR.switchMargin,
            maxShare: DIRECTOR.maxShare,
          },
          source,
        );
        s.jevDecisions += r.applied;
        s.staleDropped += r.stale;
        s.lowConfidence += r.lowConfidence.length;
        s.rebalanced += r.rebalanced;
        if (r.lowConfidence.length) this.runFallback(units.filter((u) => u.alive), world, r.lowConfidence, now);
        this.finishChanges(units, before, world);
      })
      .catch((err: unknown) => {
        if (this.inFlight !== ctrl) return;
        const s = this.stats;
        s.errors++;
        s.status = 'error';
        s.lastError = err instanceof Error ? err.message : String(err);
        this.backoff = Math.min(DIRECTOR.backoffMax, Math.max(DIRECTOR.backoffMin, this.backoff * 2));
        s.backoffUntil = this.clock() + this.backoff;
        const units = this.getUnits().filter((u) => u.alive);
        this.runFallback(units, world, units.map((u) => u.id), this.clock());
        if (this.pilot?.enabled) this.pilot.fallback(world, this.clock());
      })
      .finally(() => {
        clearTimeout(timeout);
        if (this.inFlight === ctrl) this.inFlight = null;
      });
  }

  private runFallback(units: readonly DirectedUnit[], world: WorldSnapshot, ids: readonly string[], now: number) {
    const p = world.player.pos;
    const ranked = [...units].sort((a, b) => dist(a.pos, p) - dist(b.pos, p));
    const squad = {
      alive: units.length,
      chasing: units.filter((u) => u.intent === 'chase').length,
      flanking: units.filter((u) => u.intent === 'flank').length,
      retreating: units.filter((u) => u.intent === 'retreat').length,
    };
    const before = new Map(units.map((u) => [u.id, u.intent]));
    const want = new Set(ids);
    for (const u of ranked) {
      if (!want.has(u.id)) continue;
      const next = fallbackDecide({
        type: u.type,
        hpFrac: u.hpFrac,
        current: u.intent,
        proximityRank: ranked.indexOf(u),
        squad,
      });
      if (next !== u.intent && now - u.intentSince < DIRECTOR.minCommit) continue;
      if (u.intent !== next) {
        squad[u.intent === 'chase' ? 'chasing' : u.intent === 'flank' ? 'flanking' : 'retreating']--;
        squad[next === 'chase' ? 'chasing' : next === 'flank' ? 'flanking' : 'retreating']++;
      }
      u.setIntent(next, 'fallback', now);
      this.stats.fallbackDecisions++;
    }
    this.finishChanges(units, before, world);
  }

  /** Assign flank sides for new flankers (spread across both sides) and emit change events. */
  private finishChanges(units: readonly DirectedUnit[], before: Map<string, Intent>, world: WorldSnapshot) {
    const { pos, facing } = world.player;
    const flankers = units.filter((u) => u.alive && u.intent === 'flank');
    let right = flankers.filter((u) => before.get(u.id) === 'flank' && u.flankSide === 1).length;
    let left = flankers.filter((u) => before.get(u.id) === 'flank' && u.flankSide === -1).length;
    for (const u of units) {
      if (!u.alive || before.get(u.id) === u.intent) continue;
      if (u.intent === 'flank') {
        let side = naturalSide(u.pos, pos, facing);
        if (side === 1 && right > left + 1) side = -1;
        else if (side === -1 && left > right + 1) side = 1;
        u.flankSide = side;
        if (side === 1) right++;
        else left++;
      }
      this.onChanged(u.id, u.intent);
    }
  }
}
