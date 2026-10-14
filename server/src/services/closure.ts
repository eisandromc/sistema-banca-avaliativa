import { createHash } from 'node:crypto';
import type { Queryable } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http.ts';
import { audit } from '../audit.ts';
import { resolveAssignments } from './schedule.ts';
import { loadRubric, loadVoteQuestions } from './evaluations.ts';
import { finalScore, normalizationConfigured, teacherScore } from '../../../shared/scoring.ts';
import { tallyVotes, VOTE_RULE_LABEL, type VoteTally } from '../../../shared/votes.ts';
import { formatLocation } from '../../../shared/location.ts';
import { formatHHMM, computeSchedule } from '../../../shared/schedule.ts';

export const FORMULA_TEXT_SUM =
  'Subtotal de cada avaliador = soma das notas dos critérios (multiplicadas pelo peso), de 0 até o máximo da rubrica. ' +
  'Total da banca = soma dos subtotais dos avaliadores com avaliação válida. ' +
  'Critérios sem nota não contam como zero.';

export const FORMULA_TEXT =
  'Pontuação do professor (0 a 100) = soma(nota normalizada × peso) ÷ soma(pesos dos critérios avaliados) × 100, ' +
  'com nota normalizada = nota ÷ 10 na escala 0–10 (ou (nota - mín) ÷ (máx - mín) quando configurado). ' +
  'Resultado final = média simples das pontuações dos professores com avaliação válida. ' +
  'Critérios sem nota não contam como zero. Arredondamento para 2 casas apenas na apresentação.';

export interface ConsolidatedEvaluator {
  userId: number;
  name: string;
  evaluationId: number | null;
  status: 'not_opened' | 'draft' | 'submitted';
  submittedAt: string | null;
  absent: { reason: string; by: string; at: string } | null;
  counted: boolean;
  rubric: {
    versionId: number;
    templateName: string;
    title: string;
    version: number;
    instructions: string | null;
    evaluatorRole: string | null;
    dimension: string | null;
    dimensionShort: string | null;
    feedbackLabel: string | null;
    scaleLabels: Array<{ value: number; label: string }>;
    sortOrder: number;
    scale: { min: number; max: number; step: number; normalization: string | null };
  };
  criteria: Array<{
    id: number;
    title: string;
    description: string | null;
    weight: number;
    required: boolean;
    score: number | null;
    comment: string | null;
    waived: { reason: string; by: string } | null;
    contribution: number | null;
  }>;
  generalComment: string | null;
  teacherScore: number | null;
  /** Pontos brutos: soma(nota x peso) dos critérios avaliados. */
  points: number | null;
  /** Máximo possível: soma(nota máxima x peso) dos critérios não dispensados. */
  maxPoints: number;
  usedWeight: number;
  totalWeight: number;
  pendencies: string[];
}

