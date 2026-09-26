type TagOf<S extends string> = S extends `${infer T}.${string}` ? T : S;
type ElOf<S extends string> = TagOf<S> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagOf<S>] : HTMLElement;

/** Tiny DOM helper: h('div.cls.other', {attr}, ...children). */
export function h<S extends string>(
  tagAndClasses: S,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): ElOf<S> {
  const [tag, ...classes] = tagAndClasses.split('.');
  const el = document.createElement(tag) as ElOf<S>;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString('en-US'),
  ms: (n: number) => `${Math.round(n)} ms`,
  usd: (n: number) => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`),
  pct: (n: number) => `${Math.round(n * 100)}%`,
};
