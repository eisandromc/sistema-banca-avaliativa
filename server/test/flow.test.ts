import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, pdfText, type Client, type TestEnv } from './helpers.ts';
import { computeTimer, formatClock } from '../../shared/timer.ts';
import { TimerService } from '../src/services/timer.ts';
import { RealtimeHub } from '../src/realtime/hub.ts';

const MIN = 60_000;

let env: TestEnv;
let admin: Client, ana: Client, bruno: Client, carla: Client, telao: Client;
let dayId: number;
let entries: Array<{ entryId: number; groupId: number; code: string }>;

async function live(c: Client = ana) {
  const r = await c.get(`/api/days/${dayId}/live`);
  expect(r.status).toBe(200);
  return r.body;
}

function viewOf(state: any) {
  return computeTimer(state.timer.stages, state.timer.elapsedMs, state.timer.status);
}

async function myCurrentEvaluation(c: Client) {
  const ws = await c.get(`/api/days/${dayId}/workspace`);
  expect(ws.status).toBe(200);
  return ws.body.current.myEvaluationId as number;
}

async function fillAndSubmit(c: Client, evalId: number, value: (i: number) => number, vote: string = 'Indicar') {
  const form = (await c.get(`/api/evaluations/${evalId}`)).body;
  const opt = form.questions[0].options.find((o: any) => o.label === vote);
  const save = await c.put(`/api/evaluations/${evalId}/draft`, {
    revision: form.evaluation.revision,
    generalComment: 'Observação geral de teste.',
    scores: form.rubric.criteria.map((cr: any, i: number) => ({ criterionId: cr.id, score: value(i), comment: cr.commentEnabled ? `Justificativa ${i}` : undefined })),
    votes: [{ questionId: form.questions[0].id, optionId: opt.id }],
  });
  expect(save.status, JSON.stringify(save.body)).toBe(200);
  const sub = await c.post(`/api/evaluations/${evalId}/submit`, { revision: save.body.revision });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  return { form, revision: sub.body.revision };
}

beforeAll(async () => {
  env = await setupEnv();
  dayId = env.seed.dayId;
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
  bruno = await env.login('bruno@demo.banca');
  carla = await env.login('carla@demo.banca');
  telao = await env.login('telao@demo.banca');
  const sch = await admin.get(`/api/days/${dayId}/schedule`);
  entries = sch.body.entries;
});

afterAll(async () => env.close());

describe('autenticação e proteção', () => {
  it('rejeita senha errada e requisição sem cabeçalho CSRF', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-banca-csrf': '1' }, payload: { email: 'ana@demo.banca', password: 'errada' } });
    expect(r.statusCode).toBe(401);
    const csrf = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@demo.banca', password: 'demo1234' } });
    expect(csrf.statusCode).toBe(403);
  });

  it('senhas são armazenadas com hash scrypt', async () => {
    const u = await env.db.one<any>("select password_hash from users where email = 'ana@demo.banca'");
    expect(u.password_hash).toMatch(/^scrypt\$/);
    expect(u.password_hash).not.toContain('demo1234');
  });

  it('rotas administrativas exigem administrador', async () => {
    expect((await env.anon.get('/api/users')).status).toBe(401);
    expect((await ana.get('/api/users')).status).toBe(403);
    expect((await admin.get('/api/users')).status).toBe(200);
  });
});

