import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, DEMO_DATE, pdfText, type TestEnv, type Client } from './helpers.ts';
import { seedScenarios, SCENARIOS, type ScenarioSeed } from '../src/db/scenarios.ts';

/**
 * Banca de cenários de teste: cada grupo é levado a uma situação do processo pelos próprios serviços.
 * Os testes conferem que cada situação aparece corretamente nas visões (cronograma, ficha, conferência,
 * PDF, roteiro de preparação) e que as regras continuam valendo a partir de cada estado.
 */
let env: TestEnv;
let sc: ScenarioSeed;
let admin: Client;
let ana: Client;
let bruno: Client;
let carla: Client;
let fabio: Client;

beforeAll(async () => {
  env = await setupEnv();
  const r = await seedScenarios(env.db, { date: DEMO_DATE, now: Date.parse(`${DEMO_DATE}T11:00:00Z`) });
  if (r.skipped) throw new Error('cenários já existiam');
  sc = r;
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
  bruno = await env.login('bruno@demo.banca');
  carla = await env.login('carla@demo.banca');
  fabio = await env.login('fabio@demo.banca');
});
afterAll(async () => env.close());

const entryOf = async (code: string) => (await ana.get(`/api/days/${sc.dayId}/workspace`)).body.entries.find((e: any) => e.code === code);

