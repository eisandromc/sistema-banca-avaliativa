import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, DEMO_DATE, type TestEnv, type Client } from './helpers.ts';
import { seedScenarios, type ScenarioSeed } from '../src/db/scenarios.ts';

/** Duplicar banca e dia: leva a configuração, nunca o andamento (cronômetro, avaliações, votos, fechamentos). */
let env: TestEnv;
let sc: ScenarioSeed;
let admin: Client;
let ana: Client;

const events = async () => (await admin.get('/api/events')).body.events as any[];
const eventOf = async (id: number) => (await events()).find((e) => e.id === id);
const count = async (sql: string, params: unknown[]) => (await env.db.one<{ n: number }>(`select count(*)::int as n from ${sql}`, params))!.n;

beforeAll(async () => {
  env = await setupEnv();
  const r = await seedScenarios(env.db, { date: DEMO_DATE, now: Date.parse(`${DEMO_DATE}T11:00:00Z`) });
  if (r.skipped) throw new Error('cenários já existiam');
  sc = r;
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
});
afterAll(async () => env.close());

describe('duplicar banca', () => {
  it('só o administrador duplica; banca inexistente ou na lixeira dá 404', async () => {
    expect((await ana.post(`/api/events/${sc.eventId}/duplicate`, {})).status).toBe(403);
    expect((await env.anon.post(`/api/events/${sc.eventId}/duplicate`, {})).status).toBe(401);
    expect((await admin.post('/api/events/999999/duplicate', {})).status).toBe(404);
    const tmp = (await admin.post('/api/events', { name: 'Banca descartável' })).body.id;
    expect((await admin.del(`/api/events/${tmp}`)).status).toBe(200);
    expect((await admin.post(`/api/events/${tmp}/duplicate`, {})).status).toBe(404);
  });

  it('sem grupos: leva dados, regras, dias, intervalos, votação e escala, e nada do andamento', async () => {
    const src = await eventOf(sc.eventId);
    const r = await admin.post(`/api/events/${sc.eventId}/duplicate`, {});
    expect(r.status).toBe(200);
    const copy = await eventOf(r.body.id);

    // Dados da banca iguais, exceto id e nome.
    const { id: _a, name: nameA, days: daysA, ...restA } = src;
    const { id: _b, name: nameB, days: daysB, ...restB } = copy;
    expect(restB).toEqual(restA);
    expect(nameB).toBe(`${nameA} (cópia)`);

    // Dias novos, com os mesmos horários, intervalos, sala, perfil de tempo e Presidente da Banca.
    expect(daysB).toHaveLength(daysA.length);
    const strip = (d: any) => ({ ...d, id: undefined, breaks: d.breaks.map((b: any) => ({ label: b.label, start: b.start, end: b.end })) });
    const byLabel = (a: any, b: any) => a.label.localeCompare(b.label);
    expect([...daysB].sort(byLabel).map(strip)).toEqual([...daysA].sort(byLabel).map(strip));
    expect(daysB.some((d: any) => daysA.some((o: any) => o.id === d.id))).toBe(false);
    expect(daysB.find((d: any) => d.label === 'Dia de cenários').primaryUserId).toBe(sc.users.ana);

    // Escala de avaliadores do dia copiada (todos os grupos).
    const origAssign = (await admin.get(`/api/days/${sc.dayId}/assignments`)).body.assignments.filter((a: any) => a.groupId === null);
    const newDay = daysB.find((d: any) => d.label === (daysA.find((o: any) => o.id === sc.dayId)?.label));
    const copyAssign = (await admin.get(`/api/days/${newDay.id}/assignments`)).body.assignments;
    expect(origAssign.length).toBeGreaterThan(0);
    expect(copyAssign.map((a: any) => [a.userId, a.rubricPosition])).toEqual(origAssign.map((a: any) => [a.userId, a.rubricPosition]));

    // Perguntas de votação com opções.
    const q0 = (await admin.get(`/api/events/${sc.eventId}/vote-questions`)).body.questions;
    const q1 = (await admin.get(`/api/events/${r.body.id}/vote-questions`)).body.questions;
    expect(q1.length).toBe(q0.length);
    expect(q1.map((x: any) => [x.title, x.rule, x.options.map((o: any) => [o.label, o.isAbstain])])).toEqual(
      q0.map((x: any) => [x.title, x.rule, x.options.map((o: any) => [o.label, o.isAbstain])]),
    );
    expect(q1.every((x: any) => x.votes === 0)).toBe(true);

    // Sem grupos, sem cronograma e sem andamento.
    expect(r.body).toMatchObject({ groups: 0, days: daysA.length });
    expect(await count('groups where event_id = $1', [r.body.id])).toBe(0);
    expect(await count('timer_sessions where day_id = any($1::int[])', [daysB.map((d: any) => d.id)])).toBe(0);
    expect(await count('event_days where event_id = $1 and display_active_at is not null', [r.body.id])).toBe(0);

    // O original continua intacto e a ação ficou na auditoria.
    expect(await eventOf(sc.eventId)).toEqual(src);
    expect(await count("audit_logs where action = 'event.duplicated' and entity_id = $1", [String(r.body.id)])).toBe(1);
  });

  it('com grupos: leva grupos, alunos, distribuição e atribuições por grupo, sem avaliações nem início', async () => {
    const r = await admin.post(`/api/events/${sc.eventId}/duplicate`, { includeGroups: true });
    expect(r.status).toBe(200);
    const origGroups = (await admin.get(`/api/events/${sc.eventId}/groups`)).body.groups as any[];
    const copyGroups = (await admin.get(`/api/events/${r.body.id}/groups`)).body.groups as any[];
    expect(r.body.groups).toBe(origGroups.length);
    expect(copyGroups.length).toBe(origGroups.length);

    const key = (g: any) => [g.code, g.title, g.className, g.color, g.advisors, g.students, g.rubricTypeId];
    expect(copyGroups.map(key)).toEqual(origGroups.map(key));
    expect(copyGroups.some((g) => origGroups.some((o) => o.id === g.id))).toBe(false);

    // Alunos são registros novos (editar um grupo não altera o outro).
    const origStudents = await env.db.query<{ student_id: number }>('select student_id from group_students where group_id = any($1::int[])', [origGroups.map((g) => g.id)]);
    const copyStudents = await env.db.query<{ student_id: number }>('select student_id from group_students where group_id = any($1::int[])', [copyGroups.map((g) => g.id)]);
    expect(copyStudents.length).toBe(origStudents.length);
    expect(copyStudents.some((c) => origStudents.some((o) => o.student_id === c.student_id))).toBe(false);

    // Distribuição nos dias novos, na mesma posição, mas nada iniciado.
    const origScheduled = origGroups.filter((g) => g.dayId !== null);
    const copyScheduled = copyGroups.filter((g) => g.dayId !== null);
    expect(origScheduled.length).toBeGreaterThan(0);
    expect(copyScheduled.map((g) => [g.code, g.position]).sort()).toEqual(origScheduled.map((g) => [g.code, g.position]).sort());
    expect(copyScheduled.every((g) => g.started === false)).toBe(true);
    expect(copyScheduled.every((g) => !origScheduled.some((o) => o.dayId === g.dayId))).toBe(true);
    expect(await count('schedule_entries e join groups g on g.id = e.group_id where g.event_id = $1 and (e.started_at is not null or e.ended_at is not null)', [r.body.id])).toBe(0);

    // Nenhum andamento veio junto.
    const ids = copyGroups.map((g) => g.id);
    expect(await count('evaluations where group_id = any($1::int[])', [ids])).toBe(0);
    expect(await count('evaluation_closures where group_id = any($1::int[])', [ids])).toBe(0);
    expect(await count('closure_exceptions where group_id = any($1::int[])', [ids])).toBe(0);
    expect(await count('group_verdicts where group_id = any($1::int[])', [ids])).toBe(0);
    expect(await count('timer_sessions t join schedule_entries e on e.id = t.entry_id where e.group_id = any($1::int[])', [ids])).toBe(0);

    // Atribuições específicas de grupo (ex.: o avaliador extra de um grupo) acompanham o grupo copiado.
    const origSpecific = await count('evaluator_assignments a join groups g on g.id = a.group_id where g.event_id = $1', [sc.eventId]);
    const copySpecific = await count('evaluator_assignments a join groups g on g.id = a.group_id where g.event_id = $1', [r.body.id]);
    expect(origSpecific).toBeGreaterThan(0);
    expect(copySpecific).toBe(origSpecific);
  });

  it('a cópia é independente: excluir a cópia não afeta o original', async () => {
    const r = await admin.post(`/api/events/${sc.eventId}/duplicate`, { includeGroups: true });
    const before = (await admin.get(`/api/events/${sc.eventId}/groups`)).body.groups.length;
    expect((await admin.del(`/api/events/${r.body.id}`)).status).toBe(200);
    expect((await admin.get(`/api/events/${sc.eventId}/groups`)).body.groups.length).toBe(before);
    expect(await eventOf(sc.eventId)).toBeTruthy();
  });

  it('leva o logotipo e o tipo de rubrica', async () => {
    const dot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await env.db.query('update events set logo_data_url = $2 where id = $1', [env.seed.eventId, dot]);
    const r = await admin.post(`/api/events/${env.seed.eventId}/duplicate`, {});
    const copy = await eventOf(r.body.id);
    expect(copy.hasLogo).toBe(true);
    expect(copy.rubricTypeId).toBe((await eventOf(env.seed.eventId)).rubricTypeId);
    expect((await env.db.one<any>('select logo_data_url from events where id = $1', [r.body.id]))!.logo_data_url).toBe(dot);
  });
});

