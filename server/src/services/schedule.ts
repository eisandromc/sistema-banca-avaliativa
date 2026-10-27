import type { Queryable } from '../db/database.ts';
import { computeSchedule, formatHHMM } from '../../../shared/schedule.ts';
import type { Stage } from '../../../shared/timer.ts';
import { notFound } from '../http.ts';

export type EntryStatus = 'waiting' | 'running' | 'started' | 'awaiting_closure' | 'finalized';

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  waiting: 'Aguardando',
  running: 'Em andamento',
  started: 'Iniciado',
  awaiting_closure: 'Aguardando fechamento',
  finalized: 'Finalizado',
};

export interface ResolvedAssignment {
  userId: number;
  rubricVersionId: number;
  groupSpecific: boolean;
}

/** Versão vigente de cada ficha (posição) de um tipo de rubrica: a mais recente que não está na lixeira. */
export async function fichasOfType(q: Queryable, typeId: number): Promise<Map<number, { versionId: number; title: string }>> {
  const rows = await q.query<{ type_position: number; id: number; title: string }>(
    `select distinct on (t.type_position) t.type_position, v.id, v.title
       from rubric_templates t join rubric_versions v on v.template_id = t.id
      where t.type_id = $1 and t.type_position > 0 and v.deleted_at is null
      order by t.type_position, t.id, v.version desc`,
    [typeId],
  );
  return new Map(rows.map((r) => [r.type_position, { versionId: r.id, title: r.title }]));
}

/**
 * Atribuições efetivas de um grupo: a específica do grupo sobrescreve a geral do dia. A atribuição guarda só a
 * ficha (posição); a rubrica vem do tipo do grupo (ou da banca), na versão mais recente. Ficha que não existe
 * no tipo fica de fora (a prontidão da banca aponta).
 */
export async function resolveAssignments(q: Queryable, dayId: number, groupId: number): Promise<ResolvedAssignment[]> {
  const rows = await q.query<{ user_id: number; rubric_position: number; group_id: number | null }>(
    `select distinct on (user_id) user_id, rubric_position, group_id
       from evaluator_assignments
      where day_id = $1 and (group_id = $2 or group_id is null)
      order by user_id, group_id nulls last`,
    [dayId, groupId],
  );
  if (!rows.length) return [];
  const g = await q.one<{ type_id: number | null }>(
    'select coalesce(g.rubric_type_id, e.rubric_type_id) as type_id from groups g join events e on e.id = g.event_id where g.id = $1',
    [groupId],
  );
  if (!g?.type_id) return [];
  const fichas = await fichasOfType(q, g.type_id);
  return rows.flatMap((r) => {
    const f = fichas.get(r.rubric_position);
    return f ? [{ userId: r.user_id, rubricVersionId: f.versionId, groupSpecific: r.group_id !== null }] : [];
  });
}

export interface StageRow {
  name: string;
  duration_seconds: number;
  color: string;
  is_pause: boolean;
  alert: boolean;
}

/** Linha de time_stages → Stage (pausa/destaque só aparecem quando ligados). */
export function stageFromRow(r: StageRow): Stage {
  return {
    name: r.name,
    durationSeconds: r.duration_seconds,
    color: r.color,
    ...(r.is_pause ? { pause: true } : {}),
    ...(r.alert ? { alert: true } : {}),
  };
}

export async function loadProfileStages(q: Queryable, profileId: number): Promise<Stage[]> {
  const rows = await q.query<StageRow>('select name, duration_seconds, color, is_pause, alert from time_stages where profile_id = $1 order by position', [profileId]);
  return rows.map(stageFromRow);
}

export interface ScheduleRow {
  entryId: number;
  position: number;
  groupId: number;
  code: string;
  className: string;
  title: string;
  /** Cor de identificação do grupo. */
  color: string;
  timeProfileId: number | null;
  effectiveProfileId: number | null;
  durationSeconds: number;
  predictedStart: string | null;
  predictedEnd: string | null;
  overflow: boolean;
  movedAfterBreak: string | null;
  startedAt: string | null;
  endedAt: string | null;
  started: boolean;
  timerStatus: string | null;
  status: EntryStatus;
  statusLabel: string;
  isCurrent: boolean;
  expectedEvaluators: number;
  submittedEvaluators: number;
  excusedEvaluators: number;
  closureVersion: number | null;
}

export interface DaySchedule {
  day: {
    id: number;
    eventId: number;
    label: string;
    date: string;
    startTime: string;
    endTime: string;
    room: string | null;
    gapMinutes: number;
    defaultProfileId: number | null;
    primaryUserId: number | null;
    currentEntryId: number | null;
    breaks: Array<{ id: number; label: string; start: string; end: string }>;
  };
  entries: ScheduleRow[];
  warnings: string[];
  predictedEnd: string | null;
}

