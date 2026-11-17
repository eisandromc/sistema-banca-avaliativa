import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv, type Client } from './helpers.ts';

/** Sinalizador de materiais: o cronograma informa o que cada grupo já cadastrou (resumo, orientadores, alunos, GitHub, artigo, apresentação, link). */
let env: TestEnv;
let admin: Client;
let ana: Client;

const PDF = Buffer.from('%PDF-1.4\n% fictício\n%%EOF\n', 'latin1');
const upload = (id: number, kind: string, name: string, data: Buffer) =>
  env.app.inject({
    method: 'PUT',
    url: `/api/groups/${id}/files/${kind}`,
    headers: { 'x-banca-csrf': '1', cookie: admin.cookie!, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
    payload: data,
  });
const entryOf = async (c: Client, code: string) => {
  const sched = (await c.get(`/api/days/${env.seed.dayId}/schedule`)).body;
  return sched.entries.find((e: any) => e.code === code);
};

beforeAll(async () => {
  env = await setupEnv();
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
});
afterAll(async () => env.close());

describe('materiais do grupo no cronograma', () => {
  it('grupo só com alunos: todo o resto aparece como faltando', async () => {
    const id = (await admin.post(`/api/events/${env.seed.eventId}/groups`, { code: 'MAT-01', title: 'Sem materiais (fictício)', students: ['Aluno A'] })).body.id;
    expect((await admin.post(`/api/groups/${id}/place`, { dayId: env.seed.dayId })).status).toBe(200);
    expect((await entryOf(admin, 'MAT-01')).materials).toEqual({
      summary: false,
      advisors: false,
      students: true,
      github: false,
      article: false,
      slides: false,
      viewLink: false,
    });
  });

  it('links, arquivo e resumo passam a contar; o arquivo na lixeira deixa de contar', async () => {
    const id = (
      await admin.post(`/api/events/${env.seed.eventId}/groups`, {
        code: 'MAT-02',
        title: 'Com materiais (fictício)',
        description: 'Resumo fictício.',
        advisors: ['Orientação Fictícia'],
        githubUrl: 'https://github.com/exemplo/projeto',
        slidesUrl: 'https://example.org/slides',
        projectUrl: 'https://example.org/app',
        students: ['Aluno B'],
      })
    ).body.id;
    await admin.post(`/api/groups/${id}/place`, { dayId: env.seed.dayId });
    expect((await entryOf(admin, 'MAT-02')).materials).toMatchObject({ summary: true, advisors: true, github: true, slides: true, viewLink: true, article: false });

    expect((await upload(id, 'article', 'artigo.pdf', PDF)).statusCode).toBe(200);
    expect((await entryOf(admin, 'MAT-02')).materials.article).toBe(true);
    expect((await admin.del(`/api/groups/${id}/files/article`)).status).toBe(200);
    expect((await entryOf(admin, 'MAT-02')).materials.article).toBe(false);
  });

  it('a área do professor recebe o mesmo resumo de materiais', async () => {
    const ws = (await ana.get(`/api/days/${env.seed.dayId}/workspace`)).body;
    expect(ws.entries.find((e: any) => e.code === 'MAT-02').materials).toMatchObject({ github: true, viewLink: true });
  });
});
