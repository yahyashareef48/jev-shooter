import { INTENTS } from '../ai/types';
import type { ProxyStatus } from '../ai/jevClient';
import type { Game } from '../Game';
import { fmt, h } from './dom';

const TYPE_GLYPH = { drone: '◆', gunner: '■', brute: '⬢' } as const;

/**
 * Live view into the AI Director: mode, latency, tokens, cost and every enemy's
 * tactic probabilities as returned by the last batched Jev call.
 */
export class AiPanel {
  readonly root = h('aside.ai-panel');
  readonly badge = h('div.jev-badge');
  private stats = h('div.ai-stats');
  private spark = h('canvas.spark');
  private list = h('div.ai-list');
  private reqPre = h('pre');
  private resPre = h('pre');
  private open = true;
  private acc = 0;
  private latencies: number[] = [];
  private lastCalls = -1;

  constructor(
    private game: Game,
    private status: ProxyStatus,
  ) {
    const legend = h(
      'div.legend',
      {},
      ...INTENTS.map((i) => h(`span.legend-item.${i}`, {}, h('i'), i)),
    );
    this.spark.width = 300;
    this.spark.height = 36;
    this.root.append(
      h('div.ai-head', {}, h('div.ai-title', {}, 'AI DIRECTOR'), h('div.ai-sub', {}, 'one batched Jev call · whole squad')),
      this.stats,
      h('div.spark-wrap', {}, h('div.spark-label', {}, 'latency'), this.spark),
      legend,
      this.list,
      h('details.raw', {}, h('summary', {}, 'last request'), this.reqPre),
      h('details.raw', {}, h('summary', {}, 'last response'), this.resPre),
      h('div.ai-keys', {}, h('kbd', {}, 'Tab'), ' panel  ', h('kbd', {}, 'J'), ' live / mock'),
    );
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') this.toggle();
      if (e.code === 'KeyJ') this.toggleMock();
    });
  }

  toggle() {
    this.open = !this.open;
    this.root.classList.toggle('closed', !this.open);
  }

  private toggleMock() {
    const d = this.game.director;
    if (!this.status.hasKey) return; // no key: mock is the only option
    d.useMock = !d.useMock;
  }

  private modeLabel(): { text: string; cls: string } {
    const d = this.game.director;
    const s = d.stats;
    if (s.status === 'error' || s.status === 'disabled') return { text: 'FALLBACK', cls: 'fallback' };
    if (d.useMock) return { text: 'MOCK', cls: 'mock' };
    return { text: 'LIVE', cls: 'live' };
  }

  update(dt: number) {
    const g = this.game;
    const s = g.director.stats;
    const mode = this.modeLabel();
    const waiting = s.status === 'waiting';
    this.badge.className = `jev-badge ${mode.cls}${waiting ? ' waiting' : ''}`;
    this.badge.replaceChildren(
      h('i.dot'),
      h('span.b-name', {}, 'JEV'),
      h('span.b-mode', {}, mode.text),
      h('span.b-lat', {}, s.lastLatency ? fmt.ms(s.lastLatency) : '—'),
    );
    this.badge.title = s.lastError ?? '';
    this.root.classList.toggle('hidden', g.state === 'title');
    this.root.classList.toggle('interactive', g.state !== 'playing');

    if (s.calls !== this.lastCalls) {
      this.lastCalls = s.calls;
      if (s.lastLatency) this.latencies.push(s.lastLatency);
      if (this.latencies.length > 40) this.latencies.shift();
      this.drawSpark();
      this.reqPre.textContent = s.lastRequest ? JSON.stringify(s.lastRequest, null, 2).slice(0, 6000) : '—';
      this.resPre.textContent = s.lastResponse ? JSON.stringify(s.lastResponse, null, 2).slice(0, 6000) : '—';
    }

    this.acc += dt;
    if (!this.open || this.acc < 1 / 6) return;
    this.acc = 0;

    const cell = (label: string, value: string, cls = '') => h(`div.cell${cls ? '.' + cls : ''}`, {}, h('span', {}, label), h('b', {}, value));
    this.stats.replaceChildren(
      cell('mode', mode.text, mode.cls),
      cell('model', s.lastMode === 'mock' ? 'mock-jev' : this.status.model),
      cell('batch', `${s.lastBatch} q`),
      cell('latency', s.lastLatency ? `${fmt.ms(s.lastLatency)} · avg ${Math.round(s.avgLatency)}` : '—'),
      cell('calls', `${fmt.int(s.calls)}${s.errors ? ` · ${s.errors} err` : ''}`),
      cell('tokens', fmt.int(s.tokens)),
      cell('cost', fmt.usd(s.costUsd)),
      cell('decisions', `${fmt.int(s.jevDecisions)} jev · ${fmt.int(s.fallbackDecisions)} local`),
      cell('gated', `${s.lowConfidence} low-conf · ${s.rebalanced} rebalanced`),
    );
    if (s.lastError && s.status === 'error') this.stats.append(h('div.ai-error', {}, s.lastError));

    const p = g.player.pos;
    const rows = [...g.enemies]
      .sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p))
      .slice(0, 14)
      .map((e) => {
        const bar = h('div.pbar');
        for (const i of INTENTS) {
          const v = e.probs?.[i] ?? (e.source === 'fallback' && e.intent === i ? 1 : 0);
          const seg = h(`i.${i}`);
          seg.style.width = `${v * 100}%`;
          bar.append(seg);
        }
        return h(
          `div.row.${e.intent}`,
          {},
          h('span.r-id', {}, `${TYPE_GLYPH[e.type]} ${e.id}`),
          h(`span.chip.${e.intent}`, {}, e.intent),
          bar,
          h('span.r-conf', {}, e.confidence != null ? fmt.pct(e.confidence) : '—'),
          h(`span.src.${e.source}`, {}, e.source === 'fallback' ? 'local' : e.source),
        );
      });
    const more = g.enemies.length - rows.length;
    this.list.replaceChildren(...rows, ...(more > 0 ? [h('div.more', {}, `+${more} more`)] : []));
    if (!g.enemies.length) this.list.append(h('div.more', {}, 'no hostiles'));
  }

  private drawSpark() {
    const c = this.spark.getContext('2d')!;
    const { width: w, height: hgt } = this.spark;
    c.clearRect(0, 0, w, hgt);
    const data = this.latencies;
    if (data.length < 2) return;
    const max = Math.max(800, ...data);
    c.strokeStyle = '#33e1ff';
    c.lineWidth = 1.5;
    c.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * (w - 2) + 1;
      const y = hgt - 2 - (v / max) * (hgt - 4);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();
  }
}

