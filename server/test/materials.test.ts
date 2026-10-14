import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv, type Client } from './helpers.ts';
import { GROUP_COLORS, embedUrl, downloadUrl, nextGroupColor, isSafeLink } from '../../shared/groups.ts';

/**
 * Cadastro do grupo com resumo, materiais, orientadores e cor; distribuição dos grupos nos dias;
 * tipos de rubrica vinculados à banca e ao grupo.
 */
let env: TestEnv;
let admin: Client;
let ana: Client;
let bruno: Client;
let carla: Client;
let eventId: number;
let dayId: number;

beforeAll(async () => {
  env = await setupEnv();
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
  bruno = await env.login('bruno@demo.banca');
  carla = await env.login('carla@demo.banca');
  eventId = env.seed.eventId;
  dayId = env.seed.dayId;
});
afterAll(async () => env.close());

const groupsOf = async () => (await admin.get(`/api/events/${eventId}/groups`)).body.groups as any[];
const schedule = async (d = dayId) => (await admin.get(`/api/days/${d}/schedule`)).body.entries.map((e: any) => e.code) as string[];
const base = { className: '1º T (teste)', students: ['Estudante Fictício Z'] };
/** Corpo completo de edição a partir do grupo listado (a edição substitui todos os campos). */
const pick = (g: any) => ({
  code: g.code,
  className: g.className,
  title: g.title,
  description: g.description,
  advisors: g.advisors,
  projectUrl: g.projectUrl,
  pdfUrl: g.pdfUrl,
  slidesUrl: g.slidesUrl,
  rubricTypeId: g.rubricTypeId,
  students: g.students,
});

describe('funções de apoio', () => {
  it('cor: escolhe a menos usada da paleta', () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0]);
    expect(nextGroupColor([GROUP_COLORS[0], GROUP_COLORS[1]])).toBe(GROUP_COLORS[2]);
    expect(nextGroupColor([...GROUP_COLORS, GROUP_COLORS[0]])).toBe(GROUP_COLORS[1]);
  });

  it('links: aceita http(s) e caminhos do sistema; recusa outros esquemas', () => {
    expect(isSafeLink('https://exemplo.org/a.pdf')).toBe(true);
    expect(isSafeLink('/demo/a.pdf')).toBe(true);
    expect(isSafeLink('/demo/a.pdf', false)).toBe(false);
    expect(isSafeLink('//outro.site/a.pdf')).toBe(false);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('data:text/html,x')).toBe(false);
  });

  it('incorporação: Google Apresentações, Drive e Canva', () => {
    expect(embedUrl('https://docs.google.com/presentation/d/ABC_1-x/edit#slide=id.p')).toBe('https://docs.google.com/presentation/d/ABC_1-x/embed?start=false&loop=false');
    expect(embedUrl('https://drive.google.com/file/d/XYZ/view?usp=sharing')).toBe('https://drive.google.com/file/d/XYZ/preview');
    expect(embedUrl('https://www.canva.com/design/DAF1/abc/view')).toBe('https://www.canva.com/design/DAF1/abc/view?embed');
    expect(embedUrl('/demo/apresentacao-exemplo.pdf')).toBe('/demo/apresentacao-exemplo.pdf');
    expect(downloadUrl('https://drive.google.com/file/d/XYZ/view')).toBe('https://drive.google.com/uc?export=download&id=XYZ');
  });
});