export interface Consolidation {
  generatedAt: string;
  event: {
    id: number;
    name: string;
    institution: string | null;
    period: string | null;
    timezone: string;
    reportHeader: string | null;
    reportSubtitle: string | null;
    reportFooter: string | null;
    reportColor: string;
    votePrivacy: 'nominal' | 'anonymous';
    institutionDetail: string | null;
    reportPurpose: string | null;
    reportGuidance: string | null;
    aggregation: 'mean' | 'sum';
    verdictOptions: string[];
  };
  day: { id: number; label: string; date: string; room: string | null };
  /** Local impresso: sala + local da escola, conforme o modelo da banca. */
  location: string;
  /** Horário (real se iniciou; senão o previsto), "HH:MM–HH:MM". */
  timeRange: string;
  verdict: { verdict: string | null; strengths: string | null; improvements: string | null; guidance: string | null };
  group: { id: number; code: string; className: string; title: string; description: string | null; advisor: string | null; students: string[] };
  entry: { id: number; startedAt: string | null; endedAt: string | null };
  evaluators: ConsolidatedEvaluator[];
  exceptions: Array<{ id: number; kind: string; evaluatorName: string; criterionTitle: string | null; reason: string; createdBy: string; createdAt: string }>;
  votes: Array<{
    questionId: number;
    title: string;
    prompt: string;
    rule: string;
    ruleLabel: string;
    quorumMin: number | null;
    tally: VoteTally;
    ballots: Array<{ evaluatorName: string; optionLabel: string }> | null;
  }>;
  finalScore: number | null;
  /** Máximo do resultado: 100 na média; soma dos máximos dos avaliadores contabilizados na soma. */
  finalMax: number;
  countedEvaluators: number;
  formula: string;
  blockers: string[];
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export async function buildConsolidation(q: Queryable, groupId: number): Promise<Consolidation> {
  const g = await q.one<any>(
    `select g.*, e.id as entry_id, e.day_id, e.started_at, e.ended_at,
            d.label as day_label, d.date as day_date, d.room,
            ev.name as event_name, ev.institution, ev.period, ev.timezone, ev.report_header, ev.report_subtitle,
            ev.report_footer, ev.report_color, ev.vote_privacy, ev.institution_detail, ev.report_purpose, ev.report_guidance,
            ev.school_location, ev.location_format, ev.aggregation, ev.verdict_options
       from groups g
       join events ev on ev.id = g.event_id
       left join schedule_entries e on e.group_id = g.id
       left join event_days d on d.id = e.day_id
      where g.id = $1`,
    [groupId],
  );
  if (!g) throw notFound('Grupo não encontrado.');
  const students = (
    await q.query<{ name: string }>(
      'select s.name from group_students gs join students s on s.id = gs.student_id where gs.group_id = $1 order by gs.position, s.name',
      [groupId],
    )
  ).map((s) => s.name);

  const blockers: string[] = [];
  if (!g.entry_id) blockers.push('O grupo não está no cronograma de nenhum dia.');
  else if (!g.started_at) blockers.push('A apresentação do grupo ainda não foi iniciada.');
  else if (await q.one("select 1 from timer_sessions where entry_id = $1 and not superseded and status in ('running', 'paused')", [g.entry_id])) {
    blockers.push('A apresentação ainda está em andamento: encerre o cronômetro antes de fechar.');
  }

  const assignments = g.entry_id ? await resolveAssignments(q, g.day_id, groupId) : [];
  if (g.entry_id && assignments.length === 0) blockers.push('Nenhum avaliador designado para este grupo.');

  const exceptionsRaw = await q.query<any>(
    `select x.*, u.name as created_by_name, ev.user_id, ev2u.name as evaluator_name, c.title as criterion_title
       from closure_exceptions x
       join users u on u.id = x.created_by
       join evaluations ev on ev.id = x.evaluation_id
       join users ev2u on ev2u.id = ev.user_id
       left join rubric_criteria c on c.id = x.criterion_id
      where x.group_id = $1 and x.revoked_at is null
      order by x.created_at`,
    [groupId],
  );

  const evaluators: ConsolidatedEvaluator[] = [];
  for (const a of assignments) {
    const user = await q.one<{ name: string }>('select name from users where id = $1', [a.userId]);
    const ev = await q.one<any>('select * from evaluations where group_id = $1 and user_id = $2', [groupId, a.userId]);
    const rubric = await loadRubric(q, ev?.rubric_version_id ?? a.rubricVersionId);
    const scores = ev
      ? new Map((await q.query<any>('select * from evaluation_scores where evaluation_id = $1', [ev.id])).map((s) => [s.criterion_id, s]))
      : new Map<number, any>();
    const myExc = ev ? exceptionsRaw.filter((x) => x.evaluation_id === ev.id) : [];
    const absentExc = myExc.find((x) => x.kind === 'evaluator_absent');
    const waivedExc = new Map(myExc.filter((x) => x.kind === 'criterion_waived').map((x) => [x.criterion_id, x]));
    const scoreMap = new Map<number, number | null>(rubric.criteria.map((c) => [c.id, scores.get(c.id)?.score ?? null]));
    const pendencies: string[] = [];
    let ts: ReturnType<typeof teacherScore> | null = null;
    if (!normalizationConfigured(rubric.scale)) {
      pendencies.push('Escala sem normalização configurada.');
    } else {
      ts = teacherScore(
        rubric.criteria.map((c) => ({ id: c.id, title: c.title, weight: c.weight, required: c.required })),
        scoreMap,
        rubric.scale,
        new Set(waivedExc.keys()),
      );
    }
    const status: ConsolidatedEvaluator['status'] = !ev ? 'not_opened' : ev.status;
    if (!absentExc) {
      if (status !== 'submitted') pendencies.push(status === 'not_opened' ? 'Ficha não aberta.' : 'Ficha não enviada (rascunho).');
      for (const id of ts?.missingRequired ?? []) pendencies.push(`Nota obrigatória ausente: ${rubric.criteria.find((c) => c.id === id)?.title}.`);
    }
    const counted = !absentExc && status === 'submitted' && ts !== null && ts.score !== null && ts.missingRequired.length === 0;
    let points: number | null = null;
    let maxPoints = 0;
    for (const c of rubric.criteria) {
      if (waivedExc.has(c.id)) continue;
      maxPoints += rubric.scale.max * c.weight;
      const sc = scoreMap.get(c.id);
      if (sc !== null && sc !== undefined) points = (points ?? 0) + sc * c.weight;
    }
    if (!absentExc && pendencies.length) blockers.push(`${user?.name}: ${pendencies.join(' ')}`);
    evaluators.push({
      userId: a.userId,
      name: user?.name ?? '—',
      evaluationId: ev?.id ?? null,
      status,
      submittedAt: iso(ev?.submitted_at),
      absent: absentExc ? { reason: absentExc.reason, by: absentExc.created_by_name, at: iso(absentExc.created_at)! } : null,
      counted,
      rubric: {
        versionId: rubric.versionId,
        templateName: rubric.templateName,
        title: rubric.title,
        version: rubric.version,
        instructions: rubric.instructions,
        evaluatorRole: rubric.evaluatorRole,
        dimension: rubric.dimension,
        dimensionShort: rubric.dimensionShort,
        feedbackLabel: rubric.feedbackLabel,
        scaleLabels: rubric.scaleLabels,
        sortOrder: rubric.sortOrder,
        scale: rubric.scale,
      },
      criteria: rubric.criteria.map((c) => {
        const s = scores.get(c.id);
        const w = waivedExc.get(c.id);
        return {
          id: c.id,
          title: c.title,
          description: c.description,
          weight: c.weight,
          required: c.required,
          score: s?.score ?? null,
          comment: s?.comment ?? null,
          waived: w ? { reason: w.reason, by: w.created_by_name } : null,
          contribution: ts?.parts.find((p) => p.criterionId === c.id)?.contribution ?? null,
        };
      }),
      generalComment: ev?.general_comment ?? null,
      teacherScore: counted ? ts!.score : null,
      points: counted ? points : null,
      maxPoints,
      usedWeight: ts?.usedWeight ?? 0,
      totalWeight: ts?.totalWeight ?? 0,
      pendencies,
    });
  }

  // Ordem do documento: pela ordem definida na rubrica (Avaliador 1, 2, ...) e depois pelo nome.
  evaluators.sort((a, b) => a.rubric.sortOrder - b.rubric.sortOrder || a.name.localeCompare(b.name, 'pt-BR'));
  const counted = evaluators.filter((e) => e.counted);
  const aggregation: 'mean' | 'sum' = g.aggregation === 'sum' ? 'sum' : 'mean';
  const verdictOptions: string[] = Array.isArray(g.verdict_options) ? g.verdict_options : [];
  const verdictRow = await q.one<any>('select * from group_verdicts where group_id = $1', [groupId]);
  const verdict = {
    verdict: verdictRow?.verdict ?? null,
    strengths: verdictRow?.strengths ?? null,
    improvements: verdictRow?.improvements ?? null,
    guidance: verdictRow?.guidance ?? null,
  };
  if (verdictOptions.length && !verdict.verdict) blockers.push('Registre o parecer da banca.');
  if (assignments.length > 0 && counted.length === 0 && blockers.length === 0) {
    blockers.push('Nenhuma avaliação válida para compor o resultado.');
  }

  // Votação — apenas fichas enviadas e contabilizadas; separada das notas.
  const questions = await loadVoteQuestions(q, g.event_id);
  const countedEvalIds = counted.map((e) => e.evaluationId!).filter(Boolean);
  const ballotsRaw = countedEvalIds.length
    ? await q.query<any>(
        `select v.question_id, v.option_id, v.evaluation_id, o.label, u.name
           from votes v join vote_options o on o.id = v.option_id
           join evaluations ev on ev.id = v.evaluation_id join users u on u.id = ev.user_id
          where v.evaluation_id = any($1::int[]) order by u.name`,
        [countedEvalIds],
      )
    : [];
  const votes = questions.map((qd) => {
    const mine = ballotsRaw.filter((b) => b.question_id === qd.id);
    if (qd.required) {
      for (const e of counted) {
        if (!mine.some((b) => b.evaluation_id === e.evaluationId)) blockers.push(`${e.name}: voto obrigatório ausente em "${qd.title}".`);
      }
    }
    return {
      questionId: qd.id,
      title: qd.title,
      prompt: qd.prompt,
      rule: qd.rule,
      ruleLabel: VOTE_RULE_LABEL[qd.rule],
      quorumMin: qd.quorumMin,
      tally: tallyVotes(qd.options, mine.map((b) => b.option_id), qd.rule, qd.quorumMin),
      ballots: g.vote_privacy === 'nominal' ? mine.map((b) => ({ evaluatorName: b.name, optionLabel: b.label })) : null,
    };
  });

  const closedNow = await q.one('select version from evaluation_closures where group_id = $1 and reopened_at is null', [groupId]);
  if (closedNow) blockers.push('A avaliação já está fechada.');

  return {
    generatedAt: new Date().toISOString(),
    event: {
      id: g.event_id,
      name: g.event_name,
      institution: g.institution,
      period: g.period,
      timezone: g.timezone,
      reportHeader: g.report_header,
      reportSubtitle: g.report_subtitle,
      reportFooter: g.report_footer,
      reportColor: g.report_color,
      votePrivacy: g.vote_privacy,
      institutionDetail: g.institution_detail,
      reportPurpose: g.report_purpose,
      reportGuidance: g.report_guidance,
      aggregation,
      verdictOptions,
    },
    day: { id: g.day_id, label: g.day_label ?? '', date: g.day_date ?? '', room: g.room ?? null },
    group: { id: g.id, code: g.code, className: g.class_name, title: g.title, description: g.description, advisor: g.advisor, students },
    entry: { id: g.entry_id, startedAt: iso(g.started_at), endedAt: iso(g.ended_at) },
    evaluators,
    exceptions: exceptionsRaw.map((x) => ({
      id: x.id,
      kind: x.kind,
      evaluatorName: x.evaluator_name,
      criterionTitle: x.criterion_title,
      reason: x.reason,
      createdBy: x.created_by_name,
      createdAt: iso(x.created_at)!,
    })),
    votes,
    finalScore:
      aggregation === 'sum'
        ? counted.length
          ? counted.reduce((a, e) => a + (e.points ?? 0), 0)
          : null
        : finalScore(counted.map((e) => e.teacherScore)),
    finalMax:
      aggregation === 'sum'
        ? counted.reduce((a, e) => a + e.maxPoints, 0) || evaluators.reduce((a, e) => a + (e.absent ? 0 : e.maxPoints), 0)
        : 100,
    countedEvaluators: counted.length,
    formula: aggregation === 'sum' ? FORMULA_TEXT_SUM : FORMULA_TEXT,
    location: formatLocation(g.location_format, g.room, g.school_location),
    timeRange: await timeRangeFor(q, g),
    verdict,
    blockers,
  };
}

export interface ClosureSnapshot extends Consolidation {
  closure: { version: number; closedAt: string; closedBy: string };
}

/** Identifica o conteúdo conferido (sem o horário de geração): muda se qualquer nota, voto, exceção ou parecer mudar. */
export function consolidationToken(c: Consolidation): string {
  const { generatedAt: _ignored, ...rest } = c;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 32);
}

