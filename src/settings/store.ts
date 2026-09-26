// A tiny registry of live-editable settings. Each field points at a property on one of the
// config objects (DIRECTOR, PLAYER, PROMPTS, ...). Editing writes straight into that object, so
// the game picks the change up on its next read, and only non-default values are persisted.

export type FieldKind = 'number' | 'text' | 'textarea' | 'bool';

export interface FieldDef {
  label: string;
  key: string;
  obj: object;
  kind?: FieldKind;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Shown as a hint when the change only applies later (e.g. "next run"). */
  applies?: string;
}

export interface Field extends Required<Pick<FieldDef, 'label' | 'key' | 'obj' | 'kind'>> {
  id: string;
  tab: string;
  group: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  applies?: string;
  default: unknown;
}

const STORAGE = 'jev-shooter.settings.v1';

class SettingsStore {
  readonly fields: Field[] = [];
  private listeners = new Set<() => void>();

  /** Register a group of fields. Defaults are captured now, so call before load(). */
  group(tab: string, group: string, defs: FieldDef[]) {
    for (const d of defs) {
      const value = (d.obj as Record<string, unknown>)[d.key];
      const kind = d.kind ?? (typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'number' : 'text');
      this.fields.push({
        ...d,
        kind,
        id: `${tab}/${group}/${d.key}`,
        tab,
        group,
        default: value,
      });
    }
  }

  get(f: Field): unknown {
    return (f.obj as Record<string, unknown>)[f.key];
  }

  set(f: Field, value: unknown) {
    (f.obj as Record<string, unknown>)[f.key] = value;
    this.save();
    this.emit();
  }

  isModified(f: Field) {
    return this.get(f) !== f.default;
  }

  reset(f: Field) {
    this.set(f, f.default);
  }

  resetTab(tab: string) {
    for (const f of this.fields) if (f.tab === tab) (f.obj as Record<string, unknown>)[f.key] = f.default;
    this.save();
    this.emit();
  }

  resetAll() {
    for (const f of this.fields) (f.obj as Record<string, unknown>)[f.key] = f.default;
    this.save();
    this.emit();
  }

  /** Non-default values only, keyed by field id. */
  overrides(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of this.fields) if (this.isModified(f)) out[f.id] = this.get(f);
    return out;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) this.apply(JSON.parse(raw));
    } catch {
      /* corrupt or blocked storage: keep defaults */
    }
  }

  /** Apply an overrides object (from storage or an imported file). Unknown ids are ignored. */
  apply(values: Record<string, unknown>) {
    for (const f of this.fields) {
      if (!(f.id in values)) continue;
      const v = values[f.id];
      if (typeof v === typeof f.default) (f.obj as Record<string, unknown>)[f.key] = v;
    }
    this.save();
    this.emit();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(this.overrides()));
    } catch {
      /* ignore */
    }
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export const settings = new SettingsStore();