describe('cadastro do grupo com materiais', () => {
  let groupId: number;

  it('grava resumo, orientadores e links, e gera a cor de identificação', async () => {
    const before = (await groupsOf()).map((g) => g.color);
    const r = await admin.post(`/api/events/${eventId}/groups`, {
      ...base,
      code: 'M-01',
      title: 'Projeto com materiais (fictício)',
      description: 'Resumo fictício do projeto.',
      advisors: ['Profa. Orientadora Fictícia', 'Prof. Coorientador Fictício'],
      projectUrl: 'https://example.org/projeto',
      pdfUrl: '/demo/artigo-exemplo.pdf',
      slidesUrl: 'https://docs.google.com/presentation/d/ABC/edit',
    });
    expect(r.status).toBe(200);
    groupId = r.body.id;
    expect(r.body.color).toBe(nextGroupColor(before));
    const g = (await groupsOf()).find((x) => x.id === groupId);
    expect(g).toMatchObject({
      description: 'Resumo fictício do projeto.',
      advisors: ['Profa. Orientadora Fictícia', 'Prof. Coorientador Fictício'],
      advisor: 'Profa. Orientadora Fictícia, Prof. Coorientador Fictício',
      projectUrl: 'https://example.org/projeto',
      pdfUrl: '/demo/artigo-exemplo.pdf',
      color: r.body.color,
    });
  });

  it('a cor pode ser escolhida e é mantida quando não é enviada', async () => {
    const g = (await groupsOf()).find((x) => x.id === groupId);
    const body = { ...base, ...pick(g) };
    expect((await admin.put(`/api/groups/${groupId}`, { ...body, color: '#123456' })).status).toBe(200);
    expect((await groupsOf()).find((x) => x.id === groupId).color).toBe('#123456');
    expect((await admin.put(`/api/groups/${groupId}`, body)).status).toBe(200);
    const after = (await groupsOf()).find((x) => x.id === groupId);
    expect(after.color).toBe('#123456');
    expect(after.description).toBe('Resumo fictício do projeto.');
  });

  it('recusa links perigosos ou fora do padrão', async () => {
    for (const bad of [{ pdfUrl: 'javascript:alert(1)' }, { slidesUrl: 'data:text/html,oi' }, { projectUrl: '/local/nao' }, { color: 'azul' }]) {
      expect((await admin.post(`/api/events/${eventId}/groups`, { ...base, code: 'M-X', title: 'x', ...bad })).status).toBe(400);
    }
  });

  it('o campo antigo "advisor" ainda é aceito', async () => {
    const r = await admin.post(`/api/events/${eventId}/groups`, { ...base, code: 'M-02', title: 'Legado (fictício)', advisor: 'Orientador Único' });
    expect((await groupsOf()).find((x) => x.id === r.body.id).advisors).toEqual(['Orientador Único']);
  });
});

describe('distribuição dos grupos nos dias', () => {
  let day2: number;
  const id = async (code: string) => (await groupsOf()).find((g) => g.code === code).id as number;

  beforeAll(async () => {
    day2 = (await admin.post(`/api/events/${eventId}/days`, { label: 'Dia 2', date: '2026-10-21', startTime: '08:00', endTime: '12:00' })).body.id;
  });

  it('coloca um grupo sem dia na posição escolhida', async () => {
    expect((await admin.post(`/api/groups/${await id('M-01')}/place`, { dayId, position: 1 })).status).toBe(200);
    expect(await schedule()).toEqual(['M-01', 'Grupo 01', 'Grupo 02']);
  });

  it('reordena dentro do mesmo dia', async () => {
    expect((await admin.post(`/api/groups/${await id('M-01')}/place`, { dayId, position: 3 })).status).toBe(200);
    expect(await schedule()).toEqual(['Grupo 01', 'Grupo 02', 'M-01']);
  });

  it('move para outro dia, renumera a origem e leva as atribuições específicas', async () => {
    const m01 = await id('M-01');
    await admin.post(`/api/days/${dayId}/assignments`, { userId: env.seed.users.carla, rubricVersionId: env.seed.rubrics.tecnica, groupId: m01 });
    await admin.post(`/api/groups/${await id('Grupo 02')}/place`, { dayId: day2 });
    expect((await admin.post(`/api/groups/${m01}/place`, { dayId: day2, position: 1 })).status).toBe(200);
    expect(await schedule(day2)).toEqual(['M-01', 'Grupo 02']);
    const s1 = (await admin.get(`/api/days/${dayId}/schedule`)).body.entries;
    expect(s1.map((e: any) => [e.code, e.position])).toEqual([['Grupo 01', 1]]);
    const a2 = (await admin.get(`/api/days/${day2}/assignments`)).body.assignments;
    expect(a2.some((a: any) => a.groupId === m01)).toBe(true);
  });

  it('tira do cronograma (volta para "sem dia")', async () => {
    expect((await admin.post(`/api/groups/${await id('M-01')}/place`, { dayId: null })).status).toBe(200);
    expect(await schedule(day2)).toEqual(['Grupo 02']);
    expect((await groupsOf()).find((g) => g.code === 'M-01').dayId).toBeNull();
    // Volta tudo ao dia 1 para os próximos testes.
    await admin.post(`/api/groups/${await id('Grupo 02')}/place`, { dayId, position: 2 });
    await admin.post(`/api/groups/${await id('M-01')}/place`, { dayId });
    expect(await schedule()).toEqual(['Grupo 01', 'Grupo 02', 'M-01']);
  });

  it('só administrador distribui; dia de outra banca é recusado', async () => {
    expect((await ana.post(`/api/groups/${await id('M-01')}/place`, { dayId })).status).toBe(403);
    const other = (await admin.post('/api/events', { name: 'Outra banca (teste)' })).body.id;
    const otherDay = (await admin.post(`/api/events/${other}/days`, { date: '2026-10-22', startTime: '08:00', endTime: '09:00' })).body.id;
    expect((await admin.post(`/api/groups/${await id('M-01')}/place`, { dayId: otherDay })).status).toBe(400);
  });

  it('grupo que já se apresentou não muda de dia nem sai do cronograma', async () => {
    const entry = (await admin.get(`/api/days/${dayId}/schedule`)).body.entries.find((e: any) => e.code === 'Grupo 01');
    await ana.post(`/api/days/${dayId}/select`, { entryId: entry.entryId });
    expect((await ana.post(`/api/days/${dayId}/timer/start`, { entryId: entry.entryId })).status).toBe(200);
    const g01 = await id('Grupo 01');
    expect((await admin.post(`/api/groups/${g01}/place`, { dayId: day2 })).status).toBe(409);
    expect((await admin.post(`/api/groups/${g01}/place`, { dayId: null })).status).toBe(409);
    // Reordenar no mesmo dia continua permitido.
    expect((await admin.post(`/api/groups/${g01}/place`, { dayId, position: 2 })).status).toBe(200);
    expect((await admin.post(`/api/groups/${g01}/place`, { dayId, position: 1 })).status).toBe(200);
  });
});