describe('banca de cenários de teste', () => {
  it('é idempotente', async () => {
    expect((await seedScenarios(env.db)).skipped).toBe(true);
  });

  it('cada grupo está na situação descrita pelo cenário', async () => {
    const ws = (await ana.get(`/api/days/${sc.dayId}/workspace`)).body;
    for (const [code, , status] of SCENARIOS) {
      expect(ws.entries.find((e: any) => e.code === code)?.status, code).toBe(status);
    }
    // O grupo pausado é o atual; o próximo é o que ainda aguarda.
    expect(ws.current.code).toBe('C-07');
    const live = (await ana.get(`/api/days/${sc.dayId}/live`)).body;
    expect(live.timer.status).toBe('paused');
    expect(live.next.code).toBe('C-08');
  });

  it('versões de fechamento, reabertura e exceções ficam no histórico', async () => {
    const c03 = (await ana.get(`/api/groups/${sc.groups['C-03']}/review`)).body;
    expect(c03.history.map((h: any) => h.version)).toEqual([2, 1]);
    expect(c03.history[1].reopenReason).toMatch(/Nota digitada errada/);
    expect(c03.closed.closure.version).toBe(2);

    const c02 = (await ana.get(`/api/groups/${sc.groups['C-02']}/review`)).body;
    expect(c02.closed.exceptions.map((x: any) => x.kind).sort()).toEqual(['criterion_waived', 'evaluator_absent']);
    const carlaRow = c02.closed.evaluators.find((e: any) => e.name.includes('Carla'));
    expect(carlaRow.absent.reason).toMatch(/ausente/);
    expect(carlaRow.counted).toBe(false);
    const brunoRow = c02.closed.evaluators.find((e: any) => e.name.includes('Bruno'));
    expect(brunoRow.criteria.find((c: any) => c.title === 'Organização').waived).toBeTruthy();

    // C-04 reaberto: fichas voltaram a rascunho, sem fechamento vigente.
    const c04 = (await ana.get(`/api/groups/${sc.groups['C-04']}/review`)).body;
    expect(c04.closed).toBeNull();
    expect(c04.consolidation.evaluators.every((e: any) => e.status === 'draft')).toBe(true);
    expect(c04.history[0].reopenedAt).toBeTruthy();
  });

  it('histórico do cronômetro registra reinício, encerramento antecipado, ajuste, pausa e tempo esgotado', async () => {
    const types = (await admin.get(`/api/days/${sc.dayId}/timer-events`)).body.events.map((e: any) => e.type);
    for (const t of ['started', 'restarted', 'finished_early', 'adjusted', 'paused', 'time_up']) expect(types, t).toContain(t);
  });

  it('votação empatada aparece como empate na conferência', async () => {
    const c05 = (await ana.get(`/api/groups/${sc.groups['C-05']}/review`)).body.consolidation;
    expect(c05.blockers).toEqual([]);
    expect(c05.votes[0].tally.decision.kind).toBe('tie');
  });

  it('o grupo aguardando fechamento pode ser fechado e gera o PDF', async () => {
    const r = await ana.post(`/api/groups/${sc.groups['C-05']}/close`, { confirm: true });
    expect(r.status).toBe(200);
    const pdf = await ana.get(`/api/groups/${sc.groups['C-05']}/report.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdfText(pdf.raw)).toContain('C-05');
    expect((await entryOf('C-05')).status).toBe('finalized');
  });

  it('o grupo com fichas pendentes não fecha e lista as pendências de cada avaliador, inclusive o extra', async () => {
    const r = await ana.post(`/api/groups/${sc.groups['C-06']}/close`, { confirm: true });
    expect(r.status).toBe(400);
    const blockers: string[] = r.body.details;
    expect(blockers.some((b) => b.includes('Bruno') && /rascunho/.test(b))).toBe(true);
    expect(blockers.some((b) => b.includes('Fábio'))).toBe(true);
    // O avaliador extra vê somente o grupo dele e já tem a ficha aberta.
    const fws = (await fabio.get(`/api/days/${sc.dayId}/workspace`)).body;
    expect(fws.entries.map((e: any) => e.code)).toEqual(['C-06']);
    expect(fws.entries[0].myEvaluationId).toBeTruthy();
  });

  it('o grupo em andamento não pode ser fechado enquanto o cronômetro está ativo', async () => {
    const r = await ana.post(`/api/groups/${sc.groups['C-07']}/close`, { confirm: true });
    expect(r.status).toBe(400);
    expect(r.body.details).toContain('A apresentação ainda está em andamento: encerre o cronômetro antes de fechar.');
  });

  it('não inicia outro grupo com uma apresentação pausada nem reinicia um grupo fechado', async () => {
    expect((await ana.post(`/api/days/${sc.dayId}/timer/start`, { entryId: sc.entries['C-08'] })).status).toBe(409);
    expect((await ana.post(`/api/days/${sc.dayId}/timer/finish`, {})).status).toBe(200);
    expect((await ana.post(`/api/days/${sc.dayId}/select`, { entryId: sc.entries['C-01'] })).status).toBe(200);
    const restart = await ana.post(`/api/days/${sc.dayId}/timer/restart`, { reason: 'tentativa indevida' });
    expect(restart.status).toBe(409);
    expect(restart.body.code).toBe('CLOSED');
    // O grupo que aguarda pode ser iniciado normalmente.
    expect((await ana.post(`/api/days/${sc.dayId}/select`, { entryId: sc.entries['C-08'] })).status).toBe(200);
    expect((await ana.post(`/api/days/${sc.dayId}/timer/start`, { entryId: sc.entries['C-08'] })).status).toBe(200);
  });

  it('as fichas reabertas podem ser reenviadas e o grupo fecha na versão 2', async () => {
    for (const c of [ana, bruno, carla]) {
      const ws = (await c.get(`/api/days/${sc.dayId}/workspace`)).body;
      const id = ws.entries.find((e: any) => e.code === 'C-04').myEvaluationId;
      const form = (await c.get(`/api/evaluations/${id}`)).body;
      expect(form.evaluation.status).toBe('draft');
      expect((await c.post(`/api/evaluations/${id}/submit`, { revision: form.evaluation.revision })).status).toBe(200);
    }
    // O fechamento fica vinculado aos dados conferidos: se algo muda depois da conferência, é recusado.
    const before = (await ana.get(`/api/groups/${sc.groups['C-04']}/review`)).body.reviewToken;
    expect(before).toMatch(/^[0-9a-f]{32}$/);
    expect((await ana.put(`/api/groups/${sc.groups['C-04']}/verdict`, { strengths: 'Texto alterado depois da conferência.' })).status).toBe(200);
    const stale = await ana.post(`/api/groups/${sc.groups['C-04']}/close`, { confirm: true, reviewToken: before });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('REVIEW_STALE');
    const after = (await ana.get(`/api/groups/${sc.groups['C-04']}/review`)).body.reviewToken;
    expect(after).not.toBe(before);
    const r = await ana.post(`/api/groups/${sc.groups['C-04']}/close`, { confirm: true, reviewToken: after });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
  });

  it('o roteiro de preparação aponta o que falta em cada dia', async () => {
    const r = (await admin.get(`/api/events/${sc.eventId}/readiness`)).body;
    expect(r.summary.ready).toBe(false);
    const groups = r.checks.find((c: any) => c.key === 'groups');
    expect(groups).toMatchObject({ status: 'warn', tab: 'distribuicao' });
    expect(groups.detail).toContain('C-09');
    const ok = r.days.find((d: any) => d.dayId === sc.dayId);
    expect(ok.checks.every((c: any) => c.status === 'ok')).toBe(true);
    expect(ok.progress.total).toBe(8);
    const bad = r.days.find((d: any) => d.dayId === sc.incompleteDayId);
    const status = Object.fromEntries(bad.checks.map((c: any) => [c.key, c.status]));
    expect(status).toMatchObject({ primary: 'todo', profile: 'todo', evaluators: 'todo', schedule: 'ok' });
    expect((await ana.get(`/api/events/${sc.eventId}/readiness`)).status).toBe(403);
  });
});

describe('correções do processo', () => {
  it('avaliador dispensado que também enviou não é contado em dobro', async () => {
    // C-06: Ana enviou; Bruno rascunho; Carla e Fábio pendentes. Dispensar Ana (que enviou) não deve
    // fazer o grupo parecer completo.
    const ws = (await ana.get(`/api/days/${sc.dayId}/workspace`)).body;
    const anaEval = ws.entries.find((e: any) => e.code === 'C-06').myEvaluationId;
    expect((await admin.post(`/api/groups/${sc.groups['C-06']}/exceptions`, { kind: 'evaluator_absent', evaluationId: anaEval, reason: 'teste de contagem' })).status).toBe(200);
    expect((await entryOf('C-06')).status).toBe('started');
  });

  it('atribuição duplicada responde com mensagem clara; edição valida a rubrica', async () => {
    const list = (await admin.get(`/api/days/${sc.dayId}/assignments`)).body.assignments;
    const brunoA = list.find((a: any) => a.userName.includes('Bruno') && a.groupId === null);
    const dup = await admin.post(`/api/days/${sc.dayId}/assignments`, { userId: sc.users.bruno, rubricVersionId: brunoA.rubricVersionId, groupId: null });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/já avalia todos os grupos/);
    expect((await admin.patch(`/api/assignments/${brunoA.id}`, { rubricVersionId: 999999 })).status).toBe(400);
    expect((await admin.patch(`/api/assignments/999999`, { rubricVersionId: brunoA.rubricVersionId })).status).toBe(404);
  });

  it('a atribuição do professor primário não é removida sem trocar o primário', async () => {
    const list = (await admin.get(`/api/days/${sc.dayId}/assignments`)).body.assignments;
    const anaA = list.find((a: any) => a.userName.includes('Ana') && a.groupId === null);
    const r = await admin.del(`/api/assignments/${anaA.id}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRIMARY');
  });

  it('avaliador designado depois do início recebe a ficha ao abrir a conferência', async () => {
    // C-10 está no dia incompleto: designa primário e perfil, inicia, e só depois inclui um avaliador.
    const evs = (await admin.get('/api/events')).body.events.find((e: any) => e.id === sc.eventId);
    const rubricId = (await admin.get(`/api/days/${sc.dayId}/assignments`)).body.assignments[0].rubricVersionId;
    const d2 = evs.days.find((d: any) => d.id === sc.incompleteDayId);
    const profileId = evs.days.find((d: any) => d.id === sc.dayId).defaultProfileId;
    expect(
      (
        await admin.put(`/api/days/${sc.incompleteDayId}`, {
          label: d2.label,
          date: d2.date,
          startTime: d2.startTime,
          endTime: d2.endTime,
          room: 'Sala 2',
          gapMinutes: d2.gapMinutes,
          defaultProfileId: profileId,
          breaks: [],
        })
      ).status,
    ).toBe(200);
    expect((await admin.put(`/api/days/${sc.incompleteDayId}/primary`, { userId: sc.users.ana, rubricVersionId: rubricId })).status).toBe(200);
    const entry = (await admin.get(`/api/days/${sc.incompleteDayId}/schedule`)).body.entries[0];
    expect((await ana.post(`/api/days/${sc.incompleteDayId}/timer/start`, { entryId: entry.entryId })).status).toBe(200);
    expect((await admin.post(`/api/days/${sc.incompleteDayId}/assignments`, { userId: sc.users.carla, rubricVersionId: rubricId, groupId: null })).status).toBe(200);
    const review = (await admin.get(`/api/groups/${sc.groups['C-10']}/review`)).body.consolidation;
    const carlaRow = review.evaluators.find((e: any) => e.name.includes('Carla'));
    expect(carlaRow.evaluationId).toBeTruthy();
    expect(carlaRow.status).toBe('draft');
  });
});

describe('telão: dia ativado pelo primário, sem seleção na tela', () => {
  it('o primeiro "Iniciar" ativou o dia automaticamente; iniciar em outro dia não toma o telão', async () => {
    // O C-08 foi iniciado (dia de cenários) quando nenhum dia estava ativo; depois o C-10 (outro dia) também.
    const d = (await env.anon.get('/api/public/display')).body;
    expect(d.display.dayId).toBe(sc.dayId);
    expect(d.display.eventName).toBe('Banca de Cenários de Teste — DEMONSTRAÇÃO');
  });

  it('só o primário do dia ou o administrador ativa/desativa', async () => {
    expect((await bruno.post(`/api/days/${sc.dayId}/display`, { active: false })).status).toBe(403);
    expect((await env.anon.post(`/api/days/${sc.dayId}/display`, { active: false })).status).toBe(401);
    expect((await ana.post(`/api/days/${sc.dayId}/display`, { active: false })).status).toBe(200);
    expect((await env.anon.get('/api/public/display')).body.display).toBeNull();
    expect((await ana.post(`/api/days/${sc.dayId}/display`, { active: true })).status).toBe(200);
    expect((await env.anon.get('/api/public/display')).body.display.dayId).toBe(sc.dayId);
  });

  it('um dia por vez: ativar outro dia substitui o anterior, e o primário vê que o telão está em outro dia', async () => {
    expect((await admin.post(`/api/days/${sc.incompleteDayId}/display`, { active: true })).status).toBe(200);
    expect((await env.anon.get('/api/public/display')).body.display.dayId).toBe(sc.incompleteDayId);
    const n = await env.db.one<{ n: number }>('select count(*)::int as n from event_days where display_active_at is not null');
    expect(n!.n).toBe(1);
    const ws = (await ana.get(`/api/days/${sc.dayId}/workspace`)).body;
    expect(ws.display.active).toBe(false);
    expect(ws.display.other.dayId).toBe(sc.incompleteDayId);
    // Desativar um dia que não está no telão não mexe no telão.
    expect((await ana.post(`/api/days/${sc.dayId}/display`, { active: false })).body.changed).toBe(false);
    expect((await env.anon.get('/api/public/display')).body.display.dayId).toBe(sc.incompleteDayId);
    expect((await ana.post(`/api/days/${sc.dayId}/display`, { active: true })).status).toBe(200);
    expect((await ana.get(`/api/days/${sc.dayId}/workspace`)).body.display.active).toBe(true);
  });

  it('banca sem exibição pública: o telão sem login fica em "Aguardando" (restrito); com login de telão, exibe', async () => {
    await env.db.query('update events set public_display = false where id = $1', [sc.eventId]);
    const anon = (await env.anon.get('/api/public/display')).body;
    expect(anon).toEqual({ display: null, restricted: true });
    const telao = await env.login('telao@demo.banca');
    expect((await telao.get('/api/public/display')).body.display.dayId).toBe(sc.dayId);
    await env.db.query('update events set public_display = true where id = $1', [sc.eventId]);
  });

  it('ativações ficam na auditoria', async () => {
    const rows = await env.db.query<{ action: string }>("select action from audit_logs where action like 'display.%'");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['display.activated', 'display.deactivated']));
  });
});
