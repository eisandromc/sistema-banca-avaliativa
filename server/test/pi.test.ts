import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, pdfText, DEMO_DATE, type Client, type TestEnv } from './helpers.ts';
import { seedPiDemo } from '../src/db/seed.ts';
import { formatLocation } from '../../shared/location.ts';

/** Rubrica do Projeto Integrador: 4 avaliadores, critérios 0–5, subtotal /25, total /100 pela soma, parecer e PDF no formato do instrumento. */

let env: TestEnv;
let admin: Client;
let day1: number;
let day2: number;
let eventId: number;
const login = (email: string) => env.login(email);

const flat = (t: string) => t.replace(/\s+/g, ' ');

async function evalOf(c: Client, dayId: number) {
  const ws = (await c.get(`/api/days/${dayId}/workspace`)).body;
  return ws.current.myEvaluationId as number;
}

async function fill(c: Client, dayId: number, scores: number[], devolutiva: string) {
  const id = await evalOf(c, dayId);
  const f = (await c.get(`/api/evaluations/${id}`)).body;
  const save = await c.put(`/api/evaluations/${id}/draft`, {
    revision: f.evaluation.revision,
    generalComment: devolutiva,
    scores: f.rubric.criteria.map((cr: any, i: number) => ({ criterionId: cr.id, score: scores[i] })),
  });
  expect(save.status, JSON.stringify(save.body)).toBe(200);
  const sub = await c.post(`/api/evaluations/${id}/submit`, { revision: save.body.revision });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  return f;
}

beforeAll(async () => {
  env = await setupEnv();
  const r = await seedPiDemo(env.db, { date: DEMO_DATE });
  if (r.skipped) throw new Error('seed PI não criado');
  [day1, day2] = r.days as [number, number];
  eventId = r.eventId;
  admin = await login('admin@demo.banca');
});
afterAll(async () => env.close());

describe('local impresso (sala + escola)', () => {
  it('concatena conforme o modelo e lida com campos vazios', () => {
    expect(formatLocation('{sala} — {escola}', 'Sala 201', 'Escola X')).toBe('Sala 201 — Escola X');
    expect(formatLocation('{escola}, {sala}', 'Sala 201', 'Escola X')).toBe('Escola X, Sala 201');
    expect(formatLocation('{sala} — {escola}', '', 'Escola X')).toBe('Escola X');
    expect(formatLocation('{sala} — {escola}', 'Sala 201', null)).toBe('Sala 201');
  });
});

describe('escala de professores por dia', () => {
  it('cada dia tem sua configuração: o mesmo professor muda de rubrica e nem todos se repetem', async () => {
    const assignments = async (d: number) => (await admin.get(`/api/days/${d}/assignments`)).body.assignments.map((a: any) => `${a.userName}|${a.rubricTitle}`).sort();
    const a1 = await assignments(day1);
    const a2 = await assignments(day2);
    expect(a1).toContain('Profa. Ana Exemplo (Demo)|Avaliador - Conteúdo Técnico');
    expect(a2).toContain('Profa. Ana Exemplo (Demo)|Avaliador - Projeto Integrador');
    expect(a1.some((x: string) => x.startsWith('Profa. Carla'))).toBe(true);
    expect(a2.some((x: string) => x.startsWith('Profa. Carla'))).toBe(false);
    const carla = await login('carla@demo.banca');
    expect((await carla.get(`/api/days/${day2}/workspace`)).status).toBe(403);
  });

  it('copiar a escala de outro dia cria/atualiza atribuições sem duplicar', async () => {
    const d3 = await admin.post(`/api/events/${eventId}/days`, { label: 'Dia 3', date: '2026-10-23', startTime: '13:30', endTime: '17:30' });
    expect(d3.status).toBe(200);
    const c1 = await admin.post(`/api/days/${d3.body.id}/assignments/copy`, { fromDayId: day1 });
    expect(c1.body).toEqual({ copied: 4, updated: 0 });
    const c2 = await admin.post(`/api/days/${d3.body.id}/assignments/copy`, { fromDayId: day2 });
    expect(c2.body.copied + c2.body.updated).toBe(4);
    const list = (await admin.get(`/api/days/${d3.body.id}/assignments`)).body.assignments;
    expect(list).toHaveLength(5); // 4 do dia 1 + Elisa do dia 2; Ana atualizada para a rubrica do dia 2
    const days = (await admin.get('/api/events')).body.events.find((e: any) => e.id === eventId).days;
    expect(days.find((d: any) => d.id === d3.body.id).primaryUserId).toBe(env.seed.users.bruno);
  });
});

