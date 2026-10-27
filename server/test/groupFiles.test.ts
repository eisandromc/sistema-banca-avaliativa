import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv, type Client } from './helpers.ts';
import { isGithubLink } from '../../shared/groups.ts';

/** Materiais do grupo: arquivos enviados (slides e artigo) e link do GitHub. */
let env: TestEnv;
let admin: Client;
let ana: Client;
let groupId: number;

const PDF = Buffer.from('%PDF-1.4\n% fictício\n%%EOF\n', 'latin1');
const PPTX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('conteúdo fictício')]);

const upload = (c: Client, id: number, kind: string, name: string, data: Buffer) =>
  env.app.inject({
    method: 'PUT',
    url: `/api/groups/${id}/files/${kind}`,
    headers: { 'x-banca-csrf': '1', cookie: c.cookie!, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
    payload: data,
  });

const groupOf = async () => (await admin.get(`/api/events/${env.seed.eventId}/groups`)).body.groups.find((g: any) => g.id === groupId);

beforeAll(async () => {
  env = await setupEnv();
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
  const r = await admin.post(`/api/events/${env.seed.eventId}/groups`, {
    code: 'F-01',
    title: 'Projeto com arquivos (fictício)',
    students: ['Estudante Fictício F'],
    githubUrl: 'https://github.com/exemplo/projeto-ficticio',
  });
  expect(r.status).toBe(200);
  groupId = r.body.id;
});
afterAll(async () => env.close());

describe('link do GitHub', () => {
  it('aceita só endereços do github.com', async () => {
    expect(isGithubLink('https://github.com/a/b')).toBe(true);
    expect(isGithubLink('https://www.github.com/a')).toBe(true);
    expect(isGithubLink('https://gitlab.com/a/b')).toBe(false);
    expect(isGithubLink('https://github.com.malicioso.site/a')).toBe(false);
    expect((await groupOf()).githubUrl).toBe('https://github.com/exemplo/projeto-ficticio');
    const g = await groupOf();
    const r = await admin.put(`/api/groups/${groupId}`, { code: g.code, title: g.title, students: g.students, githubUrl: 'https://gitlab.com/x/y' });
    expect(r.status).toBe(400);
  });
});

describe('arquivos do grupo', () => {
  it('envia slides (PPTX) e artigo (PDF), com nome acentuado', async () => {
    expect((await upload(admin, groupId, 'slides', 'Apresentação final.pptx', PPTX)).statusCode).toBe(200);
    const r = await upload(admin, groupId, 'article', 'Artigo — versão 2.pdf', PDF);
    expect(r.statusCode).toBe(200);
    expect(r.json().file).toMatchObject({ kind: 'article', name: 'Artigo — versão 2.pdf', mime: 'application/pdf', size: PDF.length });
    const g = await groupOf();
    expect(g.slidesFile).toMatchObject({ name: 'Apresentação final.pptx', size: PPTX.length });
    expect(g.articleFile.url).toMatch(new RegExp(`^/api/groups/${groupId}/files/article\\?v=\\d+$`));
  });

  it('recusa tipo errado, conteúdo falso, vazio e quem não é administrador', async () => {
    expect((await upload(admin, groupId, 'slides', 'trabalho.docx', PPTX)).statusCode).toBe(400);
    expect((await upload(admin, groupId, 'article', 'falso.pdf', Buffer.from('<html>não é pdf</html>'))).statusCode).toBe(400);
    expect((await upload(admin, groupId, 'article', 'vazio.pdf', Buffer.alloc(0))).statusCode).toBe(400);
    expect((await upload(admin, groupId, 'outro', 'a.pdf', PDF)).statusCode).toBe(400);
    expect((await upload(ana, groupId, 'article', 'a.pdf', PDF)).statusCode).toBe(403);
  });

  it('download: PDF abre na página, PPTX é baixado; conteúdo idêntico ao enviado', async () => {
    const pdf = await admin.get(`/api/groups/${groupId}/files/article`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(String(pdf.headers['content-disposition'])).toMatch(/^inline;.*filename\*=UTF-8''Artigo%20%E2%80%94%20vers%C3%A3o%202\.pdf$/);
    expect(Buffer.compare(pdf.raw, PDF)).toBe(0);
    expect(String((await admin.get(`/api/groups/${groupId}/files/article?download=1`)).headers['content-disposition'])).toMatch(/^attachment;/);
    const pptx = await admin.get(`/api/groups/${groupId}/files/slides`);
    expect(String(pptx.headers['content-disposition'])).toMatch(/^attachment;/);
    expect(Buffer.compare(pptx.raw, PPTX)).toBe(0);
  });

  it('professores só acessam quando o grupo está no dia em que atuam', async () => {
    expect((await ana.get(`/api/groups/${groupId}/files/article`)).status).toBe(403);
    expect((await admin.post(`/api/groups/${groupId}/place`, { dayId: env.seed.dayId })).status).toBe(200);
    expect((await ana.get(`/api/groups/${groupId}/files/article`)).status).toBe(200);
    const p = (await ana.get(`/api/groups/${groupId}/project`)).body;
    expect(p.githubUrl).toBe('https://github.com/exemplo/projeto-ficticio');
    expect(p.slidesFile.name).toBe('Apresentação final.pptx');
    expect(p.articleFile.mime).toBe('application/pdf');
  });

  it('troca e remoção do arquivo', async () => {
    const novo = Buffer.concat([PDF, Buffer.from('% nova versão')]);
    expect((await upload(admin, groupId, 'slides', 'slides.pdf', novo)).statusCode).toBe(200);
    expect((await groupOf()).slidesFile).toMatchObject({ name: 'slides.pdf', mime: 'application/pdf', size: novo.length });
    expect((await admin.del(`/api/groups/${groupId}/files/slides`)).status).toBe(200);
    expect((await groupOf()).slidesFile).toBeNull();
    expect((await admin.get(`/api/groups/${groupId}/files/slides`)).status).toBe(404);
  });

  it('excluir o grupo manda para a lixeira e esconde os arquivos até restaurar', async () => {
    await admin.post(`/api/groups/${groupId}/place`, { dayId: null });
    await upload(admin, groupId, 'slides', 'apresentacao.pptx', PPTX);
    expect((await admin.del(`/api/groups/${groupId}`)).status).toBe(200);
    expect((await admin.get(`/api/groups/${groupId}/files/slides`)).status).toBe(404);
    expect((await admin.post(`/api/trash/group/${groupId}/restore`)).status).toBe(200);
    expect((await admin.get(`/api/groups/${groupId}/files/slides`)).status).toBe(200);
  });
});