export async function closeGroup(q: Queryable, groupId: number, actor: { id: number; name: string }, expectedToken?: string) {
  await q.query('select id from groups where id = $1 for update', [groupId]);
  const open = await q.one<any>('select id, version from evaluation_closures where group_id = $1 and reopened_at is null', [groupId]);
  if (open) throw conflict(`A avaliação já está fechada (versão ${open.version}).`, 'ALREADY_CLOSED', { version: open.version });
  const c = await buildConsolidation(q, groupId);
  if (c.blockers.length) throw badRequest('Fechamento bloqueado: ' + c.blockers.join(' | '), c.blockers);
  if (expectedToken && expectedToken !== consolidationToken(c)) {
    throw conflict('Os dados da avaliação mudaram desde a sua conferência (nova ficha, voto, exceção ou parecer). Confira novamente antes de fechar.', 'REVIEW_STALE');
  }
  const prev = await q.one<{ v: number | null }>('select max(version) as v from evaluation_closures where group_id = $1', [groupId]);
  const version = (prev?.v ?? 0) + 1;
  const closedAt = new Date();
  const snapshot: ClosureSnapshot = { ...c, closure: { version, closedAt: closedAt.toISOString(), closedBy: actor.name } };
  const row = await q.one<{ id: number }>(
    `insert into evaluation_closures (group_id, version, snapshot, final_score, closed_by, closed_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [groupId, version, snapshot, c.finalScore, actor.id, closedAt],
  );
  await audit(q, actor.id, 'closure.closed', 'group', groupId, { closureId: row!.id, version, finalScore: c.finalScore });
  return { closureId: row!.id, version, finalScore: c.finalScore, dayId: c.day.id };
}

export async function reopenGroup(q: Queryable, groupId: number, actorId: number, reason: string) {
  if (!reason || reason.trim().length < 10) throw badRequest('Informe o motivo da reabertura (mín. 10 caracteres).');
  await q.query('select id from groups where id = $1 for update', [groupId]);
  const open = await q.one<any>('select id, version from evaluation_closures where group_id = $1 and reopened_at is null', [groupId]);
  if (!open) throw conflict('Não há fechamento vigente para reabrir.', 'NOT_CLOSED');
  await q.query('update evaluation_closures set reopened_at = now(), reopened_by = $2, reopen_reason = $3 where id = $1', [open.id, actorId, reason.trim()]);
  // As fichas voltam a rascunho (valores preservados) para correção e reenvio; o snapshot anterior permanece no histórico.
  await q.query("update evaluations set status = 'draft', submitted_at = null, revision = revision + 1, updated_at = now() where group_id = $1", [groupId]);
  await audit(q, actorId, 'closure.reopened', 'group', groupId, { closureId: open.id, version: open.version, reason: reason.trim() });
  const day = await q.one<{ day_id: number }>('select day_id from schedule_entries where group_id = $1', [groupId]);
  return { reopenedVersion: open.version, dayId: day?.day_id ?? null };
}

export async function closureHistory(q: Queryable, groupId: number) {
  return q.query<any>(
    `select c.id, c.version, c.final_score as "finalScore", c.closed_at as "closedAt", u.name as "closedBy",
            c.reopened_at as "reopenedAt", r.name as "reopenedBy", c.reopen_reason as "reopenReason"
       from evaluation_closures c join users u on u.id = c.closed_by left join users r on r.id = c.reopened_by
      where c.group_id = $1 order by c.version desc`,
    [groupId],
  );
}

const hhmm = (d: unknown, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(d as string));

/** Horário impresso: real (início–fim) se houve apresentação; senão o previsto pelo cronograma. */
async function timeRangeFor(q: Queryable, g: any): Promise<string> {
  const tz = g.timezone || 'America/Sao_Paulo';
  if (g.started_at) return `${hhmm(g.started_at, tz)}${g.ended_at ? `–${hhmm(g.ended_at, tz)}` : ''}`;
  if (!g.day_id) return '';
  const day = await q.one<any>('select * from event_days where id = $1', [g.day_id]);
  const rows = await q.query<any>(
    `select e.id, coalesce((select sum(duration_seconds)::int from time_stages s where s.profile_id = coalesce(e.time_profile_id, $2)), 0) as dur
       from schedule_entries e where e.day_id = $1 order by e.position`,
    [g.day_id, day.default_profile_id],
  );
  const breaks = await q.query<any>('select label, start_time, end_time from breaks where day_id = $1', [g.day_id]);
  const r = computeSchedule({
    start: day.start_time,
    end: day.end_time,
    gapMinutes: day.gap_minutes,
    breaks: breaks.map((b) => ({ label: b.label, start: b.start_time, end: b.end_time })),
    items: rows.map((x) => ({ id: x.id, durationSeconds: x.dur })),
  }).items.find((i) => i.id === g.entry_id);
  return r ? `${formatHHMM(r.startSec)}–${formatHHMM(r.endSec)} (previsto)` : '';
}

/** Registra/atualiza o parecer da banca (antes do fechamento). */
export async function saveVerdict(
  q: Queryable,
  groupId: number,
  actorId: number,
  body: { verdict: string | null; strengths: string | null; improvements: string | null; guidance: string | null },
) {
  await q.query('select id from groups where id = $1 for update', [groupId]);
  if (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [groupId])) {
    throw conflict('Avaliação fechada: o parecer não pode ser alterado (reabra para editar).', 'CLOSED');
  }
  const ev = await q.one<{ verdict_options: string[] }>(
    'select e.verdict_options from groups g join events e on e.id = g.event_id where g.id = $1',
    [groupId],
  );
  if (!ev) throw notFound('Grupo não encontrado.');
  if (body.verdict && !(ev.verdict_options ?? []).includes(body.verdict)) throw badRequest('Opção de parecer inválida para esta banca.');
  await q.query(
    `insert into group_verdicts (group_id, verdict, strengths, improvements, guidance, updated_by, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (group_id) do update set verdict = excluded.verdict, strengths = excluded.strengths, improvements = excluded.improvements,
       guidance = excluded.guidance, updated_by = excluded.updated_by, updated_at = now()`,
    [groupId, body.verdict, body.strengths, body.improvements, body.guidance, actorId],
  );
  await audit(q, actorId, 'closure.verdict_saved', 'group', groupId, { verdict: body.verdict });
}