describe('materiais na área do professor', () => {
  it('o grupo atual traz orientadores e o resumo fica disponível para quem atua no dia', async () => {
    const ws = (await bruno.get(`/api/days/${dayId}/workspace`)).body;
    expect(ws.current.code).toBe('Grupo 01');
    expect(ws.current.color).toMatch(/^#[0-9a-f]{6}$/i);
    const m01 = ws.entries.find((e: any) => e.code === 'M-01');
    expect(m01.color).toBeTruthy();
    const p = await bruno.get(`/api/groups/${m01.groupId}/project`);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ code: 'M-01', summary: 'Resumo fictício do projeto.', pdfUrl: '/demo/artigo-exemplo.pdf', position: 3 });
    expect(p.body.advisors).toHaveLength(2);
  });

  it('quem não atua no dia não vê os materiais', async () => {
    const r = await admin.post('/api/users', { name: 'Prof. Fora do Dia (fictício)', email: 'fora@demo.banca', role: 'teacher', password: 'demo12345' });
    expect(r.status).toBe(200);
    const fora = await env.login('fora@demo.banca', 'demo12345');
    const gid = (await groupsOf()).find((g) => g.code === 'M-01').id;
    expect((await fora.get(`/api/groups/${gid}/project`)).status).toBe(403);
    expect((await env.anon.get(`/api/groups/${gid}/project`)).status).toBe(401);
  });

  it('o telão recebe a cor e a ordem do grupo atual', async () => {
    const live = (await ana.get(`/api/days/${dayId}/live`)).body;
    expect(live.current).toMatchObject({ code: 'Grupo 01', position: 1 });
    expect(live.current.color).toMatch(/^#/);
  });
});