describe('duplicar dia', () => {
  it('só o administrador; dia inexistente dá 404; data inválida é recusada', async () => {
    expect((await ana.post(`/api/days/${sc.dayId}/duplicate`, {})).status).toBe(403);
    expect((await admin.post('/api/days/999999/duplicate', {})).status).toBe(404);
    expect((await admin.post(`/api/days/${sc.dayId}/duplicate`, { date: '20/10/2026' })).status).toBe(400);
  });

  it('copia horários, intervalos, sala, perfil, Presidente da Banca e escala; não leva grupos nem andamento', async () => {
    const before = (await eventOf(sc.eventId)).days as any[];
    const orig = before.find((d) => d.id === sc.dayId);
    const r = await admin.post(`/api/days/${sc.dayId}/duplicate`, { date: '2026-10-21' });
    expect(r.status).toBe(200);

    const after = (await eventOf(sc.eventId)).days as any[];
    expect(after).toHaveLength(before.length + 1);
    const copy = after.find((d) => d.id === r.body.id);
    expect(copy).toMatchObject({
      date: expect.stringContaining('2026-10-21'),
      startTime: orig.startTime,
      endTime: orig.endTime,
      room: orig.room,
      gapMinutes: orig.gapMinutes,
      defaultProfileId: orig.defaultProfileId,
      primaryUserId: orig.primaryUserId,
    });
    expect(copy.label).toBe(`${orig.label} (cópia)`);
    expect(copy.breaks.map((b: any) => [b.label, b.start, b.end])).toEqual(orig.breaks.map((b: any) => [b.label, b.start, b.end]));

    const origAssign = (await admin.get(`/api/days/${sc.dayId}/assignments`)).body.assignments.filter((a: any) => a.groupId === null);
    const copyAssign = (await admin.get(`/api/days/${r.body.id}/assignments`)).body.assignments;
    expect(copyAssign.map((a: any) => [a.userId, a.rubricPosition])).toEqual(origAssign.map((a: any) => [a.userId, a.rubricPosition]));
    expect(copyAssign.every((a: any) => a.groupId === null)).toBe(true);

    expect(await count('schedule_entries where day_id = $1', [r.body.id])).toBe(0);
    expect(await count('timer_sessions where day_id = $1', [r.body.id])).toBe(0);
    expect(await count('event_days where id = $1 and display_active_at is not null', [r.body.id])).toBe(0);
    // O original (já com apresentações) segue como estava.
    expect(await count('schedule_entries where day_id = $1', [sc.dayId])).toBeGreaterThan(0);
    expect(await count("audit_logs where action = 'day.duplicated' and entity_id = $1", [String(r.body.id)])).toBe(1);
  });

  it('sem data informada, mantém a data do dia original; a cópia pode ser excluída', async () => {
    const orig = ((await eventOf(sc.eventId)).days as any[]).find((d) => d.id === sc.dayId);
    const r = await admin.post(`/api/days/${sc.dayId}/duplicate`, {});
    const copy = ((await eventOf(sc.eventId)).days as any[]).find((d) => d.id === r.body.id);
    expect(copy.date).toBe(orig.date);
    expect((await admin.del(`/api/days/${r.body.id}`)).status).toBe(200);
  });
});