describe('banca do Projeto Integrador', () => {
  it('ficha com escala 0–5 (rótulos), soma por avaliador e total /100, parecer obrigatório e PDF no formato do instrumento', async () => {
    const ana = await login('ana@demo.banca');
    const bruno = await login('bruno@demo.banca');
    const carla = await login('carla@demo.banca');
    const daniel = await env.login('daniel@demo.banca');

    // Local impresso configurável (sala + escola)
    const ev = (await admin.get('/api/events')).body.events.find((e: any) => e.id === eventId);
    expect(ev.aggregation).toBe('sum');
    expect(ev.verdictOptions).toHaveLength(4);
    await admin.put(`/api/events/${eventId}`, { ...ev, locationFormat: '{sala}, {escola}' });

    const entry = (await ana.get(`/api/days/${day1}/workspace`)).body.entries[0];
    expect((await ana.post(`/api/days/${day1}/timer/start`, { entryId: entry.entryId })).status).toBe(200);

    const id = await evalOf(ana, day1);
    const form = (await ana.get(`/api/evaluations/${id}`)).body;
    expect(form.rubric.title).toBe('Avaliador - Conteúdo Técnico');
    expect(form.rubric.criteria).toHaveLength(5);
    expect(form.rubric.scale).toMatchObject({ min: 0, max: 5, step: 1 });
    expect(form.rubric.scaleLabels.map((l: any) => l.label)).toEqual(['Não evidenciado', 'Inicial', 'Parcial', 'Adequado', 'Consistente', 'Plenamente desenvolvido']);
    expect(form.rubric.feedbackLabel).toBe('Devolutiva técnica');
    expect(form.evaluation.aggregation).toBe('sum');
    // Fora da escala / fora do incremento
    for (const bad of [6, 2.5, -1]) {
      const r = await ana.put(`/api/evaluations/${id}/draft`, { revision: form.evaluation.revision, scores: [{ criterionId: form.rubric.criteria[0].id, score: bad }] });
      expect(r.status).toBe(400);
    }

    await fill(ana, day1, [5, 5, 5, 5, 5], 'Solução técnica sólida e bem demonstrada.');
    await fill(bruno, day1, [4, 4, 4, 4, 4], 'Artigo bem estruturado; ampliar referências.');
    await fill(carla, day1, [3, 3, 3, 3, 3], 'Boa integração curricular.');
    await fill(daniel, day1, [5, 4, 3, 2, 1], 'Melhorar o tempo das respostas.');

    const groupId = entry.groupId;
    expect((await ana.post(`/api/days/${day1}/timer/finish`, {})).status).toBe(200);
    let review = (await ana.get(`/api/groups/${groupId}/review`)).body.consolidation;
    expect(review.evaluators.map((e: any) => [e.rubric.dimensionShort, e.points, e.maxPoints])).toEqual([
      ['Solução tecnológica', 25, 25],
      ['Artigo e pesquisa', 20, 25],
      ['Projeto Integrador', 15, 25],
      ['Apresentação e defesa', 15, 25],
    ]);
    expect(review.finalScore).toBe(75);
    expect(review.finalMax).toBe(100);
    expect(review.location).toBe('Sala 201, Escola Fictícia de Demonstração — Rua Exemplo, 100');
    expect(review.blockers).toEqual(['Registre o parecer da banca.']);
    expect((await ana.post(`/api/groups/${groupId}/close`, { confirm: true })).status).toBe(400);

    // Parecer: só opções configuradas; avaliador comum não registra
    expect((await bruno.put(`/api/groups/${groupId}/verdict`, { verdict: 'Projeto desenvolvido' })).status).toBe(403);
    expect((await ana.put(`/api/groups/${groupId}/verdict`, { verdict: 'Aprovado com louvor' })).status).toBe(400);
    const v = await ana.put(`/api/groups/${groupId}/verdict`, {
      verdict: 'Projeto desenvolvido',
      strengths: 'Domínio técnico e clareza do problema.',
      improvements: 'Aprofundar a fundamentação teórica.',
      guidance: 'Publicar o repositório com documentação.',
    });
    expect(v.status).toBe(200);
    review = (await ana.get(`/api/groups/${groupId}/review`)).body.consolidation;
    expect(review.blockers).toEqual([]);
    expect((await ana.post(`/api/groups/${groupId}/close`, { confirm: true })).status).toBe(200);
    expect((await ana.put(`/api/groups/${groupId}/verdict`, { verdict: 'Necessita retomada' })).status).toBe(409);

    const pdf = await ana.get(`/api/groups/${groupId}/report.pdf`);
    expect(pdf.status).toBe(200);
    const text = flat(pdfText(pdf.raw));
    for (const expected of [
      'Rubrica de Avaliação da Banca do Projeto Integrador',
      'Instrumento para apresentação do artigo e do projeto desenvolvido',
      'SENAC ENSINO MÉDIO',
      'Porto Alegre - RS',
      'Finalidade da banca',
      'Escala de avaliação',
      'Plenamente desenvolvido',
      'Composição da banca e responsabilidades',
      '1 - Professor técnico',
      'Avaliador - Conteúdo Técnico',
      'Avaliador - Artigo e Pesquisa',
      'Avaliador - Projeto Integrador',
      'Avaliador - Apresentação e Defesa',
      'Responsabilidade:',
      'Subtotal do avaliador: 25 / 25',
      'Subtotal do avaliador: 20 / 25',
      'Devolutiva técnica',
      'Solução técnica sólida e bem demonstrada.',
      'Nome do avaliador:',
      'Registro Consolidado da Banca',
      'TOTAL DA BANCA',
      '75 / 100',
      '(X) Projeto desenvolvido',
      '( ) Necessita retomada',
      'Aprofundar a fundamentação teórica.',
      'Assinaturas dos avaliadores',
      'Sala 201, Escola Fictícia de Demonstração',
      'PI-01',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // Critérios transcritos do instrumento
    expect(text).toContain('As funcionalidades atendem ao problema, ao público definido e aos requisitos apresentados pelo grupo.');
    expect(text).toContain('Os integrantes demonstram participação equilibrada, colaboração, postura ética e profissional.');
  });

  it('logotipo institucional: só PNG/JPEG, e entra no PDF', async () => {
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    expect((await admin.put(`/api/events/${eventId}/logo`, { dataUrl: 'data:text/html;base64,PHA+' })).status).toBe(400);
    expect((await admin.put(`/api/events/${eventId}/logo`, { dataUrl: png1x1 })).status).toBe(200);
    const img = await admin.get(`/api/events/${eventId}/logo`);
    expect(img.headers['content-type']).toBe('image/png');
    const ana = await login('ana@demo.banca');
    const groupId = (await ana.get(`/api/days/${day1}/workspace`)).body.entries[0].groupId;
    const pdf = await ana.get(`/api/groups/${groupId}/report.pdf`);
    expect(pdf.raw.toString('latin1')).toContain('/Subtype /Image');
  });
});

describe('dias de participação no cadastro do professor', () => {
  it('lista, marca e desmarca dias com rubrica por dia; protege dias com fichas ou primário', async () => {
    const users = (await admin.get('/api/users')).body.users;
    const daniel = users.find((u: any) => u.email === 'daniel@demo.banca');
    expect(daniel.days.map((d: any) => d.id)).toEqual(expect.arrayContaining([day1, day2]));

    const days = (await admin.get(`/api/users/${daniel.id}/days`)).body.days;
    const d1 = days.find((d: any) => d.dayId === day1);
    expect(d1).toMatchObject({ assigned: true, hasEvaluations: true });
    // Dia 1 tem fichas do Daniel: não pode ser removido
    const keepOnlyDay2 = await admin.put(`/api/users/${daniel.id}/days`, { days: [{ dayId: day2, rubricVersionId: d1.rubricVersionId }] });
    expect(keepOnlyDay2.status).toBe(409);

    // Elisa só atua no Dia 2; passa a atuar também no Dia 1 com outra rubrica e depois sai do Dia 1
    const elisa = users.find((u: any) => u.email === 'elisa@demo.banca');
    const eDays = (await admin.get(`/api/users/${elisa.id}/days`)).body.days;
    const d2rubric = eDays.find((d: any) => d.dayId === day2).rubricVersionId;
    const tecnico = env.seed.rubrics.tecnica;
    const mine = eDays.filter((d: any) => d.assigned).map((d: any) => ({ dayId: d.dayId, rubricVersionId: d.rubricVersionId }));
    const add = await admin.put(`/api/users/${elisa.id}/days`, { days: [...mine, { dayId: day1, rubricVersionId: tecnico }] });
    expect(add.body).toEqual({ added: 1, updated: 0, removed: 0 });
    const now = (await admin.get(`/api/users/${elisa.id}/days`)).body.days.filter((d: any) => d.assigned);
    expect(now.find((d: any) => d.dayId === day1).rubricVersionId).toBe(tecnico);
    expect(now.find((d: any) => d.dayId === day2).rubricVersionId).toBe(d2rubric);
    const rem = await admin.put(`/api/users/${elisa.id}/days`, { days: mine });
    expect(rem.body).toEqual({ added: 0, updated: 0, removed: 1 });

    // Primário do dia não pode ser desmarcado; conta não-professor não participa
    const bruno = users.find((u: any) => u.email === 'bruno@demo.banca');
    const bDays = (await admin.get(`/api/users/${bruno.id}/days`)).body.days.filter((d: any) => d.assigned && d.dayId !== day2);
    expect((await admin.put(`/api/users/${bruno.id}/days`, { days: bDays.map((d: any) => ({ dayId: d.dayId, rubricVersionId: d.rubricVersionId })) })).status).toBe(409);
    const telao = users.find((u: any) => u.role === 'viewer');
    expect((await admin.put(`/api/users/${telao.id}/days`, { days: [{ dayId: day1, rubricVersionId: tecnico }] })).status).toBe(400);
    const prof = await login('bruno@demo.banca');
    expect((await prof.get(`/api/users/${bruno.id}/days`)).status).toBe(403);
  });
});
