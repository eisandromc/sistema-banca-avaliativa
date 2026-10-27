import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Queryable } from '../db/database.ts';
import { getDayAccess, requireAdmin, requireUser } from '../auth/session.ts';
import { badRequest, conflict, forbidden, notFound, paramId } from '../http.ts';
import { audit } from '../audit.ts';
import { softDelete } from '../services/trash.ts';
import { hashPassword } from '../auth/password.ts';
import { validateDayTimes } from '../../../shared/schedule.ts';
import { fichasOfType, getDaySchedule, resolveAssignments, stageFromRow } from '../services/schedule.ts';
import { stagesSchema } from './live.ts';
import { applyPiEventConfig, installPiRubrics } from '../templates/projetoIntegrador.ts';
import { eventReadiness } from '../services/readiness.ts';
import { GROUP_FILE_MAX_BYTES, isGithubLink, isSafeLink, nextGroupColor } from '../../../shared/groups.ts';
import { groupFilesFor, parseFileKind, uploadedFile, validateGroupFile } from '../services/groupFiles.ts';

// Limite do corpo no envio de arquivos do grupo: o arquivo mais uma folga.
const GROUP_FILE_BODY_LIMIT = GROUP_FILE_MAX_BYTES + 1024 * 1024;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');
const optText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const eventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  institution: optText(200),
  period: optText(100),
  timezone: z.string().trim().refine(validTimezone, 'fuso horário inválido').default('America/Sao_Paulo'),
  reportHeader: optText(200),
  reportSubtitle: optText(300),
  reportFooter: optText(300),
  reportColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1f3a5f'),
  showStudentNames: z.boolean().default(false),
  publicDisplay: z.boolean().default(true),
  warnPct: z.number().int().min(2).max(99).default(50),
  dangerPct: z.number().int().min(1).max(98).default(20),
  stageAlertBeforeSeconds: z.number().int().min(0).max(120).default(15),
  stageAlertAfterSeconds: z.number().int().min(0).max(60).default(5),
  editAfterSubmit: z.enum(['locked', 'until_closure']).default('locked'),
  votePrivacy: z.enum(['nominal', 'anonymous']).default('nominal'),
  institutionDetail: optText(200),
  reportPurpose: optText(3000),
  reportGuidance: optText(3000),
  schoolLocation: optText(300),
  locationFormat: z.string().trim().max(200).default('{sala} — {escola}'),
  aggregation: z.enum(['mean', 'sum']).default('mean'),
  verdictOptions: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  rubricTypeId: z.number().int().positive().nullable().default(null),
});

const daySchema = z.object({
  label: z.string().trim().max(100).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD'),
  startTime: hhmm,
  endTime: hhmm,
  room: optText(100),
  gapMinutes: z.number().int().min(0).max(120).default(5),
  defaultProfileId: z.number().int().positive().nullable().default(null),
  breaks: z.array(z.object({ label: z.string().trim().min(1).max(60).default('Intervalo'), start: hhmm, end: hhmm })).max(10).default([]),
});

const link = (allowLocal: boolean) =>
  z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isSafeLink(v, allowLocal), 'use um link começando com https://');

const groupSchema = z
  .object({
    code: z.string().trim().min(1).max(30),
    className: z.string().trim().max(60).default(''),
    title: z.string().trim().min(1).max(300),
    /** Resumo do projeto. */
    description: optText(4000),
    /** Campo antigo (um orientador); preferir `advisors`. */
    advisor: optText(200),
    advisors: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
    projectUrl: link(false),
    pdfUrl: link(true),
    slidesUrl: link(true),
    /** Repositório do projeto (https://github.com/…). */
    githubUrl: link(false).refine((v) => v === null || isGithubLink(v), 'use um link do GitHub (https://github.com/…)'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullish(),
    rubricTypeId: z.number().int().positive().nullable().default(null),
    students: z.array(z.string().trim().min(1).max(200)).min(1, 'informe ao menos um aluno').max(30),
  })
  .transform((g) => {
    const advisors = g.advisors ?? (g.advisor ? [g.advisor] : []);
    return { ...g, advisors, advisor: advisors.length ? advisors.join(', ') : null };
  });

const versionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    instructions: optText(4000),
    scaleMin: z.number().finite().default(0),
    scaleMax: z.number().finite().default(10),
    scaleStep: z.number().positive().default(0.5),
    normalization: z.enum(['linear']).nullable().default(null),
    generalCommentRequired: z.boolean().default(false),
    evaluatorRole: optText(200),
    dimension: optText(200),
    dimensionShort: optText(120),
    feedbackLabel: optText(200),
    scaleLabels: z.array(z.object({ value: z.number().finite(), label: z.string().trim().min(1).max(80) })).max(21).default([]),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    criteria: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          description: optText(2000),
          weight: z.number().positive('o peso deve ser positivo').max(1000),
          required: z.boolean().default(true),
          commentEnabled: z.boolean().default(false),
          commentRequired: z.boolean().default(false),
        }),
      )
      .min(1, 'a rubrica precisa de ao menos um critério')
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (v.scaleMax <= v.scaleMin) ctx.addIssue({ code: 'custom', message: 'a nota máxima deve ser maior que a mínima', path: ['scaleMax'] });
    const isDefault = v.scaleMin === 0 && v.scaleMax === 10;
    if (!isDefault && !v.normalization) {
      ctx.addIssue({ code: 'custom', message: 'escala diferente de 0–10 exige normalização explícita', path: ['normalization'] });
    }
    v.criteria.forEach((c, i) => {
      if (c.commentRequired && !c.commentEnabled) ctx.addIssue({ code: 'custom', message: 'justificativa obrigatória exige campo de comentário habilitado', path: ['criteria', i] });
    });
  });

const voteSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(1000),
    enabled: z.boolean().default(true),
    required: z.boolean().default(true),
    allowAbstain: z.boolean().default(true),
    rule: z.enum(['simple_majority', 'quorum', 'counts_only']).default('simple_majority'),
    quorumMin: z.number().int().positive().nullable().default(null),
    position: z.number().int().min(0).default(0),
    options: z.array(z.object({ label: z.string().trim().min(1).max(100), isAbstain: z.boolean().default(false) })).min(2).max(10),
  })
  .superRefine((v, ctx) => {
    if (v.options.filter((o) => !o.isAbstain).length < 2) ctx.addIssue({ code: 'custom', message: 'informe ao menos duas opções que não sejam abstenção', path: ['options'] });
    if (v.options.some((o) => o.isAbstain) && !v.allowAbstain) ctx.addIssue({ code: 'custom', message: 'opção de abstenção exige "permitir abstenção"', path: ['options'] });
    if (v.rule === 'quorum' && !v.quorumMin) ctx.addIssue({ code: 'custom', message: 'regra de quórum exige quórum mínimo', path: ['quorumMin'] });
  });

async function replaceBreaks(q: Queryable, dayId: number, breaks: z.infer<typeof daySchema>['breaks']) {
  await q.query('delete from breaks where day_id = $1', [dayId]);
  for (const b of breaks) await q.query('insert into breaks (day_id, label, start_time, end_time) values ($1, $2, $3, $4)', [dayId, b.label, b.start, b.end]);
}

async function replaceStages(q: Queryable, profileId: number, stages: z.infer<typeof stagesSchema>) {
  await q.query('delete from time_stages where profile_id = $1', [profileId]);
  let i = 0;
  for (const s of stages) {
    await q.query('insert into time_stages (profile_id, position, name, duration_seconds, color, is_pause, alert) values ($1, $2, $3, $4, $5, $6, $7)', [
      profileId,
      i++,
      s.name,
      s.durationSeconds,
      s.color,
      !!s.pause,
      !!s.alert,
    ]);
  }
}

async function replaceStudents(q: Queryable, groupId: number, names: string[]) {
  const old = await q.query<{ student_id: number }>('select student_id from group_students where group_id = $1', [groupId]);
  await q.query('delete from group_students where group_id = $1', [groupId]);
  if (old.length) {
    await q.query('delete from students where id = any($1::int[]) and not exists (select 1 from group_students gs where gs.student_id = students.id)', [
      old.map((o) => o.student_id),
    ]);
  }
  let i = 0;
  for (const name of names) {
    const s = await q.one<{ id: number }>('insert into students (name) values ($1) returning id', [name]);
    await q.query('insert into group_students (group_id, student_id, position) values ($1, $2, $3)', [groupId, s!.id, i++]);
  }
}

async function insertVersion(q: Queryable, templateId: number, version: number, v: z.infer<typeof versionSchema>) {
  const row = await q.one<{ id: number }>(
    `insert into rubric_versions (template_id, version, title, instructions, scale_min, scale_max, scale_step, normalization, general_comment_required,
                                  evaluator_role, dimension, dimension_short, feedback_label, scale_labels, sort_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [
      templateId,
      version,
      v.title,
      v.instructions,
      v.scaleMin,
      v.scaleMax,
      v.scaleStep,
      v.normalization,
      v.generalCommentRequired,
      v.evaluatorRole,
      v.dimension,
      v.dimensionShort,
      v.feedbackLabel,
      v.scaleLabels,
      v.sortOrder,
    ],
  );
  await insertCriteria(q, row!.id, v.criteria);
  return row!.id;
}

async function insertCriteria(q: Queryable, versionId: number, criteria: z.infer<typeof versionSchema>['criteria']) {
  let i = 0;
  for (const c of criteria) {
    await q.query(
      `insert into rubric_criteria (version_id, position, title, description, weight, required, comment_enabled, comment_required)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [versionId, i++, c.title, c.description, c.weight, c.required, c.commentEnabled, c.commentRequired],
    );
  }
}

