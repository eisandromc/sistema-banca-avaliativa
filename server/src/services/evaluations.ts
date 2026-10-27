import type { Queryable } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http.ts';
import { audit } from '../audit.ts';
import { resolveAssignments } from './schedule.ts';
import { normalizationConfigured, validateScore, type RubricScale } from '../../../shared/scoring.ts';

/** Cria (idempotente) as fichas dos docentes designados para a entrada. Retorna quantas foram criadas. */
export async function ensureEvaluations(q: Queryable, entryId: number): Promise<number> {
  const entry = await q.one<{ id: number; day_id: number; group_id: number; started_at: unknown }>(
    'select id, day_id, group_id, started_at from schedule_entries where id = $1',
    [entryId],
  );
  if (!entry || !entry.started_at) return 0;
  // Grupo com avaliação fechada não recebe fichas novas (ex.: docente designado depois do fechamento).
  if (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [entry.group_id])) return 0;
  let created = 0;
  for (const a of await resolveAssignments(q, entry.day_id, entry.group_id)) {
    const r = await q.query(
      `insert into evaluations (entry_id, group_id, user_id, rubric_version_id)
       values ($1, $2, $3, $4) on conflict (group_id, user_id) do nothing returning id`,
      [entry.id, entry.group_id, a.userId, a.rubricVersionId],
    );
    created += r.length;
  }
  return created;
}

export interface RubricDef {
  versionId: number;
  templateId: number;
  templateName: string;
  title: string;
  version: number;
  instructions: string | null;
  scale: RubricScale;
  generalCommentRequired: boolean;
  evaluatorRole: string | null;
  dimension: string | null;
  dimensionShort: string | null;
  feedbackLabel: string | null;
  scaleLabels: Array<{ value: number; label: string }>;
  sortOrder: number;
  criteria: Array<{
    id: number;
    position: number;
    title: string;
    description: string | null;
    weight: number;
    required: boolean;
    commentEnabled: boolean;
    commentRequired: boolean;
  }>;
}

export async function loadRubric(q: Queryable, versionId: number): Promise<RubricDef> {
  const v = await q.one<any>(
    `select v.*, t.name as template_name from rubric_versions v join rubric_templates t on t.id = v.template_id where v.id = $1`,
    [versionId],
  );
  if (!v) throw notFound('Rubrica não encontrada.');
  const criteria = await q.query<any>('select * from rubric_criteria where version_id = $1 order by position', [versionId]);
  return {
    versionId: v.id,
    templateId: v.template_id,
    templateName: v.template_name,
    title: v.title,
    version: v.version,
    instructions: v.instructions,
    scale: { min: v.scale_min, max: v.scale_max, step: v.scale_step, normalization: v.normalization },
    generalCommentRequired: v.general_comment_required,
    evaluatorRole: v.evaluator_role,
    dimension: v.dimension,
    dimensionShort: v.dimension_short,
    feedbackLabel: v.feedback_label,
    scaleLabels: v.scale_labels ?? [],
    sortOrder: v.sort_order ?? 0,
    criteria: criteria.map((c) => ({
      id: c.id,
      position: c.position,
      title: c.title,
      description: c.description,
      weight: c.weight,
      required: c.required,
      commentEnabled: c.comment_enabled,
      commentRequired: c.comment_required,
    })),
  };
}

export interface VoteQuestionDef {
  id: number;
  title: string;
  prompt: string;
  required: boolean;
  allowAbstain: boolean;
  rule: 'simple_majority' | 'quorum' | 'counts_only';
  quorumMin: number | null;
  options: Array<{ id: number; label: string; isAbstain: boolean }>;
}

export async function loadVoteQuestions(q: Queryable, eventId: number, enabledOnly = true): Promise<VoteQuestionDef[]> {
  const qs = await q.query<any>(
    `select * from vote_questions where event_id = $1 and deleted_at is null ${enabledOnly ? 'and enabled' : ''} order by position, id`,
    [eventId],
  );
  const opts = qs.length
    ? await q.query<any>('select * from vote_options where question_id = any($1::int[]) order by position, id', [qs.map((x) => x.id)])
    : [];
  return qs.map((x) => ({
    id: x.id,
    title: x.title,
    prompt: x.prompt,
    required: x.required,
    allowAbstain: x.allow_abstain,
    rule: x.rule,
    quorumMin: x.quorum_min,
    options: opts
      .filter((o) => o.question_id === x.id && (x.allow_abstain || !o.is_abstain))
      .map((o) => ({ id: o.id, label: o.label, isAbstain: o.is_abstain })),
  }));
}

interface EvalRow {
  id: number;
  entry_id: number;
  group_id: number;
  user_id: number;
  rubric_version_id: number;
  status: 'draft' | 'submitted';
  general_comment: string | null;
  revision: number;
  updated_at: Date;
  submitted_at: Date | null;
  event_id: number;
  day_id: number;
  edit_after_submit: 'locked' | 'until_closure';
  aggregation: 'mean' | 'sum';
}

