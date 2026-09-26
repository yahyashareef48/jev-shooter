// The player's own Jev credentials. Stored only in this browser (localStorage) and sent only to
// the local dev-server proxy, which forwards them to TypeSafe. Nothing is ever committed.

const KEY = 'jev-shooter.apiKey';
const MODEL = 'jev-shooter.model';

function read(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}

function write(k: string, v: string) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* storage blocked: the value just won't persist */
  }
}

export const session = {
  /** The proxy has JEV_API_KEY in .env. */
  envKey: false,
  envModel: 'jev-latest',
  proxyReachable: true,

  get apiKey() {
    return read(KEY);
  },
  set apiKey(v: string) {
    write(KEY, v.trim());
  },
  get model() {
    return read(MODEL);
  },
  set model(v: string) {
    write(MODEL, v.trim());
  },

  hasKey() {
    return !!this.apiKey || this.envKey;
  },
  effectiveModel() {
    return this.model || this.envModel;
  },
};
