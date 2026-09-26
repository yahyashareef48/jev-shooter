import { decideViaProxy } from '../ai/jevClient';
import { buildRequest } from '../ai/stateBuilder';
import { DIRECTOR } from '../core/config';
import type { Game } from '../Game';
import { TABS, type Tab } from '../settings/schema';
import { session } from '../settings/session';
import { settings, type Field } from '../settings/store';
import { h, isTyping } from './dom';

/**
 * In-game settings drawer: the player's own Jev key, live/mock, every tunable number,
 * the exact question text and answer options, and which state fields Jev sees.
 */
export class SettingsPanel {
  readonly root = h('aside.settings');
  private body = h('div.s-body');
  private tabBar = h('nav.s-tabs');
  private tab: Tab = 'Jev';
  private isOpen = false;
  private testLine = h('div.s-test');
  private preview = h('pre.s-preview');

  constructor(private game: Game) {
    const close = h('button.s-close', { title: 'Close (O)' }, '×');
    close.addEventListener('click', () => this.close());

    const resetTab = h('button.s-btn', {}, 'Reset tab');
    resetTab.addEventListener('click', () => {
      settings.resetTab(this.tab);
      this.render();
    });
    const resetAll = h('button.s-btn', {}, 'Reset all');
    resetAll.addEventListener('click', () => {
      if (confirm('Reset every setting to its default? (Your API key is kept.)')) {
        settings.resetAll();
        this.render();
      }
    });
    const exportBtn = h('button.s-btn', {}, 'Export');
    exportBtn.addEventListener('click', () => this.exportJson());
    const importInput = h('input', { type: 'file', accept: 'application/json', hidden: '' });
    importInput.addEventListener('change', () => this.importJson(importInput));
    const importBtn = h('button.s-btn', {}, 'Import');
    importBtn.addEventListener('click', () => importInput.click());

    for (const t of TABS) {
      const b = h('button.s-tab', {}, t);
      b.addEventListener('click', () => {
        this.tab = t;
        this.render();
      });
      this.tabBar.append(b);
    }

    this.root.append(
      h('header.s-head', {}, h('div.s-title', {}, 'SETTINGS'), h('div.s-sub', {}, 'changes apply live · saved in this browser'), close),
      this.tabBar,
      this.body,
      h('footer.s-foot', {}, resetTab, resetAll, exportBtn, importBtn, importInput),
    );

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.code === 'KeyO') this.toggle();
    });
    // Keep game hotkeys and clicks from leaking out of the drawer.
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  get opened() {
    return this.isOpen;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(tab?: Tab) {
    if (tab) this.tab = tab;
    this.isOpen = true;
    this.root.classList.add('open');
    this.game.input.unlock(); // manual play pauses; a Jev-piloted run keeps going so you can tweak live
    this.render();
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('open');
  }

  private render() {
    for (const b of this.tabBar.children) b.classList.toggle('active', b.textContent === this.tab);
    this.body.replaceChildren();
    if (this.tab === 'Jev') this.body.append(this.keySection());
    if (this.tab === 'State') this.body.append(this.previewSection());

    const groups = new Map<string, Field[]>();
    for (const f of settings.fields) {
      if (f.tab !== this.tab) continue;
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group)!.push(f);
    }
    for (const [name, fields] of groups) {
      const reset = h('button.s-link', {}, 'reset');
      reset.addEventListener('click', () => {
        fields.forEach((f) => settings.reset(f));
        this.render();
      });
      const sec = h('section.s-group', {}, h('div.s-group-head', {}, h('h3', {}, name), reset));
      for (const f of fields) sec.append(this.row(f));
      this.body.append(sec);
    }
  }

  private row(f: Field): HTMLElement {
    const row = h(`div.s-row.k-${f.kind}`);
    const reset = h('button.s-reset', { title: `Reset to ${String(f.default).slice(0, 60)}` }, '↺');
    const mark = () => row.classList.toggle('modified', settings.isModified(f));
    let sync = () => {};
    reset.addEventListener('click', () => {
      settings.reset(f);
      sync();
      mark();
    });

    const label = h('label.s-label', {}, f.label, ...(f.applies ? [h('span.s-applies', {}, f.applies)] : []));
    if (f.kind === 'bool') {
      const cb = h('input', { type: 'checkbox' });
      sync = () => (cb.checked = settings.get(f) as boolean);
      cb.addEventListener('change', () => {
        settings.set(f, cb.checked);
        mark();
      });
      row.append(h('label.s-check', {}, cb, h('span', {}, f.label)), reset);
    } else if (f.kind === 'number') {
      const range = h('input', { type: 'range', min: String(f.min ?? 0), max: String(f.max ?? 100), step: String(f.step ?? 1) });
      const num = h('input.s-num', { type: 'number', step: String(f.step ?? 1) });
      sync = () => {
        const v = String(settings.get(f));
        range.value = v;
        num.value = v;
      };
      const commit = (raw: string) => {
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        settings.set(f, v);
        mark();
      };
      range.addEventListener('input', () => {
        num.value = range.value;
        commit(range.value);
      });
      num.addEventListener('change', () => {
        range.value = num.value;
        commit(num.value);
      });
      row.append(label, h('div.s-numrow', {}, range, num, reset));
    } else {
      const input = f.kind === 'textarea' ? h('textarea', { rows: '3', spellcheck: 'false' }) : h('input', { type: 'text' });
      sync = () => (input.value = String(settings.get(f)));
      input.addEventListener('input', () => {
        settings.set(f, input.value);
        mark();
      });
      row.append(h('div.s-labelrow', {}, label, reset), input);
    }
    if (f.help) row.append(h('div.s-help', {}, f.help));
    sync();
    mark();
    return row;
  }

  // ---------- Jev key / model / mode ----------
  private keySection(): HTMLElement {
    const d = this.game.director;
    const key = h('input.s-key', { type: 'password', placeholder: session.envKey ? 'using JEV_API_KEY from .env' : 'paste your TypeSafe API key', autocomplete: 'off', spellcheck: 'false' });
    key.value = session.apiKey;
    const show = h('button.s-btn.small', {}, 'show');
    show.addEventListener('click', () => {
      key.type = key.type === 'password' ? 'text' : 'password';
      show.textContent = key.type === 'password' ? 'show' : 'hide';
    });
    key.addEventListener('change', () => {
      const had = session.hasKey();
      session.apiKey = key.value;
      if (!had && session.hasKey()) d.useMock = false; // new key → go live
      this.render();
    });

    const model = h('input', { type: 'text', placeholder: session.envModel });
    model.value = session.model;
    model.addEventListener('change', () => (session.model = model.value));

    const live = h('button.s-seg', {}, 'Live');
    const mock = h('button.s-seg', {}, 'Mock');
    const paint = () => {
      live.classList.toggle('active', !d.useMock);
      mock.classList.toggle('active', d.useMock);
    };
    live.addEventListener('click', () => ((d.useMock = false), paint()));
    mock.addEventListener('click', () => ((d.useMock = true), paint()));
    paint();

    const test = h('button.s-btn', {}, 'Test connection');
    test.addEventListener('click', () => this.testConnection());

    const source = session.apiKey ? 'key from this browser' : session.envKey ? 'key from .env' : 'no key: live calls fall back to mock';
    return h(
      'section.s-group.s-key-group',
      {},
      h('div.s-group-head', {}, h('h3', {}, 'Your Jev key')),
      h('div.s-row', {}, h('label.s-label', {}, 'TypeSafe API key'), h('div.s-numrow', {}, key, show)),
      h('div.s-help', {}, 'Get one at typesafe.ai. Stored only in this browser and sent only to your local dev server, which forwards it to TypeSafe.'),
      h('div.s-row', {}, h('label.s-label', {}, 'Model'), model),
      h('div.s-row', {}, h('label.s-label', {}, 'Mode ', h('kbd', {}, 'J')), h('div.s-segs', {}, live, mock)),
      h('div.s-status', {}, source, session.proxyReachable ? '' : ' · local proxy not reachable (run npm run dev)'),
      h('div.s-row', {}, test, this.testLine),
    );
  }

  private async testConnection() {
    this.testLine.textContent = 'testing…';
    this.testLine.className = 's-test';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await decideViaProxy(
        {
          state: { note: 'connection test' },
          questions: { ping: { type: 'choice', instructions: 'Is this a connection test?', criteria: { yes: 'yes', no: 'no' } } },
        },
        { mock: false, signal: ctrl.signal },
      );
      const ok = res.mode === 'live';
      this.testLine.textContent = ok ? `✓ live · ${res.model ?? ''} · ${res.latencyMs} ms` : 'no key found: the proxy answered with mock';
      this.testLine.classList.add(ok ? 'ok' : 'warn');
    } catch (e) {
      this.testLine.textContent = `✗ ${(e as Error).message}`;
      this.testLine.classList.add('err');
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- State preview ----------
  private previewSection(): HTMLElement {
    const btn = h('button.s-btn', {}, 'Preview next request');
    const meta = h('div.s-help');
    btn.addEventListener('click', () => {
      const g = this.game;
      if (!g.enemies.length) {
        this.preview.textContent = 'Start a run (and wait for a wave) to preview a real request.';
        meta.textContent = '';
        return;
      }
      const { request } = buildRequest(g.snapshot(), DIRECTOR.maxBatch, { pilot: g.pilot.enabled });
      const json = JSON.stringify(request, null, 2);
      this.preview.textContent = json;
      meta.textContent = `${Object.keys(request.questions).length} questions · ~${Math.round(JSON.stringify(request).length / 4)} tokens (rough estimate)`;
    });
    return h(
      'section.s-group',
      {},
      h('div.s-group-head', {}, h('h3', {}, 'What Jev sees')),
      h('div.s-help', {}, 'Toggle fields below, then preview the exact JSON the next batched call will send.'),
      btn,
      meta,
      this.preview,
    );
  }

  // ---------- export / import ----------
  private exportJson() {
    const blob = new Blob([JSON.stringify(settings.overrides(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'jev-shooter-settings.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importJson(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      settings.apply(JSON.parse(await file.text()));
      this.render();
    } catch (e) {
      alert(`Could not import settings: ${(e as Error).message}`);
    }
  }
}
