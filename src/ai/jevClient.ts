// Browser side of the Jev bridge: talks only to our own proxy (server/jevProxy.ts).

import { session } from '../settings/session';
import type { DecideFn } from './director';
import type { DecideResponse } from './types';

export const decideViaProxy: DecideFn = async (request, { mock, signal }) => {
  const res = await fetch('/api/decide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The player's own key/model from the settings panel (local proxy only).
      ...(session.apiKey ? { 'X-Jev-Key': session.apiKey } : {}),
      ...(session.model ? { 'X-Jev-Model': session.model } : {}),
    },
    body: JSON.stringify({ mock, request }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as (DecideResponse & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
};

export interface ProxyStatus {
  hasKey: boolean;
  model: string;
  reachable: boolean;
}

export async function fetchStatus(): Promise<ProxyStatus> {
  try {
    const res = await fetch('/api/status');
    const s = (await res.json()) as { hasKey: boolean; model: string };
    return { ...s, reachable: true };
  } catch {
    return { hasKey: false, model: 'n/a', reachable: false };
  }
}