describe('tipos de rubrica', () => {
  let typeA: number;
  let typeB: number;
  let b1: number;
  let b2: number;

  it('cria tipos, coloca rubricas dentro e lista na ordem', async () => {
    typeA = (await admin.post('/api/rubric-types', { name: 'Tipo A (teste)' })).body.id;
    typeB = (await admin.post('/api/rubric-types', { name: 'Tipo B (teste)', description: 'outro conjunto' })).body.id;
    expect((await admin.post('/api/rubric-types', { name: 'tipo a (TESTE)' })).status).toBe(409);
    const rub = (await admin.get('/api/rubrics')).body;
    const tplOf = (versionId: number) => rub.templates.find((t: any) => t.versions.some((v: any) => v.id === versionId)).id;
    expect((await admin.patch(`/api/rubric-templates/${tplOf(env.seed.rubrics.tecnica)}`, { typeId: typeA })).status).toBe(200);
    expect((await admin.patch(`/api/rubric-templates/${tplOf(env.seed.rubrics.comunicacao)}`, { typeId: typeA })).status).toBe(200);
    const version = { title: 'Ficha B', scaleMin: 0, scaleMax: 10, scaleStep: 1, criteria: [{ title: 'Critério único', weight: 1 }] };
    b1 = (await admin.post('/api/rubrics', { name: 'B — primeira (teste)', typeId: typeB, version: { ...version, title: 'B1' } })).body.versionId;
    b2 = (await admin.post('/api/rubrics', { name: 'B — segunda (teste)', typeId: typeB, version: { ...version, title: 'B2' } })).body.versionId;
    const after = (await admin.get('/api/rubrics')).body;
    const inA = after.templates.filter((t: any) => t.typeId === typeA).map((t: any) => t.typePosition);
    const inB = after.templates.filter((t: any) => t.typeId === typeB).map((t: any) => [t.name, t.typePosition]);
    expect(inA).toEqual([1, 2]);
    expect(inB).toEqual([
      ['B — primeira (teste)', 1],
      ['B — segunda (teste)', 2],
    ]);
    expect(after.types.find((t: any) => t.id === typeB)).toMatchObject({ name: 'Tipo B (teste)', description: 'outro conjunto' });
  });

  it('o roteiro pede o tipo de rubrica da banca', async () => {
    const r1 = (await admin.get(`/api/events/${eventId}/readiness`)).body.checks.find((c: any) => c.key === 'rubrics');
    expect(r1).toMatchObject({ status: 'warn', tab: 'bancas' });
    const ev = (await admin.get('/api/events')).body.events.find((e: any) => e.id === eventId);
    const { id: _i, days: _d, hasLogo: _h, ...rest } = ev;
    expect((await admin.put(`/api/events/${eventId}`, { ...rest, rubricTypeId: typeA })).status).toBe(200);
    const r2 = (await admin.get(`/api/events/${eventId}/readiness`)).body.checks.find((c: any) => c.key === 'rubrics');
    expect(r2).toMatchObject({ status: 'ok' });
    expect(r2.detail).toContain('Tipo A (teste)');
  });

  it('grupo de outro tipo: cada avaliador recebe a rubrica da mesma posição no tipo do grupo', async () => {
    const g = (await groupsOf()).find((x) => x.code === 'Grupo 02');
    expect((await admin.put(`/api/groups/${g.id}`, { ...pick(g), rubricTypeId: typeB })).status).toBe(200);
    // Encerra o Grupo 01 e inicia o Grupo 02.
    await ana.post(`/api/days/${dayId}/timer/finish`);
    const entry = (await admin.get(`/api/days/${dayId}/schedule`)).body.entries.find((e: any) => e.code === 'Grupo 02');
    expect((await ana.post(`/api/days/${dayId}/select`, { entryId: entry.entryId })).status).toBe(200);
    expect((await ana.post(`/api/days/${dayId}/timer/start`, { entryId: entry.entryId })).status).toBe(200);
    const rubricOf = async (c: Client) => {
      const ws = (await c.get(`/api/days/${dayId}/workspace`)).body;
      return (await c.get(`/api/evaluations/${ws.current.myEvaluationId}`)).body.rubric.versionId;
    };
    // Ana e Bruno avaliam com a 1ª rubrica do tipo A (técnica) → 1ª do tipo B; Carla com a 2ª → 2ª do tipo B.
    expect(await rubricOf(ana)).toBe(b1);
    expect(await rubricOf(bruno)).toBe(b1);
    expect(await rubricOf(carla)).toBe(b2);
  });

  it('tipo em uso não pode ser excluído; tipo livre pode', async () => {
    expect((await admin.del(`/api/rubric-types/${typeA}`)).status).toBe(409);
    expect((await admin.del(`/api/rubric-types/${typeB}`)).status).toBe(409);
    const free = (await admin.post('/api/rubric-types', { name: 'Tipo livre (teste)' })).body.id;
    expect((await admin.del(`/api/rubric-types/${free}`)).status).toBe(200);
    expect((await ana.post('/api/rubric-types', { name: 'x' })).status).toBe(403);
  });
});
