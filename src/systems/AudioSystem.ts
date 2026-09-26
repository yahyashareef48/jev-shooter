import type { Events } from '../core/Events';
import { isTyping } from '../ui/dom';

/** Every sound is synthesised with WebAudio: no audio assets to load or license. */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private lastShot = 0;
  private lastEnemyShot = 0;
  private lastHit = 0;

  constructor(events: Events, private listener: () => { x: number; z: number }) {
    const unlock = () => this.init();
    addEventListener('mousedown', unlock);
    addEventListener('keydown', (e) => {
      unlock();
      if (!isTyping(e) && e.code === 'KeyM') this.toggleMute();
    });

    events.on('shot', () => this.shot());
    events.on('enemyShot', (p) => this.enemyShot(p.x, p.z));
    events.on('enemyHit', (p) => this.hit(p.shielded));
    events.on('enemyKilled', (p) => this.explode(p.big));
    events.on('playerHit', () => this.hurt());
    events.on('dash', () => this.whoosh());
    events.on('overheat', () => this.overheat());
    events.on('flanked', () => this.alert());
    events.on('pickup', () => this.arp([660, 880, 1320], 'sine', 0.07, 0.12));
    events.on('waveStart', () => this.arp([220, 277, 330, 440], 'sawtooth', 0.09, 0.07));
    events.on('waveCleared', () => this.arp([440, 554, 659, 880], 'triangle', 0.08, 0.1));
    events.on('gameOver', () => this.arp([330, 262, 196, 131], 'sawtooth', 0.18, 0.12));
  }

  get isMuted() {
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  private init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.drone();
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode = this.master, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, peak, 0.005, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q = 1) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    src.connect(bq).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private shot() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.05) return;
    this.lastShot = now;
    this.tone('square', 1400, 260, 0.07, 0.05);
    this.noiseBurst(0.05, 0.05, 'highpass', 3000, 6000);
  }

  private enemyShot(x: number, z: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastEnemyShot < 0.06) return;
    this.lastEnemyShot = now;
    const p = this.listener();
    const vol = Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / 55);
    if (vol > 0.02) this.tone('sawtooth', 520, 140, 0.13, 0.05 * vol);
  }

  private hit(shielded: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.03) return;
    this.lastHit = now;
    if (shielded) this.tone('triangle', 2200, 1800, 0.06, 0.05);
    else this.tone('sine', 1500, 900, 0.05, 0.06);
  }

  private explode(big: boolean) {
    if (!this.ctx) return;
    this.noiseBurst(big ? 0.8 : 0.45, big ? 0.5 : 0.3, 'lowpass', 2400, 120);
    this.tone('sine', big ? 110 : 150, 35, big ? 0.6 : 0.35, big ? 0.6 : 0.4);
  }

  private hurt() {
    if (!this.ctx) return;
    this.tone('sawtooth', 180, 60, 0.22, 0.18);
    this.noiseBurst(0.15, 0.12, 'bandpass', 900, 300, 2);
  }

  private whoosh() {
    if (!this.ctx) return;
    this.noiseBurst(0.28, 0.2, 'bandpass', 300, 2600, 3);
  }

  private overheat() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) this.tone('square', 220, 200, 0.08, 0.05, this.master, i * 0.1);
  }

  private alert() {
    if (!this.ctx) return;
    [880, 660, 880, 660].forEach((f, i) => this.tone('triangle', f, f, 0.09, 0.09, this.master, i * 0.1));
  }

  private arp(freqs: number[], type: OscillatorType, step: number, peak: number) {
    if (!this.ctx) return;
    freqs.forEach((f, i) => this.tone(type, f, f * 0.99, 0.25, peak, this.master, i * step));
  }

  /** Low detuned ambient bed with a slow filter sweep. */
  private drone() {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    lp.connect(g).connect(this.master);
    for (const f of [55, 55.4, 82.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
  }
}
