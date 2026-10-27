import type { Database } from './database.ts';
import { hashPassword } from '../auth/password.ts';
import { DEMO_PASSWORD, DEMO_USERS } from './seed.ts';
import { RealtimeHub } from '../realtime/hub.ts';
import { TimerService } from '../services/timer.ts';
import { saveDraft, submitEvaluation } from '../services/evaluations.ts';
import { closeGroup, reopenGroup } from '../services/closure.ts';
import { ensurePiType, installPiRubrics } from '../templates/projetoIntegrador.ts';

/**
 * Banca de CENÁRIOS DE TESTE (dados FICTÍCIOS): um grupo em cada situação possível do processo,
 * criado pelos próprios serviços do sistema (cronômetro, fichas, fechamento, reabertura e exceções),
 * para que cada tela possa ser testada sem precisar montar o caso à mão.
 */
import { GROUP_COLORS } from '../../../shared/groups.ts';

export const SCENARIO_EVENT = 'Banca de Cenários de Teste — DEMONSTRAÇÃO';

export interface ScenarioSeed {
  skipped: false;
  eventId: number;
  dayId: number;
  incompleteDayId: number;
  groups: Record<string, number>;
  entries: Record<string, number>;
  users: Record<'admin' | 'ana' | 'bruno' | 'carla' | 'fabio', number>;
}