async function loadEval(q: Queryable, id: number, lock = false): Promise<EvalRow> {
  const ev = await q.one<EvalRow>(
    `select ev.*, g.event_id, e.day_id, evt.edit_after_submit, evt.aggregation
       from evaluations ev
       join schedule_entries e on e.id = ev.entry_id
       join groups g on g.id = ev.group_id
       join events evt on evt.id = g.event_id
      where ev.id = $1 ${lock ? 'for update of ev' : ''}`,
    [id],
  );
  if (!ev) throw notFound('Avaliação não encontrada.');
  return ev;
}

async function isClosed(q: Queryable, groupId: number): Promise<boolean> {
  return !!(await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [groupId]));
}

/** Somente o próprio docente acessa a ficha (nem outros professores, nem por URL/API). */
function assertOwner(ev: EvalRow, userId: number) {
  if (ev.user_id !== userId) throw forbidden('Esta ficha pertence a outro avaliador.');
}

async function assertStillAssigned(q: Queryable, ev: EvalRow) {
  const assigned = await resolveAssignments(q, ev.day_id, ev.group_id);
  if (!assigned.some((a) => a.userId === ev.user_id)) throw forbidden('Você não está mais designado para avaliar este grupo.');
}

function editableState(ev: EvalRow, closed: boolean) {
  if (closed) return { editable: false, reason: 'A avaliação do grupo foi fechada.' };
  if (ev.status === 'submitted' && ev.edit_after_submit === 'locked') return { editable: false, reason: 'Ficha enviada. A política da banca não permite edição após o envio.' };
  return { editable: true, reason: null as string | null };
}

export async function getEvaluationForm(q: Queryable, id: number, userId: number) {
  const ev = await loadEval(q, id);
  assertOwner(ev, userId);
  await assertStillAssigned(q, ev);
  const closed = await isClosed(q, ev.group_id);
  const rubric = await loadRubric(q, ev.rubric_version_id);
  const scores = await q.query<any>('select criterion_id, score, comment from evaluation_scores where evaluation_id = $1', [id]);
  const questions = await loadVoteQuestions(q, ev.event_id);
  const votes = await q.query<any>('select question_id, option_id from votes where evaluation_id = $1', [id]);
  const group = await q.one<any>('select id, code, class_name, title, description, advisor from groups where id = $1', [ev.group_id]);
  const students = await q.query<{ name: string }>(
    'select s.name from group_students gs join students s on s.id = gs.student_id where gs.group_id = $1 order by gs.position, s.name',
    [ev.group_id],
  );
  const { editable, reason } = editableState(ev, closed);
  return {
    evaluation: {
      id: ev.id,
      entryId: ev.entry_id,
      groupId: ev.group_id,
      status: ev.status,
      revision: ev.revision,
      generalComment: ev.general_comment ?? '',
      updatedAt: ev.updated_at,
      submittedAt: ev.submitted_at,
      editable,
      lockedReason: reason,
      closed,
      editPolicy: ev.edit_after_submit,
      aggregation: ev.aggregation,
    },
    group: {
      id: group.id,
      code: group.code,
      className: group.class_name,
      title: group.title,
      description: group.description,
      advisor: group.advisor,
      students: students.map((s) => s.name),
    },
    rubric,
    scores: scores.map((s) => ({ criterionId: s.criterion_id, score: s.score, comment: s.comment ?? '' })),
    questions,
    votes: votes.map((v) => ({ questionId: v.question_id, optionId: v.option_id })),
  };
}

export interface DraftInput {
  revision: number;
  generalComment?: string;
  scores: Array<{ criterionId: number; score: number | null; comment?: string }>;
  votes?: Array<{ questionId: number; optionId: number | null }>;
}