export async function getDaySchedule(q: Queryable, dayId: number): Promise<DaySchedule> {
  const d = await q.one<any>('select * from event_days where id = $1', [dayId]);
  if (!d) throw notFound('Dia de banca não encontrado.');
  const breaks = await q.query<any>('select id, label, start_time, end_time from breaks where day_id = $1 order by start_time', [dayId]);
  const rows = await q.query<any>(
    `select e.id, e.position, e.group_id, e.time_profile_id, e.started_at, e.ended_at,
            g.code, g.class_name, g.title, g.color,
            (select t.status from timer_sessions t where t.entry_id = e.id and not t.superseded) as timer_status,
            (select max(c.version) from evaluation_closures c where c.group_id = e.group_id and c.reopened_at is null) as closure_version
       from schedule_entries e join groups g on g.id = e.group_id
      where e.day_id = $1
      order by e.position`,
    [dayId],
  );
  const totals = new Map<number, number>(
    (await q.query<{ profile_id: number; total: number }>('select profile_id, sum(duration_seconds)::int as total from time_stages group by profile_id')).map((r) => [
      r.profile_id,
      r.total,
    ]),
  );
  const assignments = await q.query<{ user_id: number; group_id: number | null }>(
    'select user_id, group_id from evaluator_assignments where day_id = $1',
    [dayId],
  );
  const evals = await q.query<{ group_id: number; user_id: number; status: string }>(
    `select ev.group_id, ev.user_id, ev.status from evaluations ev
       join schedule_entries e on e.id = ev.entry_id where e.day_id = $1`,
    [dayId],
  );
  const excused = await q.query<{ group_id: number; user_id: number }>(
    `select x.group_id, ev.user_id from closure_exceptions x join evaluations ev on ev.id = x.evaluation_id
      where x.kind = 'evaluator_absent' and x.revoked_at is null and ev.group_id in (select group_id from schedule_entries where day_id = $1)`,
    [dayId],
  );

  const pred = computeSchedule({
    start: d.start_time,
    end: d.end_time,
    gapMinutes: d.gap_minutes,
    breaks: breaks.map((b) => ({ label: b.label, start: b.start_time, end: b.end_time })),
    items: rows.map((r) => {
      const pid = r.time_profile_id ?? d.default_profile_id;
      return { id: r.id, durationSeconds: pid ? totals.get(pid) ?? 0 : 0 };
    }),
  });
  const predById = new Map(pred.items.map((p) => [p.id, p]));

  const entries: ScheduleRow[] = rows.map((r) => {
    const effectiveProfileId = r.time_profile_id ?? d.default_profile_id ?? null;
    const p = predById.get(r.id)!;
    const evaluatorIds = new Set(assignments.filter((a) => a.group_id === null || a.group_id === r.group_id).map((a) => a.user_id));
    const submittedIds = new Set(evals.filter((e) => e.group_id === r.group_id && e.status === 'submitted' && evaluatorIds.has(e.user_id)).map((e) => e.user_id));
    const excusedIds = new Set(excused.filter((x) => x.group_id === r.group_id && evaluatorIds.has(x.user_id)).map((x) => x.user_id));
    const submitted = submittedIds.size;
    const exc = excusedIds.size;
    // Cada avaliador conta uma vez só (dispensado que também enviou não é contado em dobro).
    const resolved = new Set([...submittedIds, ...excusedIds]).size;
    const expected = evaluatorIds.size;
    let status: EntryStatus = 'waiting';
    if (r.closure_version !== null) status = 'finalized';
    else if (r.timer_status === 'running' || r.timer_status === 'paused') status = 'running';
    else if (r.started_at && expected > 0 && resolved >= expected) status = 'awaiting_closure';
    else if (r.started_at) status = 'started';
    return {
      entryId: r.id,
      position: r.position,
      groupId: r.group_id,
      code: r.code,
      className: r.class_name,
      title: r.title,
      color: r.color,
      timeProfileId: r.time_profile_id,
      effectiveProfileId,
      durationSeconds: effectiveProfileId ? totals.get(effectiveProfileId) ?? 0 : 0,
      predictedStart: formatHHMM(p.startSec),
      predictedEnd: formatHHMM(p.endSec),
      overflow: p.overflow,
      movedAfterBreak: p.movedAfterBreak,
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      started: !!r.started_at,
      timerStatus: r.timer_status,
      status,
      statusLabel: ENTRY_STATUS_LABEL[status],
      isCurrent: d.current_entry_id === r.id,
      expectedEvaluators: expected,
      submittedEvaluators: submitted,
      excusedEvaluators: exc,
      closureVersion: r.closure_version,
    };
  });

  const warnings = [...pred.warnings];
  const noProfile = entries.filter((e) => !e.effectiveProfileId);
  if (noProfile.length) warnings.push(`${noProfile.length} grupo(s) sem perfil de tempo definido (nem no grupo, nem no dia).`);

  return {
    day: {
      id: d.id,
      eventId: d.event_id,
      label: d.label,
      date: d.date,
      startTime: d.start_time,
      endTime: d.end_time,
      room: d.room,
      gapMinutes: d.gap_minutes,
      defaultProfileId: d.default_profile_id,
      primaryUserId: d.primary_user_id,
      currentEntryId: d.current_entry_id,
      breaks: breaks.map((b) => ({ id: b.id, label: b.label, start: b.start_time, end: b.end_time })),
    },
    entries,
    warnings,
    predictedEnd: entries.length ? formatHHMM(pred.endSec) : null,
  };
}
