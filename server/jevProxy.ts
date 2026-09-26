// Vite dev-server middleware that keeps the TypeSafe key server-side.
//   GET  /api/status  -> { hasKey, model }
//   POST /api/decide  -> { answers, usage, model, latencyMs, mode }
// The browser never sees JEV_API_KEY; it only ever talks to this proxy.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { mockDecide } from './mockJev.ts';

export interface JevProxyOptions {
  apiKey?: string;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
}

const MAX_BODY = 256 * 1024;
const MAX_QUESTIONS = 64;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Returns an error message, or null if the body is a well-formed batch of choice questions. */
export function validate(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const { request } = body as { request?: { state?: unknown; questions?: unknown } };
  if (!request || typeof request !== 'object') return 'missing request';
  if (request.state === undefined) return 'missing request.state';
  const q = request.questions;
  if (!q || typeof q !== 'object' || Array.isArray(q)) return 'request.questions must be an object';
  const entries = Object.entries(q as Record<string, unknown>);
  if (!entries.length) return 'no questions';
  if (entries.length > MAX_QUESTIONS) return `too many questions (max ${MAX_QUESTIONS})`;
  for (const [id, v] of entries) {
    const qq = v as { type?: unknown; instructions?: unknown; criteria?: unknown };
    if (qq?.type !== 'choice') return `question ${id}: only choice questions are allowed`;
    if (typeof qq.instructions !== 'string') return `question ${id}: instructions must be a string`;
    if (!qq.criteria || typeof qq.criteria !== 'object') return `question ${id}: criteria required`;
  }
  return null;
}

/** One line per decision batch, e.g. `[jev] live 14q 402ms 200 · chase 6 flank 7 retreat 1`. */
function logBatch(mode: string, questions: number, status: number, ms: number, answers?: unknown, err?: string) {
  const tally: Record<string, number> = {};
  for (const a of Object.values((answers ?? {}) as Record<string, { choice?: string }>)) {
    if (a?.choice) tally[a.choice] = (tally[a.choice] ?? 0) + 1;
  }
  const picks = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' ');
  console.log(`[jev] ${mode} ${questions}q ${ms}ms ${status}${picks ? ` · ${picks}` : ''}${err ? ` · ${err}` : ''}`);
}

export function jevProxy(opts: JevProxyOptions): Plugin {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const hasKey = !!opts.apiKey?.trim();

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0];
    if (url === '/api/status' && req.method === 'GET') {
      return send(res, 200, { hasKey, model: opts.model });
    }
    if (url !== '/api/decide') return next();
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

    // A key/model set in the in-game settings arrives per request and wins over .env.
    // This server only ever runs on the player's own machine (npm run dev / preview).
    const headerKey = String(req.headers['x-jev-key'] ?? '').trim();
    const apiKey = headerKey || opts.apiKey?.trim() || '';
    const model = String(req.headers['x-jev-model'] ?? '').trim() || opts.model;

    let body: { mock?: boolean; request: { state: unknown; questions: Record<string, unknown> } };
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : 'bad json' });
    }
    const invalid = validate(body);
    if (invalid) return send(res, 422, { error: invalid });

    const started = Date.now();
    if (body.mock || !apiKey) {
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
      const mock = mockDecide(body.request);
      logBatch('mock', Object.keys(body.request.questions).length, 200, Date.now() - started, mock.answers);
      return send(res, 200, { ...mock, latencyMs: Date.now() - started, mode: 'mock' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const upstream = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/v1/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state: body.request.state, questions: body.request.questions }),
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      const nq = Object.keys(body.request.questions).length;
      if (!upstream.ok) {
        logBatch('live', nq, upstream.status, Date.now() - started, undefined, text.slice(0, 160));
        return send(res, upstream.status, { error: `Jev ${upstream.status}: ${text.slice(0, 300)}` });
      }
      const data = JSON.parse(text) as { answers?: unknown; usage?: unknown; model?: string };
      logBatch('live', nq, 200, Date.now() - started, data.answers);
      return send(res, 200, {
        answers: data.answers ?? {},
        usage: data.usage,
        model: data.model ?? model,
        latencyMs: Date.now() - started,
        mode: 'live',
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      logBatch('live', Object.keys(body.request.questions).length, aborted ? 504 : 502, Date.now() - started, undefined, (e as Error).message);
      return send(res, aborted ? 504 : 502, { error: aborted ? 'Jev timed out' : `proxy error: ${(e as Error).message}` });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    name: 'jev-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
