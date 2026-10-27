import { inflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { createPgliteDatabase, type Database, type Queryable } from '../src/db/database.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { seedDemo, DEMO_PASSWORD } from '../src/db/seed.ts';

export const DEMO_DATE = '2026-10-20';

export interface TestEnv {
  app: FastifyInstance;
  db: Database;
  clock: { now: () => number; advance: (ms: number) => void };
  seed: Omit<Awaited<ReturnType<typeof seedDemo>> & { skipped: false }, 'rubrics'> & { rubrics: { tecnica: number; comunicacao: number } };
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
  const config = loadConfig({ ambiente: 'TESTE', timerSpeed: 1, webDist: null, cookieSecure: false, countdownSeconds: opts.countdownSeconds ?? 0 });
  const app = await buildApp(config, { db, logger: false, ticker: false, now: clock.now });
  const demo = await seedDemo(db, { date: DEMO_DATE });
  if (demo.skipped) throw new Error('banco de teste já tinha dados');
  const seed: TestEnv['seed'] = { ...demo, ...(await db.tx((q) => installExampleRubrics(q, demo.eventId, demo.dayId, demo.users))) };
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

export const EXAMPLE_RUBRIC_TYPE = 'Técnica + Comunicação (exemplo)';

/**
 * A demonstração usa as fichas do Projeto Integrador (pesos iguais, 0 a 5, todos obrigatórios). Os testes trocam a banca
 * para duas rubricas de exemplo, com pesos diferentes, escala 0–10 em meios pontos e critério opcional, para exercitar o cálculo.
 */
async function installExampleRubrics(q: Queryable, eventId: number, dayId: number, users: Record<string, number>) {
  const typeId = (await q.one<{ id: number }>('insert into rubric_types (name, description) values ($1, $2) returning id', [
    EXAMPLE_RUBRIC_TYPE,
    'Duas fichas: avaliação técnica e avaliação da comunicação. Rubricas fictícias de teste.',
  ]))!.id;
  await q.query('update events set rubric_type_id = $2 where id = $1', [eventId, typeId]);
  let position = 0;
  const rubric = async (name: string, title: string, criteria: Array<[string, string, number, boolean, boolean]>) => {
    const t = await q.one<{ id: number }>('insert into rubric_templates (name, description, type_id, type_position) values ($1, $2, $3, $4) returning id', [
      name,
      'Rubrica exemplificativa de teste.',
      typeId,
      ++position,
    ]);
    const v = await q.one<{ id: number }>(
      `insert into rubric_versions (template_id, version, title, instructions, scale_min, scale_max, scale_step)
       values ($1, 1, $2, 'Atribua notas de 0 a 10 (incrementos de 0,5). Zero é uma nota válida; deixe em branco apenas o que não avaliou.', 0, 10, 0.5) returning id`,
      [t!.id, title],
    );
    let i = 0;
    for (const [ct, cd, w, req, comment] of criteria) {
      await q.query(
        'insert into rubric_criteria (version_id, position, title, description, weight, required, comment_enabled) values ($1,$2,$3,$4,$5,$6,$7)',
        [v!.id, i++, ct, cd, w, req, comment],
      );
    }
    return v!.id;
  };
  const tecnica = await rubric('Rubrica Técnica (exemplo)', 'Avaliação técnica', [
    ['Domínio técnico', 'Conhecimento dos conceitos e das escolhas técnicas.', 3, true, true],
    ['Funcionamento da demonstração', 'O protótipo funciona como descrito.', 3, true, true],
    ['Organização do projeto', 'Planejamento, documentação e divisão de tarefas.', 2, true, false],
    ['Respostas às perguntas', 'Clareza e segurança nas respostas à banca.', 2, true, false],
  ]);
  const comunicacao = await rubric('Rubrica de Comunicação (exemplo)', 'Avaliação de comunicação', [
    ['Clareza da apresentação', 'Sequência lógica e linguagem adequada.', 2, true, true],
    ['Uso do tempo', 'Respeito às etapas e ao tempo total.', 1, true, false],
    ['Material visual', 'Slides/cartazes legíveis e pertinentes (opcional).', 1, false, false],
  ]);
  // Ana e Bruno com a 1ª ficha (técnica), Carla com a 2ª (comunicação).
  await q.query('delete from evaluator_assignments where day_id = $1', [dayId]);
  await q.query('insert into evaluator_assignments (day_id, user_id, rubric_position) values ($1,$2,1),($1,$3,1),($1,$4,2)', [dayId, users.ana, users.bruno, users.carla]);
  return { rubricTypeId: typeId, rubrics: { tecnica, comunicacao } };
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