async function versionInUse(q: Queryable, versionId: number) {
  return !!(await q.one('select 1 from evaluations where rubric_version_id = $1 limit 1', [versionId]));
}

/** Atribuições que hoje resolvem para a versão `v` (a vigente da ficha no tipo da banca); usar com o alias `v`. */
const ASSIGNED_SQL = `(select count(*)::int from evaluator_assignments a
    join event_days d on d.id = a.day_id and d.deleted_at is null
    join events e on e.id = d.event_id and e.deleted_at is null
    join rubric_templates t on t.id = v.template_id
   where e.rubric_type_id = t.type_id and a.rubric_position = t.type_position
     and not exists (select 1 from rubric_versions n where n.template_id = v.template_id and n.deleted_at is null and n.version > v.version))`;

/**
 * A rubrica vem do tipo da banca (ou do grupo); a atribuição só escolhe a ficha. Garante que a ficha existe
 * no tipo que vale para o dia (ou para o grupo, na atribuição específica).
 */
async function requireFicha(q: Queryable, dayId: number, position: number, groupId: number | null = null) {
  const r = await q.one<{ type_id: number | null; type_name: string | null }>(
    `select t.id as type_id, t.name as type_name
       from event_days d join events e on e.id = d.event_id
       left join groups g on g.id = $2
       left join rubric_types t on t.id = coalesce(g.rubric_type_id, e.rubric_type_id)
      where d.id = $1 and d.deleted_at is null`,
    [dayId, groupId],
  );
  if (!r) throw badRequest('Dia inválido.');
  if (!r.type_id) throw badRequest('Vincule um tipo de rubrica à banca (Editar banca) antes de designar avaliadores.');
  if (!(await fichasOfType(q, r.type_id)).has(position)) throw badRequest(`A ${position}ª ficha não existe no tipo de rubrica "${r.type_name}".`);
}

async function dayHasStarted(q: Queryable, dayId: number) {
  return !!(await q.one('select 1 from schedule_entries where day_id = $1 and started_at is not null limit 1', [dayId]));
}

