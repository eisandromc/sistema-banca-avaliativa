import { inflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { createPgliteDatabase, type Database } from '../src/db/database.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { seedDemo, DEMO_PASSWORD } from '../src/db/seed.ts';

export const DEMO_DATE = '2026-10-20';

export interface TestEnv {
  app: FastifyInstance;
  db: Database;
  clock: { now: () => number; advance: (ms: number) => void };
  seed: Awaited<ReturnType<typeof seedDemo>> & { skipped: false };
  login: (email: string, password?: string) => Promise<Client>;
  anon: Client;
  close: () => Promise<void>;
}

export interface Res<T = any> {
  status: number;
  body: T;
  raw: Buffer;
  headers: Record<string, any>;
}

export interface Client {
  cookie: string | null;
  get<T = any>(url: string): Promise<Res<T>>;
  post<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  put<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  patch<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  del<T = any>(url: string): Promise<Res<T>>;
}

function makeClient(app: FastifyInstance, cookie: string | null): Client {
  const call = async (method: string, url: string, body?: unknown): Promise<Res> => {
    const r = await app.inject({
      method: method as any,
      url,
      headers: { 'x-banca-csrf': '1', ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: any = null;
    try {
      parsed = r.json();
    } catch {
      parsed = null;
    }
    return { status: r.statusCode, body: parsed, raw: r.rawPayload, headers: r.headers };
  };
  return {
    cookie,
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    put: (u, b) => call('PUT', u, b ?? {}),
    patch: (u, b) => call('PATCH', u, b ?? {}),
    del: (u) => call('DELETE', u),
  };
}

export async function setupEnv(opts: { db?: Database; seed?: boolean; startAt?: number; countdownSeconds?: number } = {}): Promise<TestEnv> {
  const db = opts.db ?? (await createPgliteDatabase(null));
  let now = opts.startAt ?? Date.parse(`${DEMO_DATE}T10:30:00Z`);
  const clock = { now: () => now, advance: (ms: number) => void (now += ms) };
  const config = loadConfig({ env: 'test', timerSpeed: 1, webDist: null, cookieSecure: false, countdownSeconds: opts.countdownSeconds ?? 0 });
  const app = await buildApp(config, { db, logger: false, ticker: false, now: clock.now });
  const seed = (await seedDemo(db, { date: DEMO_DATE })) as TestEnv['seed'];
  const login = async (email: string, password = DEMO_PASSWORD) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-banca-csrf': '1', 'content-type': 'application/json' },
      payload: JSON.stringify({ email, password }),
    });
    if (r.statusCode !== 200) throw new Error(`login falhou para ${email}: ${r.statusCode} ${r.body}`);
    const c = r.cookies[0]!;
    return makeClient(app, `${c.name}=${c.value}`);
  };
  return {
    app,
    db,
    clock,
    seed,
    login,
    anon: makeClient(app, null),
    close: async () => {
      await app.close();
      if (!opts.db) await db.close();
    },
  };
}

/** Extrai o texto de um PDF gerado pelo pdfkit (fontes padrão, operadores TJ com strings hex). */
export function pdfText(buf: Buffer): string {
  const src = buf.toString('latin1');
  const out: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(src))) {
    let content = m[1]!;
    const bytes = Buffer.from(content, 'latin1');
    try {
      content = inflateSync(bytes).toString('latin1');
    } catch {
      /* não comprimido */
    }
    const tjRe = /\[(.*?)\]\s*TJ/g;
    let t: RegExpExecArray | null;
    while ((t = tjRe.exec(content))) {
      const hexes = [...t[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'));
      out.push(hexes.join(''));
    }
  }
  return out.join('\n');
}