/** Cada cenário: código, título (descreve a situação) e a situação esperada no cronograma. */
export const SCENARIOS = [
  ['C-01', 'Finalizado (com reinício do cronômetro registrado)', 'finalized'],
  ['C-02', 'Finalizado com dispensa de avaliador e de critério', 'finalized'],
  ['C-03', 'Reaberto e fechado novamente (versão 2)', 'finalized'],
  ['C-04', 'Reaberto, aguardando correção das fichas', 'started'],
  ['C-05', 'Aguardando fechamento (votação empatada, tempo ajustado)', 'awaiting_closure'],
  ['C-06', 'Iniciado com fichas pendentes e avaliador extra do grupo', 'started'],
  ['C-07', 'Apresentação em andamento (pausada)', 'running'],
  ['C-08', 'Aguardando apresentação', 'waiting'],
] as const;

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export async function seedScenarios(db: Database, opts: { date?: string; now?: number } = {}): Promise<ScenarioSeed | { skipped: true }> {
  if (await db.one('select 1 from events where name = $1', [SCENARIO_EVENT])) return { skipped: true };

  // Relógio próprio: as apresentações ficam espaçadas ao longo da manhã, como num dia real.
  let clock = opts.now ?? Date.now() - 3 * 3600_000;
  const advance = (sec: number) => void (clock += sec * 1000);
  const timer = new TimerService(db, new RealtimeHub(), 1, () => clock);
  const date = opts.date ?? todayIn('America/Sao_Paulo');

  // ---------- Cadastros ----------
  const setup = await db.tx(async (q) => {
    const pw = await hashPassword(DEMO_PASSWORD);
    const user = async (name: string, email: string, role: 'admin' | 'teacher') => {
      const u = await q.one<{ id: number }>('select id from users where lower(email) = $1', [email]);
      if (u) return u.id;
      return (await q.one<{ id: number }>('insert into users (name, email, role, password_hash) values ($1, $2, $3, $4) returning id', [name, email, role, pw]))!.id;
    };
    const users = {
      admin: await user(DEMO_USERS.admin.name, DEMO_USERS.admin.email, 'admin'),
      ana: await user(DEMO_USERS.ana.name, DEMO_USERS.ana.email, 'teacher'),
      bruno: await user(DEMO_USERS.bruno.name, DEMO_USERS.bruno.email, 'teacher'),
      carla: await user(DEMO_USERS.carla.name, DEMO_USERS.carla.email, 'teacher'),
      fabio: await user('Prof. Fábio Teste (Demo)', 'fabio@demo.banca', 'teacher'),
    };

    const profile = (await q.one<{ id: number }>("insert into time_profiles (name) values ('Teste rápido 2 + 1 + 1 (4 min)') returning id"))!.id;
    await q.query(
      `insert into time_stages (profile_id, position, name, duration_seconds, color)
       values ($1,0,'Apresentação',120,'#2563eb'),($1,1,'Demonstração',60,'#7c3aed'),($1,2,'Perguntas',60,'#0f766e')`,
      [profile],
    );

    // Rubricas da banca de cenários: as fichas do Projeto Integrador (5 critérios de 0 a 5 cada).
    await installPiRubrics(q);
    const typeId = await ensurePiType(q);

    const ev = (await q.one<{ id: number }>(
      `insert into events (name, institution, period, report_header, report_subtitle, report_footer, school_location, show_student_names, rubric_type_id)
       values ($1, 'Instituição Fictícia de Demonstração', '2026/2', 'Instituição Fictícia de Demonstração', 'Banca de cenários de teste (dados fictícios)',
               'Documento de teste — dados fictícios', 'Escola Fictícia — Bloco de Testes', true, $2) returning id`,
      [SCENARIO_EVENT, typeId],
    ))!.id;
    const vq = (await q.one<{ id: number }>(
      `insert into vote_questions (event_id, title, prompt, enabled, required, allow_abstain, rule)
       values ($1, 'Indicação para a feira', 'Você indica este projeto para a feira?', true, true, true, 'simple_majority') returning id`,
      [ev],
    ))!.id;
    await q.query("insert into vote_options (question_id, position, label, is_abstain) values ($1,0,'Indicar',false),($1,1,'Não indicar',false),($1,2,'Abster-se',true)", [vq]);
    const options = new Map((await q.query<{ id: number; label: string }>('select id, label from vote_options where question_id = $1', [vq])).map((o) => [o.label, o.id]));

    const day = (await q.one<{ id: number }>(
      `insert into event_days (event_id, label, date, start_time, end_time, room, gap_minutes, default_profile_id, primary_user_id)
       values ($1, 'Dia de cenários', $2, '08:00', '12:00', 'Sala de Testes 10', 2, $3, $4) returning id`,
      [ev, date, profile, users.ana],
    ))!.id;
    // Dia 2 propositalmente incompleto: sem primário, sem perfil e sem avaliadores (aparece como pendente no roteiro).
    const incompleteDay = (await q.one<{ id: number }>(
      `insert into event_days (event_id, label, date, start_time, end_time, room, gap_minutes)
       values ($1, 'Dia 2 — preparação incompleta', $2, '08:00', '12:00', null, 5) returning id`,
      [ev, date],
    ))!.id;

    const groups: Record<string, number> = {};
    const entries: Record<string, number> = {};
    const addGroup = async (code: string, title: string, dayId: number | null, position: number) => {
      const g = (await q.one<{ id: number }>(
        `insert into groups (event_id, code, class_name, title, description, advisor, advisors, color)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) returning id`,
        [ev, code, '9º T (teste)', `${title} (fictício)`, `Cenário de teste: ${title.toLowerCase()}.`, 'Orientação Fictícia', '["Orientação Fictícia"]', GROUP_COLORS[Object.keys(groups).length % GROUP_COLORS.length]],
      ))!.id;
      for (const [i, suffix] of ['A', 'B'].entries()) {
        const s = (await q.one<{ id: number }>('insert into students (name) values ($1) returning id', [`Estudante Fictício ${code}-${suffix}`]))!.id;
        await q.query('insert into group_students (group_id, student_id, position) values ($1,$2,$3)', [g, s, i]);
      }
      groups[code] = g;
      if (dayId) entries[code] = (await q.one<{ id: number }>('insert into schedule_entries (day_id, group_id, position) values ($1,$2,$3) returning id', [dayId, g, position]))!.id;
    };
    let pos = 1;
    for (const [code, title] of SCENARIOS) await addGroup(code, title, day, pos++);
    await addGroup('C-09', 'Grupo fora do cronograma', null, 0);
    await addGroup('C-10', 'Grupo de um dia sem preparação', incompleteDay, 1);

    // Fichas: Ana 1ª (conteúdo técnico), Bruno 2ª (artigo e pesquisa), Carla 3ª (projeto integrador).
    await q.query('insert into evaluator_assignments (day_id, user_id, rubric_position) values ($1,$2,1),($1,$3,2),($1,$4,3)', [day, users.ana, users.bruno, users.carla]);
    // Avaliador extra apenas para o C-06 (atribuição específica do grupo), com a 4ª ficha (apresentação e defesa).
    await q.query('insert into evaluator_assignments (day_id, user_id, group_id, rubric_position) values ($1,$2,$3,4)', [day, users.fabio, groups['C-06']]);
    return { users, ev, day, incompleteDay, groups, entries, options };
  });
  const { users, day, groups, entries, options } = setup;

  // ---------- Operações (pelos serviços do sistema) ----------
  const evalOf = async (groupId: number, userId: number) => db.one<{ id: number; revision: number }>('select id, revision from evaluations where group_id = $1 and user_id = $2', [groupId, userId]);
  /** Preenche a ficha (notas na ordem dos critérios; null = em branco) e, se pedido, envia. */
  const fill = async (code: string, userId: number, scores: Array<number | null>, vote: string | null, submit: boolean, comment = 'Comentário fictício de teste.') => {
    const ev = await evalOf(groups[code]!, userId);
    if (!ev) throw new Error(`Ficha inexistente: ${code}/${userId}`);
    const crit = await db.query<{ id: number }>(
      'select c.id from rubric_criteria c join evaluations e on e.rubric_version_id = c.version_id where e.id = $1 order by c.position',
      [ev.id],
    );
    const qid = (await db.one<{ id: number }>('select id from vote_questions where event_id = $1', [setup.ev]))!.id;
    const saved = await db.tx((q) =>
      saveDraft(q, ev.id, userId, {
        revision: ev.revision,
        generalComment: comment,
        scores: crit.map((c, i) => ({ criterionId: c.id, score: scores[i] ?? null, comment: scores[i] !== null && scores[i] !== undefined ? 'Justificativa fictícia.' : '' })),
        votes: vote ? [{ questionId: qid, optionId: options.get(vote)! }] : [],
      }),
    );
    if (submit) await db.tx((q) => submitEvaluation(q, ev.id, userId, saved.revision));
  };
  const actorAna = { id: users.ana, name: DEMO_USERS.ana.name };
  /** Apresentação completa até TEMPO ENCERRADO. */
  const present = async (code: string) => {
    await timer.start(users.ana, day, entries[code]!);
    advance(241);
    await timer.tick();
    advance(120);
  };

  // C-01: reinício registrado (problema no projetor) e depois apresentação completa; fechado.
  await timer.start(users.ana, day, entries['C-01']!);
  advance(45);
  await timer.restart(users.ana, day, 'Projetor desligou durante a apresentação (cenário de teste).');
  advance(60);
  await present('C-01');
  await fill('C-01', users.ana, [5, 4, 5, 5, 4], 'Indicar', true);
  await fill('C-01', users.bruno, [4, 4, 3, 4, 5], 'Indicar', true);
  await fill('C-01', users.carla, [5, 5, 4, 5, 5], 'Não indicar', true);
  await db.tx((q) => closeGroup(q, groups['C-01']!, actorAna));

  // C-02: encerrado antes do tempo; Carla dispensada (ausente) e o 3º critério (fundamentação teórica) dispensado para Bruno; fechado.
  await timer.start(users.ana, day, entries['C-02']!);
  advance(170);
  await timer.finish(users.ana, day, 'Grupo concluiu antes do tempo (cenário de teste).');
  advance(120);
  await fill('C-02', users.ana, [3, 4, 4, 3, 4], 'Indicar', true);
  await fill('C-02', users.bruno, [3, 3, 2, 3, 3], 'Não indicar', true);
  await fill('C-02', users.carla, [null, null, null, null, null], null, false, '');
  const carla = await evalOf(groups['C-02']!, users.carla);
  const bruno = await evalOf(groups['C-02']!, users.bruno);
  await db.tx(async (q) => {
    const org = await q.one<{ id: number }>(
      "select c.id from rubric_criteria c join evaluations e on e.rubric_version_id = c.version_id where e.id = $1 and c.position = 2",
      [bruno!.id],
    );
    await q.query("insert into closure_exceptions (group_id, kind, evaluation_id, reason, created_by) values ($1, 'evaluator_absent', $2, $3, $4)", [
      groups['C-02'],
      carla!.id,
      'Professora ausente por motivo de saúde (cenário de teste).',
      users.admin,
    ]);
    await q.query("insert into closure_exceptions (group_id, kind, evaluation_id, criterion_id, reason, created_by) values ($1, 'criterion_waived', $2, $3, $4, $5)", [
      groups['C-02'],
      bruno!.id,
      org!.id,
      'Critério não aplicável a este projeto (cenário de teste).',
      users.admin,
    ]);
  });
  await db.tx((q) => closeGroup(q, groups['C-02']!, actorAna));

  // C-03: fechado (v1), reaberto pelo administrador para corrigir uma nota e fechado de novo (v2).
  await present('C-03');
  await fill('C-03', users.ana, [4, 4, 4, 4, 4], 'Indicar', true);
  await fill('C-03', users.bruno, [1, 3, 3, 3, 3], 'Não indicar', true);
  await fill('C-03', users.carla, [4, 4, 4, 4, 4], 'Indicar', true);
  await db.tx((q) => closeGroup(q, groups['C-03']!, actorAna));
  await db.tx((q) => reopenGroup(q, groups['C-03']!, users.admin, 'Nota digitada errada pelo avaliador (cenário de teste).'));
  await fill('C-03', users.ana, [4, 4, 4, 4, 4], 'Indicar', true);
  await fill('C-03', users.bruno, [3, 3, 3, 3, 3], 'Indicar', true, 'Nota corrigida após a reabertura (cenário de teste).');
  await fill('C-03', users.carla, [4, 4, 4, 4, 4], 'Indicar', true);
  await db.tx((q) => closeGroup(q, groups['C-03']!, actorAna));

  // C-04: fechado e reaberto; as fichas voltaram a rascunho e aguardam o reenvio.
  await present('C-04');
  await fill('C-04', users.ana, [3, 3, 3, 3, 3], 'Não indicar', true);
  await fill('C-04', users.bruno, [3, 3, 3, 3, 4], 'Não indicar', true);
  await fill('C-04', users.carla, [4, 3, 3, 3, 3], 'Abster-se', true);
  await db.tx((q) => closeGroup(q, groups['C-04']!, actorAna));
  await db.tx((q) => reopenGroup(q, groups['C-04']!, users.admin, 'Banca decidiu rever as notas do grupo (cenário de teste).'));

  // C-05: tempo ajustado durante a apresentação; todas as fichas enviadas com votação empatada; aguardando fechamento.
  await timer.start(users.ana, day, entries['C-05']!);
  advance(30);
  await timer.adjust(
    users.ana,
    day,
    [
      { name: 'Apresentação', durationSeconds: 180, color: '#2563eb' },
      { name: 'Demonstração', durationSeconds: 60, color: '#7c3aed' },
      { name: 'Perguntas', durationSeconds: 60, color: '#0f766e' },
    ],
    'Grupo começou atrasado por falha de rede (cenário de teste).',
  );
  advance(301);
  await timer.tick();
  advance(120);
  await fill('C-05', users.ana, [5, 5, 4, 4, 4], 'Indicar', true);
  await fill('C-05', users.bruno, [4, 4, 4, 4, 4], 'Não indicar', true);
  await fill('C-05', users.carla, [5, 5, 5, 4, 5], 'Abster-se', true);

  // C-06: apresentado; Ana enviou, Bruno com rascunho incompleto, Carla e o avaliador extra (Fábio) sem preencher.
  await present('C-06');
  await fill('C-06', users.ana, [4, 4, 4, 4, 4], 'Indicar', true);
  await fill('C-06', users.bruno, [3, null, null, null, null], null, false);

  // C-07: em andamento, pausado na etapa de Apresentação; rascunho parcial da Ana.
  await timer.start(users.ana, day, entries['C-07']!);
  advance(70);
  await timer.pause(users.ana, day);
  await fill('C-07', users.ana, [4, null, null, null, null], null, false);

  await db.query("insert into audit_logs (action, entity, details) values ('seed.scenarios', 'system', $1)", [{ note: 'Banca de cenários de teste (dados fictícios)' }]);
  return { skipped: false, eventId: setup.ev, dayId: day, incompleteDayId: setup.incompleteDay, groups, entries, users };
}
