import type { Queryable } from '../db/database.ts';
import { notFound } from '../http.ts';

/**
 * Duplicação de banca e de dia: copia a CONFIGURAÇÃO e nunca o andamento.
 * Não são copiados: cronômetro e eventos, apresentações iniciadas, avaliações, votos, exceções,
 * fechamentos, pareceres, telão ativo e a lixeira.
 */

const COPY_SUFFIX = ' (cópia)';

export interface DuplicateEventOptions {
  /** Leva também os grupos (alunos, materiais e arquivos), a distribuição nos dias e as atribuições por grupo. */
  includeGroups: boolean;
}

export interface DuplicateEventResult {
  id: number;
  days: number;
  voteQuestions: number;
  assignments: number;
  groups: number;
}

/** Copia as atribuições gerais do dia (todos os grupos) e devolve a quantidade. Só docentes ainda ativos. */
async function copyDayAssignments(q: Queryable, fromDayId: number, toDayId: number): Promise<number> {
  const rows = await q.query(
    `insert into evaluator_assignments (day_id, user_id, group_id, rubric_position)
     select $2, a.user_id, null, a.rubric_position
       from evaluator_assignments a join users u on u.id = a.user_id and u.deleted_at is null
      where a.day_id = $1 and a.group_id is null
     returning id`,
    [fromDayId, toDayId],
  );
  return rows.length;
}

async function copyBreaks(q: Queryable, fromDayId: number, toDayId: number) {
  await q.query(
    `insert into breaks (day_id, label, start_time, end_time)
     select $2, label, start_time, end_time from breaks where day_id = $1 order by start_time`,
    [fromDayId, toDayId],
  );
}

/** Insere um dia novo com os mesmos dados do dia `src` (sem apresentações) e devolve o id. */
async function insertDayCopy(q: Queryable, src: any, eventId: number, label: string, date: string | null): Promise<number> {
  // O Presidente da Banca só segue se ainda for um docente ativo.
  const primary = src.primary_user_id
    ? await q.one<{ id: number }>("select id from users where id = $1 and deleted_at is null and active and role = 'teacher'", [src.primary_user_id])
    : null;
  const row = await q.one<{ id: number }>(
    `insert into event_days (event_id, label, date, start_time, end_time, room, gap_minutes, default_profile_id, primary_user_id)
     values ($1,$2,coalesce($3::date, (select date from event_days where id = $10)),$4,$5,$6,$7,
             (select id from time_profiles where id = $8 and deleted_at is null),
             $9) returning id`,
    [eventId, label, date, src.start_time, src.end_time, src.room, src.gap_minutes, src.default_profile_id, primary?.id ?? null, src.id],
  );
  await copyBreaks(q, src.id, row!.id);
  return row!.id;
}

/** Duplica um dia dentro da mesma banca: horários, intervalos, sala, perfil de tempo, Presidente da Banca e escala de avaliadores. */
export async function duplicateDay(q: Queryable, dayId: number, opts: { date?: string } = {}) {
  const src = await q.one<any>('select d.*, e.name as event_name from event_days d join events e on e.id = d.event_id and e.deleted_at is null where d.id = $1 and d.deleted_at is null', [dayId]);
  if (!src) throw notFound('Dia não encontrado.');
  const label = src.label ? `${String(src.label).slice(0, 90)}${COPY_SUFFIX}` : 'Cópia';
  const id = await insertDayCopy(q, src, src.event_id, label, opts.date ?? null);
  const assignments = await copyDayAssignments(q, dayId, id);
  return { id, eventId: src.event_id as number, assignments };
}