export async function adminRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  /** Leitura do cronograma: administrador ou primário do dia. */
  async function requireDayManager(req: FastifyRequest, dayId: number) {
    const user = requireUser(req);
    const access = await getDayAccess(db, user, dayId);
    if (!access.canControl) throw forbidden();
    return user;
  }

  // ---------- Visão geral ----------
  app.get('/admin/overview', async (req) => {
    requireAdmin(req);
    const one = async (sql: string) => (await db.one<{ n: number }>(sql))!.n;
    return {
      events: await one('select count(*)::int as n from events where deleted_at is null'),
      days: await one('select count(*)::int as n from event_days where deleted_at is null'),
      groups: await one('select count(*)::int as n from groups where deleted_at is null'),
      teachers: await one("select count(*)::int as n from users where role = 'teacher' and active and deleted_at is null"),
      rubrics: await one(
        `select count(*)::int as n from rubric_versions v
          where v.deleted_at is null
            and not exists (select 1 from rubric_templates t join rubric_types ty on ty.id = t.type_id where t.id = v.template_id and ty.deleted_at is not null)`,
      ),
      started: await one('select count(*)::int as n from schedule_entries where started_at is not null'),
      closed: await one('select count(*)::int as n from evaluation_closures where reopened_at is null'),
      running: await one("select count(*)::int as n from timer_sessions where status in ('running','paused')"),
    };
  });

  /** Roteiro de preparação da banca: itens prontos, de atenção e pendentes, por dia. */
  app.get('/events/:id/readiness', async (req) => {
    requireAdmin(req);
    return eventReadiness(db, paramId(req));
  });

  // ---------- Usuários ----------
  app.get('/users', async (req) => {
    requireAdmin(req);
    // Usuário excluído só vem enquanto ainda estiver vinculado a um dia: a tela de contas o omite (fica só na Lixeira),
    // mas os vínculos o exibem taxado.
    const users = await db.query<any>(
      `select u.id, u.name, u.email, u.role, u.active, u.created_at as "createdAt", (u.deleted_at is not null) as deleted
         from users u
        where u.deleted_at is null
           or (u.purged_at is null and (
                exists (select 1 from evaluator_assignments a join event_days d on d.id = a.day_id join events e on e.id = d.event_id
                         where a.user_id = u.id and d.deleted_at is null and e.deleted_at is null)
             or exists (select 1 from event_days d join events e on e.id = d.event_id
                         where d.primary_user_id = u.id and d.deleted_at is null and e.deleted_at is null)))
        order by u.role, u.name`,
    );
    const days = await db.query<any>(
      `select a.user_id, d.id, d.label, d.date, e.name as event_name
         from evaluator_assignments a join event_days d on d.id = a.day_id join events e on e.id = d.event_id
        where a.group_id is null and d.deleted_at is null and e.deleted_at is null order by d.date, d.id`,
    );
    return {
      users: users.map((u) => ({
        ...u,
        days: days.filter((d) => d.user_id === u.id).map((d) => ({ id: d.id, label: d.label, date: d.date, eventName: d.event_name })),
      })),
    };
  });

  app.post('/users', async (req) => {
    const admin = requireAdmin(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200),
        email: z.string().trim().email().max(200),
        role: z.enum(['admin', 'teacher', 'viewer']),
        password: z.string().min(8, 'mínimo de 8 caracteres').max(200),
      })
      .parse(req.body);
    return db.tx(async (q) => {
      const row = await q.one<{ id: number }>('insert into users (name, email, role, password_hash) values ($1, $2, $3, $4) returning id', [
        body.name,
        body.email.toLowerCase(),
        body.role,
        await hashPassword(body.password),
      ]);
      await audit(q, admin.id, 'user.created', 'user', row!.id, { email: body.email, role: body.role });
      return { id: row!.id };
    });
  });

  app.patch('/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        email: z.string().trim().email().max(200).optional(),
        role: z.enum(['admin', 'teacher', 'viewer']).optional(),
        active: z.boolean().optional(),
        password: z.string().min(8).max(200).optional(),
      })
      .parse(req.body);
    if (id === admin.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('Você não pode desativar nem rebaixar a própria conta.');
    }
    return db.tx(async (q) => {
      const u = await q.one('select id from users where id = $1 and deleted_at is null', [id]);
      if (!u) throw notFound();
      await q.query(
        `update users set name = coalesce($2, name), email = coalesce($3, email), role = coalesce($4, role), active = coalesce($5, active),
                password_hash = coalesce($6, password_hash) where id = $1`,
        [id, body.name ?? null, body.email?.toLowerCase() ?? null, body.role ?? null, body.active ?? null, body.password ? await hashPassword(body.password) : null],
      );
      if (body.active === false || body.password) await q.query('delete from auth_sessions where user_id = $1', [id]);
      await audit(q, admin.id, 'user.updated', 'user', id, { ...body, password: body.password ? '(alterada)' : undefined });
      return { ok: true };
    });
  });

  /** Dias de banca do professor: em quais participa (atribuição geral do dia) e com qual rubrica. */
  app.delete('/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    if (id === admin.id) throw badRequest('Você não pode excluir a própria conta.');
    return db.tx(async (q) => {
      if (!(await softDelete(q, 'user', id, admin.id))) throw notFound();
      await q.query('delete from auth_sessions where user_id = $1', [id]);
      await audit(q, admin.id, 'user.deleted', 'user', id, {});
      return { ok: true };
    });
  });

  app.get('/users/:id/days', async (req) => {
    requireAdmin(req);
    const userId = paramId(req);
    const rows = await db.query<any>(
      `select d.id, d.label, d.date, d.room, e.name as event_name, d.primary_user_id,
              d.event_id, e.rubric_type_id as event_type_id, a.rubric_position,
              (select count(*)::int from evaluator_assignments g where g.day_id = d.id and g.user_id = $1 and g.group_id is not null) as group_specific,
              exists(select 1 from evaluations ev join schedule_entries se on se.id = ev.entry_id where se.day_id = d.id and ev.user_id = $1) as has_evaluations
         from event_days d join events e on e.id = d.event_id
         left join evaluator_assignments a on a.day_id = d.id and a.user_id = $1 and a.group_id is null
        where d.deleted_at is null and e.deleted_at is null
        order by d.date, d.id`,
      [userId],
    );
    return {
      days: rows.map((r) => ({
        dayId: r.id,
        label: r.label,
        date: r.date,
        room: r.room,
        eventName: r.event_name,
        eventId: r.event_id,
        eventTypeId: r.event_type_id,
        assigned: r.rubric_position !== null,
        rubricPosition: r.rubric_position,
        isPrimary: r.primary_user_id === userId,
        groupSpecific: r.group_specific,
        hasEvaluations: r.has_evaluations,
      })),
    };
  });

  /**
   * Define em quais dias o professor participa (lista completa): cria, atualiza a ficha ou remove
   * a atribuição geral de cada dia. Não remove dia em que ele já tem fichas ou é o professor primário.
   */
  app.put('/users/:id/days', async (req) => {
    const admin = requireAdmin(req);
    const userId = paramId(req);
    const body = z
      .object({ days: z.array(z.object({ dayId: z.number().int().positive(), rubricPosition: z.number().int().positive() })).max(200) })
      .parse(req.body);
    return db.tx(async (q) => {
      const u = await q.one<any>('select role, active from users where id = $1 and deleted_at is null', [userId]);
      if (!u) throw notFound();
      if (body.days.length && u.role !== 'teacher') throw badRequest('Somente contas de professor participam das bancas como avaliadoras.');
      const wanted = new Map(body.days.map((d) => [d.dayId, d.rubricPosition]));
      const current = await q.query<any>('select id, day_id, rubric_position from evaluator_assignments where user_id = $1 and group_id is null', [userId]);
      const problems: string[] = [];
      for (const c of current) {
        if (wanted.has(c.day_id)) continue;
        const day = await q.one<any>('select label, date, primary_user_id from event_days where id = $1', [c.day_id]);
        const name = `${day.label || 'Dia'} (${day.date})`;
        if (day.primary_user_id === userId) problems.push(`${name}: é o professor primário — troque o primário antes.`);
        else if (
          await q.one('select 1 from evaluations ev join schedule_entries se on se.id = ev.entry_id where se.day_id = $1 and ev.user_id = $2 limit 1', [c.day_id, userId])
        )
          problems.push(`${name}: já possui fichas de avaliação — registre dispensa no fechamento em vez de remover.`);
      }
      if (problems.length) throw conflict('Não foi possível remover o professor de alguns dias: ' + problems.join(' '), 'IN_USE', problems);
      let added = 0;
      let updated = 0;
      let removed = 0;
      for (const c of current) {
        if (!wanted.has(c.day_id)) {
          await q.query('delete from evaluator_assignments where id = $1', [c.id]);
          removed++;
        } else if (wanted.get(c.day_id) !== c.rubric_position) {
          await requireFicha(q, c.day_id, wanted.get(c.day_id)!);
          await q.query('update evaluator_assignments set rubric_position = $2 where id = $1', [c.id, wanted.get(c.day_id)]);
          updated++;
        }
      }
      for (const [dayId, position] of wanted) {
        if (current.some((c) => c.day_id === dayId)) continue;
        await requireFicha(q, dayId, position);
        await q.query('insert into evaluator_assignments (day_id, user_id, group_id, rubric_position) values ($1, $2, null, $3)', [dayId, userId, position]);
        added++;
      }
      await audit(q, admin.id, 'user.days_updated', 'user', userId, { days: body.days, added, updated, removed });
      return { added, updated, removed };
    });
  });

  // ---------- Bancas (eventos) ----------
  app.get('/events', async (req) => {
    requireAdmin(req);
    const events = await db.query<any>('select *, (logo_data_url is not null) as has_logo_flag from events where deleted_at is null order by created_at desc');
    const days = await db.query<any>(
      `select d.*, (select a.rubric_position from evaluator_assignments a
                     where a.day_id = d.id and a.user_id = d.primary_user_id and a.group_id is null) as primary_rubric_position
         from event_days d where d.deleted_at is null order by d.date, d.start_time`,
    );
    const breaks = await db.query<any>('select * from breaks order by start_time');
    return {
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        institution: e.institution,
        period: e.period,
        timezone: e.timezone,
        reportHeader: e.report_header,
        reportSubtitle: e.report_subtitle,
        reportFooter: e.report_footer,
        reportColor: e.report_color,
        showStudentNames: e.show_student_names,
        publicDisplay: e.public_display,
        warnPct: e.warn_pct,
        dangerPct: e.danger_pct,
        stageAlertBeforeSeconds: e.stage_alert_before_seconds,
        stageAlertAfterSeconds: e.stage_alert_after_seconds,
        editAfterSubmit: e.edit_after_submit,
        votePrivacy: e.vote_privacy,
        institutionDetail: e.institution_detail,
        reportPurpose: e.report_purpose,
        reportGuidance: e.report_guidance,
        schoolLocation: e.school_location,
        locationFormat: e.location_format,
        aggregation: e.aggregation,
        verdictOptions: e.verdict_options ?? [],
        rubricTypeId: e.rubric_type_id,
        hasLogo: !!e.logo_data_url,
        days: days
          .filter((d) => d.event_id === e.id)
          .map((d) => ({
            id: d.id,
            label: d.label,
            date: d.date,
            startTime: d.start_time,
            endTime: d.end_time,
            room: d.room,
            gapMinutes: d.gap_minutes,
            defaultProfileId: d.default_profile_id,
            primaryUserId: d.primary_user_id,
            primaryRubricPosition: d.primary_rubric_position,
            breaks: breaks.filter((b) => b.day_id === d.id).map((b) => ({ id: b.id, label: b.label, start: b.start_time, end: b.end_time })),
          })),
      })),
    };
  });

  const eventParams = (b: z.infer<typeof eventSchema>) => {
    if (b.dangerPct >= b.warnPct) throw badRequest('O limiar laranja deve ser menor que o amarelo.');
    return [
      b.name,
      b.institution,
      b.period,
      b.timezone,
      b.reportHeader,
      b.reportSubtitle,
      b.reportFooter,
      b.reportColor,
      b.showStudentNames,
      b.publicDisplay,
      b.warnPct,
      b.dangerPct,
      b.editAfterSubmit,
      b.votePrivacy,
      b.institutionDetail,
      b.reportPurpose,
      b.reportGuidance,
      b.schoolLocation,
      b.locationFormat || '{sala} — {escola}',
      b.aggregation,
      b.verdictOptions,
      b.rubricTypeId,
      b.stageAlertBeforeSeconds,
      b.stageAlertAfterSeconds,
    ];
  };

  app.post('/events', async (req) => {
    const admin = requireAdmin(req);
    const body = eventSchema.parse(req.body);
    return db.tx(async (q) => {
      const row = await q.one<{ id: number }>(
        `insert into events (name, institution, period, timezone, report_header, report_subtitle, report_footer, report_color,
                             show_student_names, public_display, warn_pct, danger_pct, edit_after_submit, vote_privacy,
                             institution_detail, report_purpose, report_guidance, school_location, location_format, aggregation, verdict_options, rubric_type_id,
                             stage_alert_before_seconds, stage_alert_after_seconds)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) returning id`,
        eventParams(body),
      );
      await audit(q, admin.id, 'event.created', 'event', row!.id, { name: body.name });
      return { id: row!.id };
    });
  });

  app.put('/events/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = eventSchema.parse(req.body);
    return db.tx(async (q) => {
      const r = await q.query(
        `update events set name=$2, institution=$3, period=$4, timezone=$5, report_header=$6, report_subtitle=$7, report_footer=$8,
                report_color=$9, show_student_names=$10, public_display=$11, warn_pct=$12, danger_pct=$13, edit_after_submit=$14, vote_privacy=$15,
                institution_detail=$16, report_purpose=$17, report_guidance=$18, school_location=$19, location_format=$20, aggregation=$21,
                verdict_options=$22, rubric_type_id=$23, stage_alert_before_seconds=$24, stage_alert_after_seconds=$25
          where id = $1 returning id`,
        [id, ...eventParams(body)],
      );
      if (!r.length) throw notFound();
      await audit(q, admin.id, 'event.updated', 'event', id, body);
      return { ok: true };
    });
  });

  app.delete('/events/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      const started = await q.one(
        'select 1 from schedule_entries e join event_days d on d.id = e.day_id where d.event_id = $1 and e.started_at is not null limit 1',
        [id],
      );
      if (started) throw conflict('A banca já possui apresentações iniciadas e não pode ser excluída.', 'IN_USE');
      if (!(await softDelete(q, 'event', id, admin.id))) throw notFound();
      await q.query('update event_days set display_active_at = null, display_activated_by = null where event_id = $1', [id]);
      await audit(q, admin.id, 'event.deleted', 'event', id);
      return { ok: true };
    });
  });

  // ---------- Dias e intervalos ----------
  app.post('/events/:id/days', async (req) => {
    const admin = requireAdmin(req);
    const eventId = paramId(req);
    const body = daySchema.parse(req.body);
    const errors = validateDayTimes(body.startTime, body.endTime, body.breaks);
    if (errors.length) throw badRequest(errors.join(' '), errors);
    return db.tx(async (q) => {
      if (!(await q.one('select 1 from events where id = $1 and deleted_at is null', [eventId]))) throw notFound('Banca não encontrada.');
      const row = await q.one<{ id: number }>(
        `insert into event_days (event_id, label, date, start_time, end_time, room, gap_minutes, default_profile_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [eventId, body.label, body.date, body.startTime, body.endTime, body.room, body.gapMinutes, body.defaultProfileId],
      );
      await replaceBreaks(q, row!.id, body.breaks);
      await audit(q, admin.id, 'day.created', 'event_day', row!.id, body);
      return { id: row!.id };
    });
  });

  app.put('/days/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = daySchema.parse(req.body);
    const errors = validateDayTimes(body.startTime, body.endTime, body.breaks);
    if (errors.length) throw badRequest(errors.join(' '), errors);
    return db.tx(async (q) => {
      const r = await q.query(
        `update event_days set label=$2, date=$3, start_time=$4, end_time=$5, room=$6, gap_minutes=$7, default_profile_id=$8
          where id = $1 returning id`,
        [id, body.label, body.date, body.startTime, body.endTime, body.room, body.gapMinutes, body.defaultProfileId],
      );
      if (!r.length) throw notFound();
      await replaceBreaks(q, id, body.breaks);
      await audit(q, admin.id, 'day.updated', 'event_day', id, body);
      return { ok: true };
    });
  });

  app.delete('/days/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      if (await dayHasStarted(q, id)) throw conflict('Este dia já possui apresentações iniciadas e não pode ser excluído.', 'IN_USE');
      if (!(await softDelete(q, 'day', id, admin.id))) throw notFound();
      // O dia sai de cena: os grupos voltam para "não distribuídos" e a tela do telão é desativada.
      await q.query('delete from evaluator_assignments where day_id = $1', [id]);
      await q.query('delete from schedule_entries where day_id = $1', [id]);
      await q.query('update event_days set display_active_at = null, display_activated_by = null, current_entry_id = null where id = $1', [id]);
      await audit(q, admin.id, 'day.deleted', 'event_day', id);
      return { ok: true };
    });
  });

  /**
   * Designa (ou remove) o professor primário do dia — no máximo um ativo, com registro administrativo.
   * O primário também avalia, igual aos demais: a designação exige uma rubrica e cria/atualiza
   * a atribuição dele para todos os grupos do dia.
   */
  app.put('/days/:id/primary', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = z
      .object({ userId: z.number().int().positive().nullable(), rubricPosition: z.number().int().positive().nullable().optional(), reason: optText(500) })
      .parse(req.body);
    return db.tx(async (q) => {
      const day = await q.one<any>('select primary_user_id from event_days where id = $1 for update', [id]);
      if (!day) throw notFound();
      let assignment: { id: number; created: boolean } | null = null;
      if (body.userId !== null) {
        const u = await q.one<any>('select role, active from users where id = $1 and deleted_at is null', [body.userId]);
        if (!u || u.role !== 'teacher' || !u.active) throw badRequest('O professor primário deve ser um docente ativo.');
        if (!body.rubricPosition) throw badRequest('Escolha a ficha que o professor primário vai preencher.');
        await requireFicha(q, id, body.rubricPosition);
        const existing = await q.one<{ id: number }>('select id from evaluator_assignments where day_id = $1 and user_id = $2 and group_id is null', [
          id,
          body.userId,
        ]);
        if (existing) {
          await q.query('update evaluator_assignments set rubric_position = $2 where id = $1', [existing.id, body.rubricPosition]);
          assignment = { id: existing.id, created: false };
        } else {
          const row = await q.one<{ id: number }>(
            'insert into evaluator_assignments (day_id, user_id, group_id, rubric_position) values ($1, $2, null, $3) returning id',
            [id, body.userId, body.rubricPosition],
          );
          assignment = { id: row!.id, created: true };
        }
      }
      await q.query('update event_days set primary_user_id = $2 where id = $1', [id, body.userId]);
      await audit(q, admin.id, 'day.primary_changed', 'event_day', id, {
        from: day.primary_user_id,
        to: body.userId,
        rubricPosition: body.rubricPosition ?? null,
        assignment,
        reason: body.reason,
      });
      app.ctx.hub.broadcast(id, { type: 'day-changed', dayId: id, reason: 'primary_changed' });
      return { ok: true };
    });
  });

  // ---------- Perfis de tempo ----------
  app.get('/profiles', async (req) => {
    requireUser(req);
    const stages = await db.query<any>('select * from time_stages order by profile_id, position');
    const usage = await db.query<any>(
      `select p.id, (select count(*)::int from event_days d where d.default_profile_id = p.id and d.deleted_at is null) +
                    (select count(*)::int from schedule_entries e where e.time_profile_id = p.id) as n
         from time_profiles p`,
    );
    // Perfis na lixeira ainda vinculados a dias/grupos vêm marcados como excluídos: a tela de perfis os omite (ficam só na Lixeira),
    // mas os vínculos os exibem taxados.
    const profiles = (await db.query<any>('select * from time_profiles order by name')).filter(
      (p) => !p.deleted_at || (usage.find((u) => u.id === p.id)?.n ?? 0) > 0,
    );
    return {
      profiles: profiles.map((p) => {
        const st = stages.filter((s) => s.profile_id === p.id).map(stageFromRow);
        return {
          id: p.id,
          name: p.name,
          active: p.active,
          stages: st,
          totalSeconds: st.reduce((a, s) => a + s.durationSeconds, 0),
          usage: usage.find((u) => u.id === p.id)?.n ?? 0,
          deleted: !!p.deleted_at,
        };
      }),
    };
  });

  const profileSchema = z.object({ name: z.string().trim().min(1).max(100), active: z.boolean().default(true), stages: stagesSchema });

  app.post('/profiles', async (req) => {
    const admin = requireAdmin(req);
    const body = profileSchema.parse(req.body);
    return db.tx(async (q) => {
      const row = await q.one<{ id: number }>('insert into time_profiles (name, active) values ($1, $2) returning id', [body.name, body.active]);
      await replaceStages(q, row!.id, body.stages);
      await audit(q, admin.id, 'profile.created', 'time_profile', row!.id, body);
      return { id: row!.id };
    });
  });

  app.put('/profiles/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = profileSchema.parse(req.body);
    return db.tx(async (q) => {
      const before = await q.query('select name, duration_seconds, color, is_pause, alert from time_stages where profile_id = $1 order by position', [id]);
      const r = await q.query('update time_profiles set name = $2, active = $3 where id = $1 and deleted_at is null returning id', [id, body.name, body.active]);
      if (!r.length) throw notFound();
      // Sessões já iniciadas usam cópia própria das etapas: a edição não as altera.
      await replaceStages(q, id, body.stages);
      await audit(q, admin.id, 'profile.updated', 'time_profile', id, { before, after: body.stages });
      return { ok: true };
    });
  });

  app.post('/profiles/:id/duplicate', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      const p = await q.one<any>('select * from time_profiles where id = $1 and deleted_at is null', [id]);
      if (!p) throw notFound();
      const row = await q.one<{ id: number }>('insert into time_profiles (name, active) values ($1, $2) returning id', [`${p.name} (cópia)`, p.active]);
      await q.query(
        `insert into time_stages (profile_id, position, name, duration_seconds, color, is_pause, alert)
         select $2, position, name, duration_seconds, color, is_pause, alert from time_stages where profile_id = $1`,
        [id, row!.id],
      );
      await audit(q, admin.id, 'profile.duplicated', 'time_profile', row!.id, { from: id });
      return { id: row!.id };
    });
  });

  app.delete('/profiles/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      // Em uso por dias ou grupos: vai para a lixeira e continua aparecendo taxado onde estava vinculado.
      if (!(await softDelete(q, 'profile', id, admin.id))) throw notFound();
      await audit(q, admin.id, 'profile.deleted', 'time_profile', id);
      return { ok: true };
    });
  });

  // ---------- Grupos e alunos ----------
  app.get('/events/:id/groups', async (req) => {
    requireAdmin(req);
    const eventId = paramId(req);
    const groups = await db.query<any>(
      `select g.*, e.id as entry_id, e.day_id, e.position, e.time_profile_id, e.started_at
         from groups g left join schedule_entries e on e.group_id = g.id
        where g.event_id = $1 and g.deleted_at is null order by g.code`,
      [eventId],
    );
    const students = await db.query<any>(
      `select gs.group_id, s.name from group_students gs join students s on s.id = gs.student_id
        where gs.group_id in (select id from groups where event_id = $1 and deleted_at is null) order by gs.position`,
      [eventId],
    );
    const files = await groupFilesFor(db, groups.map((g) => g.id));
    return {
      groups: groups.map((g) => ({
        id: g.id,
        code: g.code,
        className: g.class_name,
        title: g.title,
        description: g.description,
        advisor: g.advisor,
        advisors: g.advisors ?? [],
        projectUrl: g.project_url,
        pdfUrl: g.pdf_url,
        slidesUrl: g.slides_url,
        githubUrl: g.github_url,
        slidesFile: files.get(g.id)?.slides ?? null,
        articleFile: files.get(g.id)?.article ?? null,
        color: g.color,
        rubricTypeId: g.rubric_type_id,
        students: students.filter((s) => s.group_id === g.id).map((s) => s.name),
        entryId: g.entry_id,
        dayId: g.day_id,
        position: g.position,
        timeProfileId: g.time_profile_id,
        started: !!g.started_at,
      })),
    };
  });

  const groupParams = (b: z.infer<typeof groupSchema>, color: string) => [
    b.code,
    b.className,
    b.title,
    b.description,
    b.advisor,
    JSON.stringify(b.advisors),
    b.projectUrl,
    b.pdfUrl,
    b.slidesUrl,
    color,
    b.rubricTypeId,
    b.githubUrl,
  ];

  app.post('/events/:id/groups', async (req) => {
    const admin = requireAdmin(req);
    const eventId = paramId(req);
    const body = groupSchema.parse(req.body);
    return db.tx(async (q) => {
      // Cor de identificação gerada automaticamente (a menos usada na banca), se não informada.
      const used = await q.query<{ color: string }>('select color from groups where event_id = $1 and deleted_at is null', [eventId]);
      const color = body.color ?? nextGroupColor(used.map((u) => u.color));
      const row = await q.one<{ id: number }>(
        `insert into groups (event_id, code, class_name, title, description, advisor, advisors, project_url, pdf_url, slides_url, color, rubric_type_id, github_url)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13) returning id`,
        [eventId, ...groupParams(body, color)],
      );
      await replaceStudents(q, row!.id, body.students);
      await audit(q, admin.id, 'group.created', 'group', row!.id, { code: body.code, color });
      return { id: row!.id, color };
    });
  });

  app.put('/groups/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = groupSchema.parse(req.body);
    return db.tx(async (q) => {
      if (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [id])) {
        throw conflict('Grupo com avaliação fechada: reabra antes de alterar os dados.', 'CLOSED');
      }
      const cur = await q.one<{ color: string }>('select color from groups where id = $1 and deleted_at is null', [id]);
      if (!cur) throw notFound();
      await q.query(
        `update groups set code=$2, class_name=$3, title=$4, description=$5, advisor=$6, advisors=$7::jsonb, project_url=$8, pdf_url=$9,
                slides_url=$10, color=$11, rubric_type_id=$12, github_url=$13
          where id = $1`,
        [id, ...groupParams(body, body.color ?? cur.color)],
      );
      await replaceStudents(q, id, body.students);
      await audit(q, admin.id, 'group.updated', 'group', id, { code: body.code });
      return { ok: true };
    });
  });

  app.delete('/groups/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      if (await q.one('select 1 from schedule_entries where group_id = $1 and started_at is not null', [id])) {
        throw conflict('O grupo já se apresentou; não pode ser excluído (histórico preservado).', 'IN_USE');
      }
      if (!(await softDelete(q, 'group', id, admin.id))) throw notFound();
      // O grupo sai do cronograma e das atribuições específicas (o cadastro e os alunos ficam na lixeira).
      await q.query('delete from evaluator_assignments where group_id = $1', [id]);
      await q.query('delete from schedule_entries where group_id = $1', [id]);
      await audit(q, admin.id, 'group.deleted', 'group', id);
      return { ok: true };
    });
  });

  // Arquivos do grupo (slides e artigo). O corpo é o próprio arquivo; o nome vai no cabeçalho x-filename.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: GROUP_FILE_BODY_LIMIT }, (_req, body, done) => done(null, body));

  const assertGroupEditable = async (q: Queryable, groupId: number) => {
    if (!(await q.one('select 1 from groups where id = $1 and deleted_at is null', [groupId]))) throw notFound('Grupo não encontrado.');
    if (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [groupId])) {
      throw conflict('Grupo com avaliação fechada: reabra antes de alterar os materiais.', 'CLOSED');
    }
  };

  app.put('/groups/:id/files/:kind', { bodyLimit: GROUP_FILE_BODY_LIMIT }, async (req) => {
    const admin = requireAdmin(req);
    const groupId = paramId(req);
    const kind = parseFileKind((req.params as any).kind);
    const data = req.body;
    if (!Buffer.isBuffer(data)) throw badRequest('Envie o arquivo com Content-Type: application/octet-stream.');
    let rawName = String(req.headers['x-filename'] ?? '');
    try {
      rawName = decodeURIComponent(rawName);
    } catch {
      throw badRequest('Nome do arquivo inválido.');
    }
    const { name, mime } = validateGroupFile(kind, rawName, data);
    return db.tx(async (q) => {
      await assertGroupEditable(q, groupId);
      const row = await q.one<any>(
        `insert into group_files (group_id, kind, filename, mime, size, data, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (group_id, kind) do update
           set filename = excluded.filename, mime = excluded.mime, size = excluded.size, data = excluded.data,
               uploaded_by = excluded.uploaded_by, uploaded_at = now(), deleted_at = null, deleted_by = null, purged_at = null
         returning group_id, kind, filename, mime, size, uploaded_at`,
        [groupId, kind, name, mime, data.length, data, admin.id],
      );
      await audit(q, admin.id, 'group.file_uploaded', 'group', groupId, { kind, name, size: data.length });
      return { file: uploadedFile(row) };
    });
  });

  app.delete('/groups/:id/files/:kind', async (req) => {
    const admin = requireAdmin(req);
    const groupId = paramId(req);
    const kind = parseFileKind((req.params as any).kind);
    return db.tx(async (q) => {
      await assertGroupEditable(q, groupId);
      const r = await q.query(
        'update group_files set deleted_at = now(), deleted_by = $3 where group_id = $1 and kind = $2 and deleted_at is null returning group_id',
        [groupId, kind, admin.id],
      );
      if (r.length) await audit(q, admin.id, 'group.file_removed', 'group', groupId, { kind });
      return { ok: true };
    });
  });

  /**
   * Distribuição: coloca o grupo em um dia (na posição indicada), move entre dias ou tira do cronograma (dayId nulo).
   * Uma única operação atômica, usada pelo quadro de arrastar e soltar.
   */
  app.post('/groups/:id/place', async (req) => {
    const admin = requireAdmin(req);
    const groupId = paramId(req);
    const body = z.object({ dayId: z.number().int().positive().nullable(), position: z.number().int().positive().optional() }).parse(req.body);
    const touched = new Set<number>();
    await db.tx(async (q) => {
      const g = await q.one<{ event_id: number }>('select event_id from groups where id = $1 and deleted_at is null', [groupId]);
      if (!g) throw notFound('Grupo não encontrado.');
      const e = await q.one<any>('select * from schedule_entries where group_id = $1 for update', [groupId]);
      if (body.dayId !== null) {
        const day = await q.one<{ event_id: number }>('select event_id from event_days where id = $1 and deleted_at is null for update', [body.dayId]);
        if (!day) throw notFound('Dia não encontrado.');
        if (day.event_id !== g.event_id) throw badRequest('O dia pertence a outra banca.');
      }
      if (e && e.day_id !== body.dayId && e.started_at) {
        throw conflict('Este grupo já se apresentou: não pode mudar de dia nem sair do cronograma.', 'STARTED');
      }
      if (body.dayId === null) {
        if (!e) return;
        touched.add(e.day_id);
        await q.query('update event_days set current_entry_id = null where current_entry_id = $1', [e.id]);
        await q.query('delete from evaluator_assignments where group_id = $1 and day_id = $2', [groupId, e.day_id]);
        await q.query('delete from schedule_entries where id = $1', [e.id]);
        await renumber(q, e.day_id);
        await audit(q, admin.id, 'schedule.removed', 'event_day', e.day_id, { entryId: e.id, groupId });
        return;
      }
      let entryId: number;
      if (!e) {
        const pos = await q.one<{ p: number }>('select coalesce(max(position), 0) + 1 as p from schedule_entries where day_id = $1', [body.dayId]);
        entryId = (await q.one<{ id: number }>('insert into schedule_entries (day_id, group_id, position) values ($1, $2, $3) returning id', [body.dayId, groupId, pos!.p]))!.id;
        await audit(q, admin.id, 'schedule.added', 'event_day', body.dayId, { groupId, entryId });
      } else {
        entryId = e.id;
        if (e.day_id !== body.dayId) {
          touched.add(e.day_id);
          const pos = await q.one<{ p: number }>('select coalesce(max(position), 0) + 1 as p from schedule_entries where day_id = $1', [body.dayId]);
          await q.query('update event_days set current_entry_id = null where current_entry_id = $1', [e.id]);
          await q.query('update schedule_entries set day_id = $2, position = $3 where id = $1', [e.id, body.dayId, pos!.p]);
          // Atribuições específicas do grupo acompanham o grupo para o novo dia.
          await q.query(
            `update evaluator_assignments a set day_id = $3 where a.group_id = $1 and a.day_id = $2
                and not exists (select 1 from evaluator_assignments b where b.day_id = $3 and b.user_id = a.user_id and b.group_id = a.group_id)`,
            [groupId, e.day_id, body.dayId],
          );
          await q.query('delete from evaluator_assignments where group_id = $1 and day_id = $2', [groupId, e.day_id]);
          await renumber(q, e.day_id);
          await audit(q, admin.id, 'schedule.entry_updated', 'schedule_entry', e.id, { dayId: body.dayId });
        }
      }
      touched.add(body.dayId);
      if (body.position) {
        const ids = (await q.query<{ id: number }>('select id from schedule_entries where day_id = $1 order by position', [body.dayId]))
          .map((r) => r.id)
          .filter((i) => i !== entryId);
        ids.splice(Math.min(body.position - 1, ids.length), 0, entryId);
        await applyOrder(q, body.dayId, ids);
        await audit(q, admin.id, 'schedule.reordered', 'event_day', body.dayId, { order: ids });
      }
    });
    for (const d of touched) app.ctx.hub.broadcast(d, { type: 'day-changed', dayId: d, reason: 'reordered' });
    return { ok: true };
  });

  /** Fecha os buracos de numeração depois de retirar um grupo do dia (1, 2, 3…). */
  async function renumber(q: Queryable, dayId: number) {
    const ids = (await q.query<{ id: number }>('select id from schedule_entries where day_id = $1 order by position', [dayId])).map((r) => r.id);
    for (let i = 0; i < ids.length; i++) await q.query('update schedule_entries set position = $2 where id = $1', [ids[i], i + 1]);
  }

  // ---------- Tipos de rubrica ----------
  const typeSchema = z.object({ name: z.string().trim().min(1).max(200), description: optText(2000) });

  app.post('/rubric-types', async (req) => {
    const admin = requireAdmin(req);
    const body = typeSchema.parse(req.body);
    const row = await db.one<{ id: number }>('insert into rubric_types (name, description) values ($1, $2) returning id', [body.name, body.description]);
    await audit(db, admin.id, 'rubric_type.created', 'rubric_type', row!.id, body);
    return { id: row!.id };
  });

  app.put('/rubric-types/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = typeSchema.parse(req.body);
    const r = await db.query('update rubric_types set name = $2, description = $3 where id = $1 and deleted_at is null returning id', [id, body.name, body.description]);
    if (!r.length) throw notFound();
    await audit(db, admin.id, 'rubric_type.updated', 'rubric_type', id, body);
    return { ok: true };
  });

  app.delete('/rubric-types/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      // Em uso por bancas ou grupos: vai para a lixeira e continua aparecendo taxado onde estava vinculado.
      if (!(await softDelete(q, 'rubric_type', id, admin.id))) throw notFound();
      await audit(q, admin.id, 'rubric_type.deleted', 'rubric_type', id);
      return { ok: true };
    });
  });

  // ---------- Cronograma e ordenação ----------
  app.get('/days/:id/schedule', async (req) => {
    const dayId = paramId(req);
    await requireDayManager(req, dayId);
    return getDaySchedule(db, dayId);
  });

  app.post('/days/:id/schedule', async (req) => {
    const admin = requireAdmin(req);
    const dayId = paramId(req);
    const body = z.object({ groupId: z.number().int().positive(), timeProfileId: z.number().int().positive().nullable().default(null) }).parse(req.body);
    return db.tx(async (q) => {
      const day = await q.one<any>('select event_id from event_days where id = $1 and deleted_at is null', [dayId]);
      const group = await q.one<any>('select event_id from groups where id = $1 and deleted_at is null', [body.groupId]);
      if (!day || !group) throw notFound();
      if (day.event_id !== group.event_id) throw badRequest('O grupo pertence a outra banca.');
      const pos = await q.one<{ p: number }>('select coalesce(max(position), 0) + 1 as p from schedule_entries where day_id = $1', [dayId]);
      const row = await q.one<{ id: number }>(
        'insert into schedule_entries (day_id, group_id, position, time_profile_id) values ($1, $2, $3, $4) returning id',
        [dayId, body.groupId, pos!.p, body.timeProfileId],
      );
      await audit(q, admin.id, 'schedule.added', 'event_day', dayId, { groupId: body.groupId, entryId: row!.id });
      return { id: row!.id };
    });
  });

  async function applyOrder(q: Queryable, dayId: number, ids: number[]) {
    const existing = await q.query<{ id: number }>('select id from schedule_entries where day_id = $1', [dayId]);
    const set = new Set(existing.map((e) => e.id));
    if (ids.length !== set.size || !ids.every((i) => set.has(i)) || new Set(ids).size !== ids.length) {
      throw conflict('A ordem enviada não corresponde aos grupos do dia (outra pessoa pode ter alterado). Recarregue.', 'STALE_ORDER');
    }
    // Restrição de posição é "deferrable initially deferred": checada no commit.
    for (let i = 0; i < ids.length; i++) await q.query('update schedule_entries set position = $2 where id = $1', [ids[i], i + 1]);
  }

  app.put('/days/:id/schedule/order', async (req) => {
    const admin = requireAdmin(req);
    const dayId = paramId(req);
    const body = z.object({ entryIds: z.array(z.number().int().positive()).max(500) }).parse(req.body);
    await db.tx(async (q) => {
      await q.query('select id from event_days where id = $1 for update', [dayId]);
      await applyOrder(q, dayId, body.entryIds);
      await audit(q, admin.id, 'schedule.reordered', 'event_day', dayId, { order: body.entryIds });
    });
    app.ctx.hub.broadcast(dayId, { type: 'day-changed', dayId, reason: 'reordered' });
    return getDaySchedule(db, dayId);
  });

  app.post('/days/:id/schedule/sort', async (req) => {
    const admin = requireAdmin(req);
    const dayId = paramId(req);
    const { by } = z.object({ by: z.enum(['code', 'class', 'title']) }).parse(req.body);
    await db.tx(async (q) => {
      await q.query('select id from event_days where id = $1 for update', [dayId]);
      const rows = await q.query<any>('select e.id, g.code, g.class_name, g.title from schedule_entries e join groups g on g.id = e.group_id where e.day_id = $1', [dayId]);
      const key = (r: any) => (by === 'code' ? r.code : by === 'class' ? `${r.class_name}\u0000${r.code}` : r.title);
      rows.sort((a, b) => String(key(a)).localeCompare(String(key(b)), 'pt-BR', { numeric: true, sensitivity: 'base' }));
      await applyOrder(q, dayId, rows.map((r) => r.id));
      await audit(q, admin.id, 'schedule.sorted', 'event_day', dayId, { by });
    });
    app.ctx.hub.broadcast(dayId, { type: 'day-changed', dayId, reason: 'reordered' });
    return getDaySchedule(db, dayId);
  });

  app.patch('/schedule-entries/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = z.object({ timeProfileId: z.number().int().positive().nullable().optional(), dayId: z.number().int().positive().optional() }).parse(req.body);
    return db.tx(async (q) => {
      const e = await q.one<any>('select * from schedule_entries where id = $1 for update', [id]);
      if (!e) throw notFound();
      if (body.dayId && body.dayId !== e.day_id) {
        if (e.started_at) throw conflict('Grupo já iniciado não pode mudar de dia.', 'STARTED');
        const target = await q.one<any>(
          'select d.event_id from event_days d where d.id = $1 and d.event_id = (select event_id from event_days where id = $2)',
          [body.dayId, e.day_id],
        );
        if (!target) throw badRequest('Dia de destino inválido.');
        const pos = await q.one<{ p: number }>('select coalesce(max(position), 0) + 1 as p from schedule_entries where day_id = $1', [body.dayId]);
        await q.query('update event_days set current_entry_id = null where current_entry_id = $1', [id]);
        await q.query('update schedule_entries set day_id = $2, position = $3 where id = $1', [id, body.dayId, pos!.p]);
        // Atribuições específicas do grupo acompanham o grupo para o novo dia.
        await q.query(
          `update evaluator_assignments a set day_id = $3 where a.group_id = $1 and a.day_id = $2
              and not exists (select 1 from evaluator_assignments b where b.day_id = $3 and b.user_id = a.user_id and b.group_id = a.group_id)`,
          [e.group_id, e.day_id, body.dayId],
        );
        await q.query('delete from evaluator_assignments where group_id = $1 and day_id = $2', [e.group_id, e.day_id]);
      }
      if (body.timeProfileId !== undefined) await q.query('update schedule_entries set time_profile_id = $2 where id = $1', [id, body.timeProfileId]);
      await audit(q, admin.id, 'schedule.entry_updated', 'schedule_entry', id, body);
      return { ok: true };
    });
  });

  app.delete('/schedule-entries/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      const e = await q.one<any>('select * from schedule_entries where id = $1', [id]);
      if (!e) throw notFound();
      if (e.started_at) throw conflict('Grupo já iniciado não pode ser removido do cronograma.', 'STARTED');
      await q.query('delete from schedule_entries where id = $1', [id]);
      await audit(q, admin.id, 'schedule.removed', 'event_day', e.day_id, { entryId: id, groupId: e.group_id });
      return { ok: true };
    });
  });

  // ---------- Rubricas (modelos e versões) ----------
  app.get('/rubrics', async (req) => {
    requireAdmin(req);
    // Tipos na lixeira só vêm enquanto houver bancas, grupos ou rubricas vinculados: a tela de rubricas os omite (ficam só na Lixeira),
    // mas os vínculos os exibem taxados.
    const types = await db.query<any>(
      `select t.*, (select count(*)::int from events e where e.rubric_type_id = t.id and e.deleted_at is null) as events_using,
              (select count(*)::int from groups g where g.rubric_type_id = t.id and g.deleted_at is null) as groups_using
         from rubric_types t
        where t.deleted_at is null
           or exists (select 1 from events e where e.rubric_type_id = t.id and e.deleted_at is null)
           or exists (select 1 from groups g where g.rubric_type_id = t.id and g.deleted_at is null)
           or exists (select 1 from rubric_templates rt join rubric_versions rv on rv.template_id = rt.id
                       where rt.type_id = t.id and rv.deleted_at is null)
        order by t.name`,
    );
    const versions = await db.query<any>(
      `select v.*, (select count(*)::int from evaluations ev where ev.rubric_version_id = v.id) as used, ${ASSIGNED_SQL} as assigned
         from rubric_versions v where v.deleted_at is null order by v.template_id, v.version`,
    );
    const templates = (await db.query<any>('select * from rubric_templates order by type_position, name')).filter((t) =>
      versions.some((v) => v.template_id === t.id),
    );
    const criteria = await db.query<any>('select * from rubric_criteria order by version_id, position');
    return {
      types: types.map((t) => ({ id: t.id, name: t.name, description: t.description, eventsUsing: t.events_using, groupsUsing: t.groups_using, deleted: !!t.deleted_at })),
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        typeId: t.type_id,
        typePosition: t.type_position,
        versions: versions
          .filter((v) => v.template_id === t.id)
          .map((v) => ({
            id: v.id,
            version: v.version,
            title: v.title,
            instructions: v.instructions,
            scaleMin: v.scale_min,
            scaleMax: v.scale_max,
            scaleStep: v.scale_step,
            normalization: v.normalization,
            generalCommentRequired: v.general_comment_required,
            evaluatorRole: v.evaluator_role,
            dimension: v.dimension,
            dimensionShort: v.dimension_short,
            feedbackLabel: v.feedback_label,
            scaleLabels: v.scale_labels ?? [],
            sortOrder: v.sort_order,
            used: v.used,
            assigned: v.assigned,
            criteria: criteria
              .filter((c) => c.version_id === v.id)
              .map((c) => ({
                id: c.id,
                title: c.title,
                description: c.description,
                weight: c.weight,
                required: c.required,
                commentEnabled: c.comment_enabled,
                commentRequired: c.comment_required,
              })),
          })),
      })),
    };
  });

  app.post('/rubrics', async (req) => {
    const admin = requireAdmin(req);
    const body = z
      .object({ name: z.string().trim().min(1).max(200), description: optText(2000), typeId: z.number().int().positive().nullable().default(null), version: versionSchema })
      .parse(req.body);
    return db.tx(async (q) => {
      // Nova rubrica entra no fim do tipo.
      const pos = body.typeId
        ? (await q.one<{ p: number }>('select coalesce(max(type_position), 0) + 1 as p from rubric_templates where type_id = $1', [body.typeId]))!.p
        : 0;
      const t = await q.one<{ id: number }>('insert into rubric_templates (name, description, type_id, type_position) values ($1, $2, $3, $4) returning id', [
        body.name,
        body.description,
        body.typeId,
        pos,
      ]);
      const versionId = await insertVersion(q, t!.id, 1, body.version);
      await audit(q, admin.id, 'rubric.created', 'rubric_template', t!.id, { versionId });
      return { templateId: t!.id, versionId };
    });
  });

  app.patch('/rubric-templates/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        description: optText(2000).optional(),
        typeId: z.number().int().positive().nullable().optional(),
        typePosition: z.number().int().min(1).max(1000).optional(),
      })
      .parse(req.body);
    const cur = await db.one<any>('select * from rubric_templates where id = $1', [id]);
    if (!cur) throw notFound();
    let position = body.typePosition ?? cur.type_position;
    if (body.typeId !== undefined && body.typeId !== cur.type_id && body.typePosition === undefined) {
      position = body.typeId
        ? (await db.one<{ p: number }>('select coalesce(max(type_position), 0) + 1 as p from rubric_templates where type_id = $1', [body.typeId]))!.p
        : 0;
    }
    await db.query('update rubric_templates set name = $2, description = $3, type_id = $4, type_position = $5 where id = $1', [
      id,
      body.name ?? cur.name,
      body.description !== undefined ? body.description : cur.description,
      body.typeId !== undefined ? body.typeId : cur.type_id,
      position,
    ]);
    await audit(db, admin.id, 'rubric.template_updated', 'rubric_template', id, body);
    return { ok: true };
  });

  /** Edição direta só enquanto a versão não foi usada; depois disso, crie nova versão. */
  app.put('/rubric-versions/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = versionSchema.parse(req.body);
    return db.tx(async (q) => {
      if (await versionInUse(q, id)) {
        throw conflict('Esta versão já foi usada em avaliações e não pode ser alterada retroativamente. Crie uma nova versão.', 'VERSION_IN_USE');
      }
      const r = await q.query(
        `update rubric_versions set title=$2, instructions=$3, scale_min=$4, scale_max=$5, scale_step=$6, normalization=$7, general_comment_required=$8,
                evaluator_role=$9, dimension=$10, dimension_short=$11, feedback_label=$12, scale_labels=$13, sort_order=$14
          where id = $1 returning id`,
        [
          id,
          body.title,
          body.instructions,
          body.scaleMin,
          body.scaleMax,
          body.scaleStep,
          body.normalization,
          body.generalCommentRequired,
          body.evaluatorRole,
          body.dimension,
          body.dimensionShort,
          body.feedbackLabel,
          body.scaleLabels,
          body.sortOrder,
        ],
      );
      if (!r.length) throw notFound();
      await q.query('delete from rubric_criteria where version_id = $1', [id]);
      await insertCriteria(q, id, body.criteria);
      await audit(q, admin.id, 'rubric.version_updated', 'rubric_version', id, { criteria: body.criteria.length });
      return { ok: true };
    });
  });

  app.post('/rubric-versions/:id/new-version', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = versionSchema.parse(req.body);
    return db.tx(async (q) => {
      const v = await q.one<any>('select template_id from rubric_versions where id = $1', [id]);
      if (!v) throw notFound();
      const next = await q.one<{ n: number }>('select max(version) + 1 as n from rubric_versions where template_id = $1', [v.template_id]);
      const newId = await insertVersion(q, v.template_id, next!.n, body);
      await audit(q, admin.id, 'rubric.version_created', 'rubric_version', newId, { from: id, version: next!.n });
      return { versionId: newId, version: next!.n };
    });
  });

  app.delete('/rubric-versions/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      if (await versionInUse(q, id)) throw conflict('Versão usada em avaliações: não pode ser excluída.', 'VERSION_IN_USE');
      const v = await q.one<{ assigned: number; others: number }>(
        `select ${ASSIGNED_SQL} as assigned,
                (select count(*)::int from rubric_versions o where o.template_id = v.template_id and o.id <> v.id and o.deleted_at is null) as others
           from rubric_versions v where v.id = $1 and v.deleted_at is null`,
        [id],
      );
      if (v && v.assigned > 0 && v.others === 0) {
        throw conflict('Única versão de uma ficha atribuída a docentes: remova as atribuições (ou crie outra versão) antes.', 'IN_USE');
      }
      if (!(await softDelete(q, 'rubric_version', id, admin.id))) throw notFound();
      await audit(q, admin.id, 'rubric.version_deleted', 'rubric_version', id);
      return { ok: true };
    });
  });

  // ---------- Votação ----------
  app.get('/events/:id/vote-questions', async (req) => {
    requireAdmin(req);
    const eventId = paramId(req);
    const qs = await db.query<any>(
      `select q.*, (select count(*)::int from votes v where v.question_id = q.id) as votes
         from vote_questions q where q.event_id = $1 and q.deleted_at is null order by q.position, q.id`,
      [eventId],
    );
    const opts = await db.query<any>(
      'select * from vote_options where question_id in (select id from vote_questions where event_id = $1 and deleted_at is null) order by position',
      [eventId],
    );
    return {
      questions: qs.map((x) => ({
        id: x.id,
        title: x.title,
        prompt: x.prompt,
        enabled: x.enabled,
        required: x.required,
        allowAbstain: x.allow_abstain,
        rule: x.rule,
        quorumMin: x.quorum_min,
        position: x.position,
        votes: x.votes,
        options: opts.filter((o) => o.question_id === x.id).map((o) => ({ id: o.id, label: o.label, isAbstain: o.is_abstain })),
      })),
    };
  });

  app.post('/events/:id/vote-questions', async (req) => {
    const admin = requireAdmin(req);
    const eventId = paramId(req);
    const body = voteSchema.parse(req.body);
    return db.tx(async (q) => {
      const row = await q.one<{ id: number }>(
        `insert into vote_questions (event_id, title, prompt, enabled, required, allow_abstain, rule, quorum_min, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [eventId, body.title, body.prompt, body.enabled, body.required, body.allowAbstain, body.rule, body.rule === 'quorum' ? body.quorumMin : null, body.position],
      );
      let i = 0;
      for (const o of body.options) await q.query('insert into vote_options (question_id, position, label, is_abstain) values ($1,$2,$3,$4)', [row!.id, i++, o.label, o.isAbstain]);
      await audit(q, admin.id, 'vote.question_created', 'vote_question', row!.id, body);
      return { id: row!.id };
    });
  });

  app.put('/vote-questions/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = voteSchema.parse(req.body);
    return db.tx(async (q) => {
      const existing = await q.query<any>('select label, is_abstain from vote_options where question_id = $1 order by position', [id]);
      const hasVotes = !!(await q.one('select 1 from votes where question_id = $1 limit 1', [id]));
      const sameOptions =
        existing.length === body.options.length && existing.every((o, i) => o.label === body.options[i]!.label && o.is_abstain === body.options[i]!.isAbstain);
      if (hasVotes && !sameOptions) throw conflict('Já existem votos registrados: as opções não podem ser alteradas.', 'HAS_VOTES');
      const r = await q.query(
        `update vote_questions set title=$2, prompt=$3, enabled=$4, required=$5, allow_abstain=$6, rule=$7, quorum_min=$8, position=$9
          where id = $1 returning id`,
        [id, body.title, body.prompt, body.enabled, body.required, body.allowAbstain, body.rule, body.rule === 'quorum' ? body.quorumMin : null, body.position],
      );
      if (!r.length) throw notFound();
      if (!sameOptions) {
        await q.query('delete from vote_options where question_id = $1', [id]);
        let i = 0;
        for (const o of body.options) await q.query('insert into vote_options (question_id, position, label, is_abstain) values ($1,$2,$3,$4)', [id, i++, o.label, o.isAbstain]);
      }
      await audit(q, admin.id, 'vote.question_updated', 'vote_question', id, body);
      return { ok: true };
    });
  });

  app.delete('/vote-questions/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      if (await q.one('select 1 from votes where question_id = $1 limit 1', [id])) {
        throw conflict('Já existem votos: desabilite a pergunta em vez de excluí-la.', 'HAS_VOTES');
      }
      if (!(await softDelete(q, 'vote_question', id, admin.id))) throw notFound();
      await audit(q, admin.id, 'vote.question_deleted', 'vote_question', id);
      return { ok: true };
    });
  });

  // ---------- Atribuições docente ↔ rubrica ----------
  /** Logotipo institucional usado no PDF (PNG/JPEG em data URL, até ~1,5 MB). */
  app.put('/events/:id/logo', { bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = z
      .object({ dataUrl: z.string().max(2_200_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'envie uma imagem PNG ou JPEG').nullable() })
      .parse(req.body);
    const r = await db.query('update events set logo_data_url = $2 where id = $1 returning id', [id, body.dataUrl]);
    if (!r.length) throw notFound();
    await audit(db, admin.id, body.dataUrl ? 'event.logo_updated' : 'event.logo_removed', 'event', id);
    return { ok: true };
  });

  app.get('/events/:id/logo', async (req, reply) => {
    requireAdmin(req);
    const r = await db.one<{ logo_data_url: string | null }>('select logo_data_url from events where id = $1', [paramId(req)]);
    const m = r?.logo_data_url ? /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(r.logo_data_url) : null;
    if (!m) throw notFound('Banca sem logotipo.');
    return reply.header('Content-Type', m[1]!).send(Buffer.from(m[2]!, 'base64'));
  });

  /** Instala as 4 rubricas do Projeto Integrador e, se informado, aplica a configuração do modelo à banca. */
  app.post('/templates/projeto-integrador', async (req) => {
    const admin = requireAdmin(req);
    const body = z.object({ eventId: z.number().int().positive().nullable().default(null) }).parse(req.body ?? {});
    return db.tx(async (q) => {
      const versionIds = await installPiRubrics(q);
      if (body.eventId) {
        if (!(await q.one('select 1 from events where id = $1 and deleted_at is null', [body.eventId]))) throw notFound('Banca não encontrada.');
        await applyPiEventConfig(q, body.eventId);
      }
      await audit(q, admin.id, 'template.projeto_integrador_applied', 'event', body.eventId, { versionIds });
      return { versionIds };
    });
  });

  /** Copia a escala (atribuições gerais e professor primário) de outro dia — cada dia continua independente. */
  app.post('/days/:id/assignments/copy', async (req) => {
    const admin = requireAdmin(req);
    const dayId = paramId(req);
    const body = z.object({ fromDayId: z.number().int().positive(), includePrimary: z.boolean().default(true) }).parse(req.body);
    if (body.fromDayId === dayId) throw badRequest('Escolha um dia diferente.');
    return db.tx(async (q) => {
      const src = await q.one<any>('select event_id, primary_user_id from event_days where id = $1', [body.fromDayId]);
      const dst = await q.one<any>('select event_id from event_days where id = $1 for update', [dayId]);
      if (!src || !dst) throw notFound('Dia não encontrado.');
      const rows = await q.query<any>('select user_id, rubric_position from evaluator_assignments where day_id = $1 and group_id is null', [body.fromDayId]);
      let copied = 0;
      let updated = 0;
      for (const r of rows) {
        const ex = await q.one<{ id: number }>('select id from evaluator_assignments where day_id = $1 and user_id = $2 and group_id is null', [dayId, r.user_id]);
        if (ex) {
          await q.query('update evaluator_assignments set rubric_position = $2 where id = $1', [ex.id, r.rubric_position]);
          updated++;
        } else {
          await q.query('insert into evaluator_assignments (day_id, user_id, group_id, rubric_position) values ($1, $2, null, $3)', [dayId, r.user_id, r.rubric_position]);
          copied++;
        }
      }
      if (body.includePrimary && src.primary_user_id) await q.query('update event_days set primary_user_id = $2 where id = $1', [dayId, src.primary_user_id]);
      await audit(q, admin.id, 'assignment.copied', 'event_day', dayId, { fromDayId: body.fromDayId, copied, updated, includePrimary: body.includePrimary });
      return { copied, updated };
    });
  });

  app.get('/days/:id/assignments', async (req) => {
    requireAdmin(req);
    const dayId = paramId(req);
    return {
      assignments: await db.query(
        `select a.id, a.user_id as "userId", u.name as "userName", (u.deleted_at is not null) as "userDeleted", a.group_id as "groupId", g.code as "groupCode",
                a.rubric_position as "rubricPosition",
                (select v.title from event_days d join events e on e.id = d.event_id
                   join rubric_templates t on t.type_id = coalesce(g.rubric_type_id, e.rubric_type_id) and t.type_position = a.rubric_position
                   join rubric_versions v on v.template_id = t.id and v.deleted_at is null
                  where d.id = a.day_id order by t.id, v.version desc limit 1) as "rubricTitle"
           from evaluator_assignments a join users u on u.id = a.user_id
           left join groups g on g.id = a.group_id
          where a.day_id = $1 order by u.name, g.code nulls first`,
        [dayId],
      ),
    };
  });

  app.post('/days/:id/assignments', async (req) => {
    const admin = requireAdmin(req);
    const dayId = paramId(req);
    const body = z
      .object({ userId: z.number().int().positive(), rubricPosition: z.number().int().positive(), groupId: z.number().int().positive().nullable().default(null) })
      .parse(req.body);
    return db.tx(async (q) => {
      const u = await q.one<any>('select role, active from users where id = $1 and deleted_at is null', [body.userId]);
      if (!u || u.role !== 'teacher' || !u.active) throw badRequest('Somente docentes ativos podem ser avaliadores.');
      await requireFicha(q, dayId, body.rubricPosition, body.groupId);
      if (body.groupId && !(await q.one('select 1 from schedule_entries where group_id = $1 and day_id = $2', [body.groupId, dayId]))) {
        throw badRequest('O grupo não está no cronograma deste dia.');
      }
      if (
        await q.one('select 1 from evaluator_assignments where day_id = $1 and user_id = $2 and coalesce(group_id, 0) = coalesce($3::int, 0)', [
          dayId,
          body.userId,
          body.groupId,
        ])
      ) {
        throw conflict(
          body.groupId ? 'Este docente já tem atribuição para este grupo neste dia.' : 'Este docente já avalia todos os grupos deste dia (altere a ficha na lista).',
          'DUPLICATE',
        );
      }
      const row = await q.one<{ id: number }>(
        'insert into evaluator_assignments (day_id, user_id, group_id, rubric_position) values ($1,$2,$3,$4) returning id',
        [dayId, body.userId, body.groupId, body.rubricPosition],
      );
      await audit(q, admin.id, 'assignment.created', 'event_day', dayId, body);
      return { id: row!.id };
    });
  });

  app.patch('/assignments/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    const body = z.object({ rubricPosition: z.number().int().positive() }).parse(req.body);
    return db.tx(async (q) => {
      const a = await q.one<any>('select * from evaluator_assignments where id = $1', [id]);
      if (!a) throw notFound();
      await requireFicha(q, a.day_id, body.rubricPosition, a.group_id);
      await q.query('update evaluator_assignments set rubric_position = $2 where id = $1', [id, body.rubricPosition]);
      await audit(q, admin.id, 'assignment.updated', 'evaluator_assignment', id, {
        ...body,
        from: a.rubric_position,
        note: 'Fichas já abertas mantêm a versão original.',
      });
      return { ok: true };
    });
  });

  app.delete('/assignments/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      const a = await q.one<any>('select * from evaluator_assignments where id = $1', [id]);
      if (!a) throw notFound();
      if (a.group_id === null && (await q.one('select 1 from event_days where id = $1 and primary_user_id = $2', [a.day_id, a.user_id]))) {
        throw conflict('Este docente é o professor primário do dia e também avalia: troque o primário antes de remover a atribuição.', 'PRIMARY');
      }
      const evs = await q.one(
        `select 1 from evaluations ev join schedule_entries e on e.id = ev.entry_id
          where ev.user_id = $1 and e.day_id = $2 and ($3::int is null or ev.group_id = $3) limit 1`,
        [a.user_id, a.day_id, a.group_id],
      );
      if (evs) {
        throw conflict(
          'Este docente já tem fichas abertas sob esta atribuição. Para não descartar avaliações silenciosamente, registre uma dispensa no fechamento.',
          'HAS_EVALUATIONS',
        );
      }
      await q.query('delete from evaluator_assignments where id = $1', [id]);
      await audit(q, admin.id, 'assignment.deleted', 'event_day', a.day_id, { assignmentId: id, userId: a.user_id, groupId: a.group_id });
      return { ok: true };
    });
  });

  // ---------- Acompanhamento ----------
  app.get('/days/:id/monitor', async (req) => {
    const dayId = paramId(req);
    await requireDayManager(req, dayId);
    const schedule = await getDaySchedule(db, dayId);
    const evals = await db.query<any>(
      `select ev.id, ev.group_id, ev.user_id, ev.status, ev.submitted_at from evaluations ev
         join schedule_entries e on e.id = ev.entry_id where e.day_id = $1`,
      [dayId],
    );
    const users = await db.query<any>('select id, name from users');
    const rows = [];
    for (const e of schedule.entries) {
      const assigned = await resolveAssignments(db, dayId, e.groupId);
      rows.push({
        ...e,
        evaluators: assigned.map((a) => {
          const ev = evals.find((x) => x.group_id === e.groupId && x.user_id === a.userId);
          return {
            userId: a.userId,
            name: users.find((u) => u.id === a.userId)?.name ?? '—',
            evaluationId: ev?.id ?? null,
            status: ev?.status ?? 'not_opened',
            submittedAt: ev?.submitted_at ?? null,
          };
        }),
      });
    }
    return { day: schedule.day, entries: rows, warnings: schedule.warnings, predictedEnd: schedule.predictedEnd };
  });

  // ---------- Auditoria ----------
  app.get('/audit', async (req) => {
    requireAdmin(req);
    const qs = z
      .object({ limit: z.coerce.number().int().min(1).max(1000).default(200), entity: z.string().max(50).optional(), action: z.string().max(80).optional() })
      .parse(req.query);
    return {
      logs: await db.query(
        `select a.id, a.at, a.action, a.entity, a.entity_id as "entityId", a.details, u.name as "actorName"
           from audit_logs a left join users u on u.id = a.actor_id
          where ($1::text is null or a.entity = $1) and ($2::text is null or a.action like $2 || '%')
          order by a.at desc, a.id desc limit $3`,
        [qs.entity ?? null, qs.action ?? null, qs.limit],
      ),
    };
  });

  app.get('/days/:id/timer-events', async (req) => {
    const dayId = paramId(req);
    await requireDayManager(req, dayId);
    return {
      events: await db.query(
        `select t.id, t.type, t.at, t.elapsed_ms as "elapsedMs", t.details, u.name as "actorName", g.code as "groupCode", s.id as "sessionId"
           from timer_events t join timer_sessions s on s.id = t.session_id
           join schedule_entries e on e.id = s.entry_id join groups g on g.id = e.group_id
           left join users u on u.id = t.actor_id
          where s.day_id = $1 order by t.at desc, t.id desc limit 300`,
        [dayId],
      ),
    };
  });
}