export async function saveDraft(q: Queryable, id: number, userId: number, input: DraftInput) {
  const ev = await loadEval(q, id, true);
  assertOwner(ev, userId);
  await assertStillAssigned(q, ev);
  const closed = await isClosed(q, ev.group_id);
  const { editable, reason } = editableState(ev, closed);
  if (!editable) throw conflict(reason!, 'LOCKED');
  if (input.revision !== ev.revision) {
    throw conflict('A ficha foi alterada em outro dispositivo ou aba. Carregue a versão do servidor antes de continuar.', 'REVISION_CONFLICT', {
      serverRevision: ev.revision,
    });
  }
  const rubric = await loadRubric(q, ev.rubric_version_id);
  const byId = new Map(rubric.criteria.map((c) => [c.id, c]));
  const errors: string[] = [];
  for (const s of input.scores) {
    const c = byId.get(s.criterionId);
    if (!c) throw badRequest('Critério não pertence à rubrica desta ficha.');
    if (s.score !== null) {
      const err = validateScore(s.score, rubric.scale);
      if (err) errors.push(`${c.title}: ${err}`);
    }
  }
  if (errors.length) throw badRequest(errors.join(' '), errors);

  for (const s of input.scores) {
    const c = byId.get(s.criterionId)!;
    await q.query(
      `insert into evaluation_scores (evaluation_id, criterion_id, score, comment) values ($1, $2, $3, $4)
       on conflict (evaluation_id, criterion_id) do update set score = excluded.score, comment = excluded.comment`,
      [id, s.criterionId, s.score, c.commentEnabled ? (s.comment ?? '').slice(0, 5000) : null],
    );
  }

  if (input.votes) {
    const questions = await loadVoteQuestions(q, ev.event_id);
    for (const v of input.votes) {
      const qd = questions.find((x) => x.id === v.questionId);
      if (!qd) throw badRequest('Pergunta de votação inválida ou desabilitada.');
      if (v.optionId === null) {
        await q.query('delete from votes where evaluation_id = $1 and question_id = $2', [id, v.questionId]);
        continue;
      }
      if (!qd.options.some((o) => o.id === v.optionId)) throw badRequest('Opção de voto inválida para esta pergunta.');
      await q.query(
        `insert into votes (evaluation_id, question_id, option_id) values ($1, $2, $3)
         on conflict (evaluation_id, question_id) do update set option_id = excluded.option_id, updated_at = now()`,
        [id, v.questionId, v.optionId],
      );
    }
  }

  // Edição após envio (política "until_closure") devolve a ficha a rascunho: é preciso reenviar.
  const row = await q.one<{ revision: number; status: string; updated_at: Date }>(
    `update evaluations set general_comment = $2, revision = revision + 1, updated_at = now(),
            status = 'draft', submitted_at = null
      where id = $1 returning revision, status, updated_at`,
    [id, input.generalComment === undefined ? ev.general_comment : input.generalComment.slice(0, 10000)],
  );
  if (ev.status === 'submitted') await audit(q, userId, 'evaluation.edited_after_submit', 'evaluation', id, null);
  return { revision: row!.revision, status: row!.status, updatedAt: row!.updated_at };
}

/** Lista as pendências que impedem o envio da ficha. */
export async function evaluationPendencies(q: Queryable, ev: { id: number; rubric_version_id: number; event_id: number; general_comment: string | null }) {
  const rubric = await loadRubric(q, ev.rubric_version_id);
  const scores = new Map(
    (await q.query<any>('select criterion_id, score, comment from evaluation_scores where evaluation_id = $1', [ev.id])).map((s) => [s.criterion_id, s]),
  );
  const pend: string[] = [];
  if (!normalizationConfigured(rubric.scale)) pend.push('A rubrica usa escala diferente de 0–10 sem normalização configurada (contate o administrador).');
  for (const c of rubric.criteria) {
    const s = scores.get(c.id);
    if (c.required && (s === undefined || s.score === null)) pend.push(`Nota obrigatória ausente: ${c.title}.`);
    if (c.commentEnabled && c.commentRequired && !(s?.comment ?? '').trim()) pend.push(`Justificativa obrigatória ausente: ${c.title}.`);
  }
  if (rubric.generalCommentRequired && !(ev.general_comment ?? '').trim()) pend.push('Observação geral obrigatória ausente.');
  const questions = await loadVoteQuestions(q, ev.event_id);
  const votes = new Set((await q.query<any>('select question_id from votes where evaluation_id = $1', [ev.id])).map((v) => v.question_id));
  for (const qd of questions) if (qd.required && !votes.has(qd.id)) pend.push(`Voto obrigatório ausente: ${qd.title}.`);
  return pend;
}

export async function submitEvaluation(q: Queryable, id: number, userId: number, revision: number) {
  const ev = await loadEval(q, id, true);
  assertOwner(ev, userId);
  await assertStillAssigned(q, ev);
  // Idempotência: reenvio da mesma revisão já enviada não duplica nada.
  if (ev.status === 'submitted' && ev.revision === revision) {
    return { status: 'submitted' as const, revision: ev.revision, submittedAt: ev.submitted_at, alreadySubmitted: true };
  }
  const closed = await isClosed(q, ev.group_id);
  const { editable, reason } = editableState(ev, closed);
  if (!editable) throw conflict(reason!, 'LOCKED');
  if (revision !== ev.revision) {
    throw conflict('A ficha foi alterada em outro dispositivo. Recarregue antes de enviar.', 'REVISION_CONFLICT', { serverRevision: ev.revision });
  }
  const pend = await evaluationPendencies(q, ev);
  if (pend.length) throw badRequest('Não é possível enviar: ' + pend.join(' '), pend);
  const row = await q.one<any>(
    `update evaluations set status = 'submitted', submitted_at = now(), revision = revision + 1, updated_at = now()
      where id = $1 returning revision, submitted_at`,
    [id],
  );
  await audit(q, userId, 'evaluation.submitted', 'evaluation', id, { groupId: ev.group_id, revision: row.revision });
  return { status: 'submitted' as const, revision: row.revision, submittedAt: row.submitted_at, alreadySubmitted: false, dayId: ev.day_id };
}