describe('cadastro e cronograma', () => {
  it('administrador cadastra banca, dia com intervalo e grupos; reordena e recalcula horários', async () => {
    const ev = await admin.post('/api/events', { name: 'Banca Teste (fictícia)', institution: 'Escola Fictícia' });
    expect(ev.status).toBe(200);
    const profiles = (await admin.get('/api/profiles')).body.profiles;
    const day = await admin.post(`/api/events/${ev.body.id}/days`, {
      label: 'Dia A',
      date: '2026-11-03',
      startTime: '07:30',
      endTime: '12:30',
      gapMinutes: 5,
      defaultProfileId: profiles[0].id,
      breaks: [{ label: 'Intervalo', start: '10:00', end: '10:20' }],
    });
    expect(day.status).toBe(200);
    const bad = await admin.post(`/api/events/${ev.body.id}/days`, {
      date: '2026-11-04',
      startTime: '07:30',
      endTime: '12:30',
      breaks: [
        { label: 'A', start: '09:00', end: '09:30' },
        { label: 'B', start: '09:15', end: '09:40' },
      ],
    });
    expect(bad.status).toBe(400);

    const ids: number[] = [];
    for (const [code, cls, title] of [
      ['T1', '2º B', 'Projeto Zeta'],
      ['T2', '2º A', 'Projeto Alfa'],
      ['T3', '1º C', 'Projeto Meio'],
    ]) {
      const g = await admin.post(`/api/events/${ev.body.id}/groups`, { code, className: cls, title, students: ['Aluno Fictício X'] });
      expect(g.status).toBe(200);
      const e = await admin.post(`/api/days/${day.body.id}/schedule`, { groupId: g.body.id });
      expect(e.status).toBe(200);
      ids.push(e.body.id);
    }
    // grupo sem aluno é rejeitado; código duplicado também
    expect((await admin.post(`/api/events/${ev.body.id}/groups`, { code: 'T9', title: 'x', students: [] })).status).toBe(400);
    expect((await admin.post(`/api/events/${ev.body.id}/groups`, { code: 'T1', title: 'x', students: ['a'] })).status).toBe(409);

    let sch = (await admin.get(`/api/days/${day.body.id}/schedule`)).body;
    expect(sch.entries.map((e: any) => e.predictedStart)).toEqual(['07:30', '07:55', '08:20']);

    const reordered = await admin.put(`/api/days/${day.body.id}/schedule/order`, { entryIds: [ids[2], ids[0], ids[1]] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.entries.map((e: any) => e.code)).toEqual(['T3', 'T1', 'T2']);

    const sorted = await admin.post(`/api/days/${day.body.id}/schedule/sort`, { by: 'class' });
    expect(sorted.body.entries.map((e: any) => e.className)).toEqual(['1º C', '2º A', '2º B']);
    const byTitle = await admin.post(`/api/days/${day.body.id}/schedule/sort`, { by: 'title' });
    expect(byTitle.body.entries.map((e: any) => e.title)).toEqual(['Projeto Alfa', 'Projeto Meio', 'Projeto Zeta']);

    // ordem desatualizada é rejeitada (conflito de atualização)
    expect((await admin.put(`/api/days/${day.body.id}/schedule/order`, { entryIds: [ids[0], ids[1]] })).status).toBe(409);

    // intervalo empurra apresentação que o atravessaria
    await admin.put(`/api/days/${day.body.id}`, {
      label: 'Dia A',
      date: '2026-11-03',
      startTime: '07:30',
      endTime: '08:40',
      gapMinutes: 5,
      defaultProfileId: profiles[0].id,
      breaks: [{ label: 'Intervalo', start: '08:00', end: '08:10' }],
    });
    sch = (await admin.get(`/api/days/${day.body.id}/schedule`)).body;
    expect(sch.entries[1].predictedStart).toBe('08:10');
    expect(sch.entries[1].movedAfterBreak).toBe('Intervalo');
    expect(sch.entries[2].overflow).toBe(true);
    expect(sch.warnings.join(' ')).toMatch(/ultrapassam/);
  });
});

describe('cronômetro e abertura das fichas', () => {
  it('antes de iniciar, o perfil 10+5+5 mostra 20:00 e não há fichas', async () => {
    await ana.post(`/api/days/${dayId}/select`, { entryId: entries[0]!.entryId });
    const s = await live(env.anon);
    expect(s.timer).toBeNull();
    const total = s.plannedStages.reduce((a: number, x: any) => a + x.durationSeconds, 0);
    expect(formatClock(total * 1000)).toBe('20:00');
    expect(s.current.code).toBe('Grupo 01');
    expect(s.current.students).toBeNull(); // nomes ocultos por padrão na projeção
    const ws = (await bruno.get(`/api/days/${dayId}/workspace`)).body;
    expect(ws.current.myEvaluationId).toBeNull();
  });

  it('avaliador comum, telão e anônimo não controlam o cronômetro (nem pela API)', async () => {
    for (const c of [bruno, carla, telao]) {
      expect((await c.post(`/api/days/${dayId}/timer/start`, { entryId: entries[0]!.entryId })).status).toBe(403);
      expect((await c.post(`/api/days/${dayId}/select`, { entryId: entries[1]!.entryId })).status).toBe(403);
    }
    expect((await env.anon.post(`/api/days/${dayId}/timer/start`, { entryId: entries[0]!.entryId })).status).toBe(401);
  });

  it('iniciar abre as fichas de todos os designados, marca Iniciado e é idempotente', async () => {
    const r1 = await ana.post(`/api/days/${dayId}/timer/start`, { entryId: entries[0]!.entryId });
    expect(r1.status).toBe(200);
    expect(r1.body.alreadyStarted).toBe(false);
    const r2 = await ana.post(`/api/days/${dayId}/timer/start`, { entryId: entries[0]!.entryId });
    expect(r2.status).toBe(200);
    expect(r2.body.alreadyStarted).toBe(true);
    const sessions = await env.db.query('select * from timer_sessions where entry_id = $1', [entries[0]!.entryId]);
    expect(sessions).toHaveLength(1);
    const evals = await env.db.query('select * from evaluations where group_id = $1', [entries[0]!.groupId]);
    expect(evals).toHaveLength(3);

    const sch = (await admin.get(`/api/days/${dayId}/schedule`)).body;
    const e0 = sch.entries[0];
    expect(e0.started).toBe(true);
    expect(e0.startedAt).toBe(new Date(env.clock.now()).toISOString());
    expect(e0.statusLabel).toBe('Em andamento');

    for (const c of [ana, bruno, carla]) expect(await myCurrentEvaluation(c)).toBeGreaterThan(0);
  });

  it('professores com rubricas diferentes recebem apenas seus critérios', async () => {
    const fa = (await ana.get(`/api/evaluations/${await myCurrentEvaluation(ana)}`)).body;
    const fc = (await carla.get(`/api/evaluations/${await myCurrentEvaluation(carla)}`)).body;
    expect(fa.rubric.criteria.map((c: any) => c.title)).toEqual(['Domínio técnico', 'Funcionamento da demonstração', 'Organização do projeto', 'Respostas às perguntas']);
    expect(fc.rubric.criteria.map((c: any) => c.title)).toEqual(['Clareza da apresentação', 'Uso do tempo', 'Material visual']);
    expect(fa.questions[0].options.map((o: any) => o.label)).toEqual(['Indicar', 'Não indicar', 'Abster-se']);
  });

  it('ficha de outro professor é inacessível por URL/API', async () => {
    const anaEval = await myCurrentEvaluation(ana);
    expect((await bruno.get(`/api/evaluations/${anaEval}`)).status).toBe(403);
    expect((await bruno.put(`/api/evaluations/${anaEval}/draft`, { revision: 1, scores: [] })).status).toBe(403);
    expect((await env.anon.get(`/api/evaluations/${anaEval}`)).status).toBe(401);
    expect((await telao.get(`/api/evaluations/${anaEval}`)).status).toBe(403);
    expect((await telao.get(`/api/days/${dayId}/workspace`)).status).toBe(403);
  });

  it('etapas mudam aos 10 e aos 15 min; pausa congela; estado persiste após "recarregar"', async () => {
    env.clock.advance(10 * MIN);
    await env.app.ctx.timer.tick();
    let v = viewOf(await live());
    expect(v.stage?.name).toBe('Demonstração');
    expect(formatClock(v.totalRemainingMs)).toBe('10:00');

    await ana.post(`/api/days/${dayId}/timer/pause`);
    expect((await ana.post(`/api/days/${dayId}/timer/pause`)).body.noop).toBe(true);
    env.clock.advance(3 * MIN);
    v = viewOf(await live());
    expect(v.status).toBe('paused');
    expect(formatClock(v.totalRemainingMs)).toBe('10:00');
    await ana.post(`/api/days/${dayId}/timer/resume`);

    env.clock.advance(5 * MIN);
    await env.app.ctx.timer.tick();
    v = viewOf(await live());
    expect(v.stage?.name).toBe('Perguntas e considerações');
    expect(formatClock(v.totalRemainingMs)).toBe('05:00');

    // "Recarregar": um novo serviço lendo o mesmo banco vê exatamente o mesmo tempo.
    const fresh = new TimerService(env.db, new RealtimeHub(), 1, env.clock.now);
    const again = await fresh.liveState(dayId);
    expect(again.timer!.elapsedMs).toBe((await live()).timer.elapsedMs);
    expect(again.timer!.sessionId).toBe((await live()).timer.sessionId);

    const evs = await env.db.query<any>("select type from timer_events where type in ('stage_changed','paused','resumed') order by id");
    expect(evs.map((e) => e.type)).toEqual(['stage_changed', 'paused', 'resumed', 'stage_changed']);
  });

  it('ao fim dos 20 min mostra TEMPO ENCERRADO sem finalizar avaliações', async () => {
    env.clock.advance(6 * MIN);
    await env.app.ctx.timer.tick();
    const s = await live();
    const v = viewOf(s);
    expect(s.timer.status).toBe('ended');
    expect(v.timeUp).toBe(true);
    expect(v.level).toBe('over');
    expect(formatClock(v.totalRemainingMs)).toBe('00:00');
    const evals = await env.db.query<any>('select status from evaluations where group_id = $1', [entries[0]!.groupId]);
    expect(evals.every((e) => e.status === 'draft')).toBe(true);
    // não reinicia por novo "Iniciar"
    expect((await ana.post(`/api/days/${dayId}/timer/start`, { entryId: entries[0]!.entryId })).status).toBe(409);
  });

  it('ajuste de tempo exige justificativa e fica auditado', async () => {
    const stages = (await live()).timer.stages.map((x: any) => ({ ...x }));
    stages[2].durationSeconds = 360;
    expect((await ana.post(`/api/days/${dayId}/timer/adjust`, { stages, reason: '' })).status).toBe(400);
    const r = await ana.post(`/api/days/${dayId}/timer/adjust`, { stages, reason: 'Banca pediu mais 1 min de perguntas' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('paused'); // havia esgotado; o ajuste ampliou → pausado
    const v = viewOf(await live());
    expect(formatClock(v.totalRemainingMs)).toBe('01:00');
    const logs = (await admin.get('/api/audit?action=timer.adjusted')).body.logs;
    expect(logs[0].details.reason).toMatch(/mais 1 min/);
    await ana.post(`/api/days/${dayId}/timer/finish`, { reason: 'fim' });
  });
});

describe('avaliação, votação e fechamento', () => {
  it('nota zero é válida, vazio não; envio bloqueado com obrigatórios ausentes', async () => {
    const id = await myCurrentEvaluation(bruno);
    const form = (await bruno.get(`/api/evaluations/${id}`)).body;
    const crit = form.rubric.criteria;
    const save = await bruno.put(`/api/evaluations/${id}/draft`, {
      revision: form.evaluation.revision,
      scores: [
        { criterionId: crit[0].id, score: 0 },
        { criterionId: crit[1].id, score: null },
      ],
    });
    expect(save.status).toBe(200);
    const stored = await env.db.query<any>('select criterion_id, score from evaluation_scores where evaluation_id = $1 order by criterion_id', [id]);
    expect(stored.find((s) => s.criterion_id === crit[0].id).score).toBe(0);
    expect(stored.find((s) => s.criterion_id === crit[1].id).score).toBeNull();

    const sub = await bruno.post(`/api/evaluations/${id}/submit`, { revision: save.body.revision });
    expect(sub.status).toBe(400);
    expect(sub.body.details.join(' ')).toMatch(/Funcionamento da demonstração/);
    expect(sub.body.details.join(' ')).toMatch(/Voto obrigatório/);

    // nota fora da escala/incremento
    const badScore = await bruno.put(`/api/evaluations/${id}/draft`, { revision: save.body.revision, scores: [{ criterionId: crit[0].id, score: 7.3 }] });
    expect(badScore.status).toBe(400);
  });

  it('revisão desatualizada gera conflito (edição em outro dispositivo)', async () => {
    const id = await myCurrentEvaluation(bruno);
    const r = await bruno.put(`/api/evaluations/${id}/draft`, { revision: 1, scores: [] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('REVISION_CONFLICT');
  });

  it('voto não duplica: regravar substitui; opção de outra pergunta é recusada', async () => {
    const id = await myCurrentEvaluation(carla);
    const form = (await carla.get(`/api/evaluations/${id}`)).body;
    const q = form.questions[0];
    let rev = form.evaluation.revision;
    for (const label of ['Indicar', 'Não indicar']) {
      const r = await carla.put(`/api/evaluations/${id}/draft`, { revision: rev, scores: [], votes: [{ questionId: q.id, optionId: q.options.find((o: any) => o.label === label).id }] });
      expect(r.status).toBe(200);
      rev = r.body.revision;
    }
    const votes = await env.db.query<any>('select * from votes where evaluation_id = $1', [id]);
    expect(votes).toHaveLength(1);
    expect((await carla.put(`/api/evaluations/${id}/draft`, { revision: rev, scores: [], votes: [{ questionId: q.id, optionId: 99999 }] })).status).toBe(400);
  });

  it('fechamento é bloqueado enquanto houver fichas pendentes', async () => {
    const r = await ana.get(`/api/groups/${entries[0]!.groupId}/review`);
    expect(r.status).toBe(200);
    expect(r.body.consolidation.blockers.length).toBeGreaterThan(0);
    const c = await ana.post(`/api/groups/${entries[0]!.groupId}/close`, { confirm: true });
    expect(c.status).toBe(400);
    expect(await env.db.query('select * from evaluation_closures')).toHaveLength(0);
  });

  it('avaliador não primário não acessa conferência nem PDF', async () => {
    expect((await bruno.get(`/api/groups/${entries[0]!.groupId}/review`)).status).toBe(403);
    expect((await bruno.post(`/api/groups/${entries[0]!.groupId}/close`, { confirm: true })).status).toBe(403);
  });

  it('todos enviam; envio repetido é idempotente; consolidação confere com o cálculo manual', async () => {
    const a = await fillAndSubmit(ana, await myCurrentEvaluation(ana), (i) => [8, 9, 7, 10][i]!, 'Indicar');
    const again = await ana.post(`/api/evaluations/${await myCurrentEvaluation(ana)}/submit`, { revision: a.revision });
    expect(again.status).toBe(200);
    expect(again.body.alreadySubmitted).toBe(true);
    await fillAndSubmit(bruno, await myCurrentEvaluation(bruno), (i) => [0, 5, 5, 5][i]!, 'Não indicar');
    await fillAndSubmit(carla, await myCurrentEvaluation(carla), (i) => [10, 8, 6][i]!, 'Indicar');

    // Ana técnica: (0.8*3 + 0.9*3 + 0.7*2 + 1.0*2)/10*100 = 85
    // Bruno técnica: (0*3 + 0.5*3 + 0.5*2 + 0.5*2)/10*100 = 35
    // Carla comunicação: (1.0*2 + 0.8*1 + 0.6*1)/4*100 = 85
    const review = (await ana.get(`/api/groups/${entries[0]!.groupId}/review`)).body.consolidation;
    const scores = Object.fromEntries(review.evaluators.map((e: any) => [e.name, e.teacherScore]));
    expect(scores['Profa. Ana Exemplo (Demo)']).toBeCloseTo(85, 9);
    expect(scores['Prof. Bruno Modelo (Demo)']).toBeCloseTo(35, 9);
    expect(scores['Profa. Carla Fictícia (Demo)']).toBeCloseTo(85, 9);
    expect(review.finalScore).toBeCloseTo(205 / 3, 9);
    expect(review.blockers).toEqual([]);
    const vote = review.votes[0];
    expect(vote.tally.counts.find((c: any) => c.label === 'Indicar').count).toBe(2);
    expect(vote.tally.decision).toMatchObject({ kind: 'winner', label: 'Indicar' });
    expect(vote.ballots).toHaveLength(3);

    const sch = (await admin.get(`/api/days/${dayId}/schedule`)).body;
    expect(sch.entries[0].statusLabel).toBe('Aguardando fechamento');
  });

  it('fecha uma única vez (sem duplicidade) e bloqueia edição', async () => {
    const [c1, c2] = await Promise.all([
      ana.post(`/api/groups/${entries[0]!.groupId}/close`, { confirm: true }),
      ana.post(`/api/groups/${entries[0]!.groupId}/close`, { confirm: true }),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 409]);
    expect(await env.db.query('select * from evaluation_closures')).toHaveLength(1);
    const id = await myCurrentEvaluation(carla);
    const form = (await carla.get(`/api/evaluations/${id}`)).body;
    expect(form.evaluation.editable).toBe(false);
    expect((await carla.put(`/api/evaluations/${id}/draft`, { revision: form.evaluation.revision, scores: [] })).status).toBe(409);
    const sch = (await admin.get(`/api/days/${dayId}/schedule`)).body;
    expect(sch.entries[0].statusLabel).toBe('Finalizado');
    expect(sch.entries[0].started).toBe(true);
  });

  it('PDF: somente autorizados; conteúdo fiel à consolidação', async () => {
    const url = `/api/groups/${entries[0]!.groupId}/report.pdf`;
    expect((await env.anon.get(url)).status).toBe(401);
    expect((await bruno.get(url)).status).toBe(403);
    expect((await telao.get(url)).status).toBe(403);
    const r = await ana.get(url);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.raw.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(r.raw);
    expect(text).toContain('Grupo 01');
    expect(text).toContain('Horta Inteligente com Sensores');
    expect(text).toContain('68,33 / 100');
    expect(text).toContain('85,00');
    expect(text).toContain('35,00');
    expect(text).toContain('Justificativa 0');
    expect(text).toContain('Indicar');
    expect(text).toContain('Fechamento v1');
    expect((await admin.get(url)).status).toBe(200);
  });

  it('reabertura só por administrador, com motivo; gera nova versão e preserva histórico', async () => {
    const g = entries[0]!.groupId;
    expect((await ana.post(`/api/groups/${g}/reopen`, { reason: 'Correção solicitada pela coordenação' })).status).toBe(403);
    expect((await admin.post(`/api/groups/${g}/reopen`, { reason: 'curto' })).status).toBe(400);
    expect((await admin.post(`/api/groups/${g}/reopen`, { reason: 'Correção de nota solicitada pela coordenação' })).status).toBe(200);
    // fichas voltam a rascunho; Bruno corrige e reenvia
    await fillAndSubmit(bruno, await myCurrentEvaluation(bruno), () => 6, 'Indicar');
    await fillAndSubmit(ana, await myCurrentEvaluation(ana), (i) => [8, 9, 7, 10][i]!, 'Indicar');
    await fillAndSubmit(carla, await myCurrentEvaluation(carla), (i) => [10, 8, 6][i]!, 'Indicar');
    const c = await ana.post(`/api/groups/${g}/close`, { confirm: true });
    expect(c.status).toBe(200);
    expect(c.body.version).toBe(2);
    const review = (await admin.get(`/api/groups/${g}/review`)).body;
    expect(review.history.map((h: any) => h.version)).toEqual([2, 1]);
    expect(review.history[1].reopenReason).toMatch(/coordenação/);
    const v1 = await ana.get(`/api/groups/${g}/report.pdf?version=1`);
    expect(pdfText(v1.raw)).toContain('68,33 / 100');
    const v2 = await ana.get(`/api/groups/${g}/report.pdf`);
    expect(pdfText(v2.raw)).toContain('Fechamento v2');
    expect(pdfText(v2.raw)).toContain('76,67 / 100'); // (85 + 60 + 85) / 3
    const audit = (await admin.get('/api/audit?action=closure.')).body.logs.map((l: any) => l.action);
    expect(audit).toEqual(expect.arrayContaining(['closure.closed', 'closure.reopened']));
  });
});

describe('troca de grupo e exceções', () => {
  it('troca para o Grupo 02 sem perder o Grupo 01; impede dois grupos ativos', async () => {
    const g2 = entries[1]!;
    expect((await ana.post(`/api/days/${dayId}/select`, { entryId: g2.entryId })).status).toBe(200);
    expect((await ana.post(`/api/days/${dayId}/timer/start`, { entryId: g2.entryId })).status).toBe(200);
    // tentar voltar ao Grupo 01 com o 02 em andamento exige confirmação + justificativa
    const noConfirm = await ana.post(`/api/days/${dayId}/select`, { entryId: entries[0]!.entryId });
    expect(noConfirm.status).toBe(409);
    expect(noConfirm.body.code).toBe('CONFIRM_REQUIRED');
    const active = await env.db.query("select * from timer_sessions where day_id = $1 and status in ('running','paused')", [dayId]);
    expect(active).toHaveLength(1);
    // o Grupo 01 segue fechado, com seu PDF
    expect((await ana.get(`/api/groups/${entries[0]!.groupId}/report.pdf`)).status).toBe(200);
  });

  it('administrador dispensa avaliador ausente com motivo; exceção aparece na consolidação', async () => {
    const g2 = entries[1]!;
    await fillAndSubmit(ana, await myCurrentEvaluation(ana), () => 9);
    await fillAndSubmit(carla, await myCurrentEvaluation(carla), () => 7);
    const brunoEval = (await env.db.one<any>('select id from evaluations where group_id = $1 and user_id = $2', [g2.groupId, env.seed.users.bruno]))!.id;
    expect((await ana.post(`/api/groups/${g2.groupId}/exceptions`, { kind: 'evaluator_absent', evaluationId: brunoEval, reason: 'Ausente' })).status).toBe(403);
    expect((await ana.post(`/api/groups/${g2.groupId}/close`, { confirm: true })).status).toBe(400);
    const x = await admin.post(`/api/groups/${g2.groupId}/exceptions`, { kind: 'evaluator_absent', evaluationId: brunoEval, reason: 'Docente ausente por motivo de saúde' });
    expect(x.status).toBe(200);
    // Com a apresentação ainda em andamento, o fechamento fica bloqueado até encerrar o cronômetro.
    let review = (await ana.get(`/api/groups/${g2.groupId}/review`)).body.consolidation;
    expect(review.blockers).toEqual(['A apresentação ainda está em andamento: encerre o cronômetro antes de fechar.']);
    expect((await ana.post(`/api/days/${dayId}/timer/finish`, {})).status).toBe(200);
    review = (await ana.get(`/api/groups/${g2.groupId}/review`)).body.consolidation;
    expect(review.blockers).toEqual([]);
    expect(review.countedEvaluators).toBe(2);
    expect(review.finalScore).toBeCloseTo(80, 9);
    const c = await ana.post(`/api/groups/${g2.groupId}/close`, { confirm: true });
    expect(c.status).toBe(200);
    const text = pdfText((await ana.get(`/api/groups/${g2.groupId}/report.pdf`)).raw);
    expect(text).toContain('Docente ausente por motivo de saúde');
    const batch = await ana.get(`/api/days/${dayId}/report.pdf`);
    expect(batch.status).toBe(200);
    expect(pdfText(batch.raw)).toContain('Grupo 02');
  });

  it('rubrica usada não pode ser alterada retroativamente (exige nova versão)', async () => {
    const rubrics = (await admin.get('/api/rubrics')).body.templates;
    const v = rubrics[0].versions[0];
    const body = {
      title: v.title,
      scaleMin: 0,
      scaleMax: 10,
      scaleStep: 0.5,
      normalization: null,
      criteria: v.criteria.map((c: any) => ({ title: c.title, weight: c.weight + 1, required: c.required })),
    };
    const r = await admin.put(`/api/rubric-versions/${v.id}`, body);
    expect(r.status).toBe(409);
    const nv = await admin.post(`/api/rubric-versions/${v.id}/new-version`, body);
    expect(nv.status).toBe(200);
    expect(nv.body.version).toBe(2);
    // escala não 0–10 sem normalização é recusada
    expect((await admin.post(`/api/rubric-versions/${v.id}/new-version`, { ...body, scaleMin: 1, scaleMax: 5, scaleStep: 1 })).status).toBe(400);
  });

  it('docente sem vínculo não acessa o dia nem fichas', async () => {
    const u = await admin.post('/api/users', { name: 'Docente Sem Vínculo (Demo)', email: 'semvinculo@demo.banca', role: 'teacher', password: 'demo12345' });
    expect(u.status).toBe(200);
    const c = await env.login('semvinculo@demo.banca', 'demo12345');
    expect((await c.get(`/api/days/${dayId}/workspace`)).status).toBe(403);
    expect((await c.get(`/api/groups/${entries[0]!.groupId}/review`)).status).toBe(403);
    expect((await c.get(`/api/groups/${entries[0]!.groupId}/report.pdf`)).status).toBe(403);
    expect((await c.get('/api/me/days')).body.days).toEqual([]);
  });
});

describe('professor primário também avalia', () => {
  it('designação exige rubrica, cria a atribuição e o primário recebe a ficha como os demais', async () => {
    const u = await admin.post('/api/users', { name: 'Prof. Primário Novo (Demo)', email: 'primnovo@demo.banca', role: 'teacher', password: 'demo12345' });
    expect(u.status).toBe(200);
    const rubricId = env.seed.rubrics.comunicacao;
    const semRubrica = await admin.put(`/api/days/${dayId}/primary`, { userId: u.body.id });
    expect(semRubrica.status).toBe(400);
    const ok = await admin.put(`/api/days/${dayId}/primary`, { userId: u.body.id, rubricVersionId: rubricId });
    expect(ok.status).toBe(200);
    const assignments = (await admin.get(`/api/days/${dayId}/assignments`)).body.assignments;
    expect(assignments.filter((a: any) => a.userId === u.body.id)).toEqual([expect.objectContaining({ groupId: null, rubricVersionId: rubricId })]);
    // Redesignar com outra rubrica atualiza (não duplica) a atribuição.
    await admin.put(`/api/days/${dayId}/primary`, { userId: u.body.id, rubricVersionId: env.seed.rubrics.tecnica });
    const again = (await admin.get(`/api/days/${dayId}/assignments`)).body.assignments.filter((a: any) => a.userId === u.body.id);
    expect(again).toHaveLength(1);
    expect(again[0].rubricVersionId).toBe(env.seed.rubrics.tecnica);

    const prim = await env.login('primnovo@demo.banca', 'demo12345');
    const ws = (await prim.get(`/api/days/${dayId}/workspace`)).body;
    expect(ws.access.isPrimary).toBe(true);
    expect(ws.access.canControl).toBe(true);
    // Grupos já fechados não ganham ficha nova; o grupo em aberto, sim.
    const g1 = ws.entries.find((e: any) => e.code === 'Grupo 01');
    expect(g1.myEvaluationId).toBeNull();
    await admin.post(`/api/groups/${entries[1]!.groupId}/reopen`, { reason: 'Inclusão do novo professor primário como avaliador' });
    const ws2 = (await prim.get(`/api/days/${dayId}/workspace`)).body;
    const g2 = ws2.entries.find((e: any) => e.code === 'Grupo 02');
    expect(g2.myEvaluationId).toBeGreaterThan(0);
    const form = (await prim.get(`/api/evaluations/${g2.myEvaluationId}`)).body;
    expect(form.rubric.criteria[0].title).toBe('Domínio técnico');
    // Fechamento passa a exigir também a ficha do primário.
    const review = (await prim.get(`/api/groups/${entries[1]!.groupId}/review`)).body.consolidation;
    expect(review.blockers.join(' ')).toMatch(/Prof\. Primário Novo/);
  });
});