/** Duplica uma banca inteira: dados, dias, intervalos, perguntas de votação, escala de avaliadores e, se pedido, os grupos. */
export async function duplicateEvent(q: Queryable, eventId: number, opts: DuplicateEventOptions): Promise<DuplicateEventResult> {
  const src = await q.one<any>('select id from events where id = $1 and deleted_at is null', [eventId]);
  if (!src) throw notFound('Banca não encontrada.');

  const created = await q.one<{ id: number }>(
    `insert into events (name, institution, period, timezone, report_header, report_subtitle, report_footer, report_color,
                         show_student_names, public_display, warn_pct, danger_pct, edit_after_submit, vote_privacy,
                         institution_detail, report_purpose, report_guidance, school_location, location_format, aggregation,
                         verdict_options, logo_data_url, rubric_type_id, stage_alert_before_seconds, stage_alert_after_seconds)
     select left(name, 200 - length($2::text)) || $2::text, institution, period, timezone, report_header, report_subtitle, report_footer, report_color,
            show_student_names, public_display, warn_pct, danger_pct, edit_after_submit, vote_privacy,
            institution_detail, report_purpose, report_guidance, school_location, location_format, aggregation,
            verdict_options, logo_data_url,
            (select id from rubric_types where id = events.rubric_type_id and deleted_at is null),
            stage_alert_before_seconds, stage_alert_after_seconds
       from events where id = $1 returning id`,
    [eventId, COPY_SUFFIX],
  );
  const newEventId = created!.id;

  // Dias (com intervalos e escala de avaliadores).
  const dayMap = new Map<number, number>();
  let assignments = 0;
  const days = await q.query<any>('select * from event_days where event_id = $1 and deleted_at is null order by date, start_time, id', [eventId]);
  for (const d of days) {
    const newDayId = await insertDayCopy(q, d, newEventId, d.label, null);
    dayMap.set(d.id, newDayId);
    assignments += await copyDayAssignments(q, d.id, newDayId);
  }

  // Perguntas de votação e opções.
  const questions = await q.query<any>('select * from vote_questions where event_id = $1 and deleted_at is null order by position, id', [eventId]);
  for (const vq of questions) {
    const nq = await q.one<{ id: number }>(
      `insert into vote_questions (event_id, position, title, prompt, enabled, required, allow_abstain, rule, quorum_min)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [newEventId, vq.position, vq.title, vq.prompt, vq.enabled, vq.required, vq.allow_abstain, vq.rule, vq.quorum_min],
    );
    await q.query(
      `insert into vote_options (question_id, position, label, is_abstain)
       select $2, position, label, is_abstain from vote_options where question_id = $1 order by position`,
      [vq.id, nq!.id],
    );
  }

  // Grupos (opcional): cadastro, alunos, materiais, arquivos, distribuição nos dias e atribuições por grupo.
  let groupCount = 0;
  if (opts.includeGroups) {
    const groupMap = new Map<number, number>();
    const groups = await q.query<any>('select * from groups where event_id = $1 and deleted_at is null order by code, id', [eventId]);
    for (const g of groups) {
      const ng = await q.one<{ id: number }>(
        `insert into groups (event_id, code, class_name, title, description, advisor, advisors, project_url, pdf_url, slides_url, github_url, color, rubric_type_id)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,
                 (select id from rubric_types where id = $13 and deleted_at is null)) returning id`,
        [newEventId, g.code, g.class_name, g.title, g.description, g.advisor, JSON.stringify(g.advisors ?? []), g.project_url, g.pdf_url, g.slides_url, g.github_url, g.color, g.rubric_type_id],
      );
      groupMap.set(g.id, ng!.id);
      const students = await q.query<{ name: string }>(
        'select s.name from group_students gs join students s on s.id = gs.student_id where gs.group_id = $1 order by gs.position',
        [g.id],
      );
      let i = 0;
      for (const s of students) {
        const ns = await q.one<{ id: number }>('insert into students (name) values ($1) returning id', [s.name]);
        await q.query('insert into group_students (group_id, student_id, position) values ($1, $2, $3)', [ng!.id, ns!.id, i++]);
      }
      await q.query(
        `insert into group_files (group_id, kind, filename, mime, size, data, uploaded_by)
         select $2, kind, filename, mime, size, data, uploaded_by from group_files where group_id = $1 and deleted_at is null`,
        [g.id, ng!.id],
      );
      groupCount++;
    }

    // Distribuição: o grupo novo entra no dia novo correspondente, na mesma posição (sem horários nem início).
    for (const [oldDay, newDay] of dayMap) {
      const entries = await q.query<any>(
        `select e.group_id, e.position, e.time_profile_id from schedule_entries e
           join groups g on g.id = e.group_id and g.deleted_at is null
          where e.day_id = $1 order by e.position`,
        [oldDay],
      );
      for (const e of entries) {
        const ng = groupMap.get(e.group_id);
        if (!ng) continue;
        await q.query(
          `insert into schedule_entries (day_id, group_id, position, time_profile_id)
           values ($1, $2, $3, (select id from time_profiles where id = $4 and deleted_at is null))`,
          [newDay, ng, e.position, e.time_profile_id],
        );
      }
      // Atribuições específicas de grupo (só dos grupos copiados e ainda com docente ativo).
      const specific = await q.query<any>(
        `select a.group_id, a.user_id, a.rubric_position from evaluator_assignments a
           join users u on u.id = a.user_id and u.deleted_at is null
          where a.day_id = $1 and a.group_id is not null`,
        [oldDay],
      );
      for (const a of specific) {
        const ng = groupMap.get(a.group_id);
        if (!ng) continue;
        await q.query('insert into evaluator_assignments (day_id, user_id, group_id, rubric_position) values ($1, $2, $3, $4)', [newDay, a.user_id, ng, a.rubric_position]);
        assignments++;
      }
    }
  }

  return { id: newEventId, days: days.length, voteQuestions: questions.length, assignments, groups: groupCount };
}
