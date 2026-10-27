import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireDayMember, requireUser } from '../auth/session.ts';
import { notFound, paramId } from '../http.ts';
import { getDaySchedule, resolveAssignments } from '../services/schedule.ts';
import { ensureEvaluations, getEvaluationForm, saveDraft, submitEvaluation } from '../services/evaluations.ts';
import { activeDisplay } from '../services/display.ts';
import { contentDisposition, groupFilesFor, parseFileKind } from '../services/groupFiles.ts';

export async function professorRoutes(app: FastifyInstance) {
  const { db, hub } = app.ctx;

  /** Dias em que o usuário atua (administrador vê todos). */
  app.get('/me/days', async (req) => {
    const user = requireUser(req);
    const rows = await db.query<any>(
      `select d.id, d.label, d.date, d.room, d.start_time, d.end_time, d.primary_user_id, e.name as event_name,
              exists(select 1 from evaluator_assignments a where a.day_id = d.id and a.user_id = $1) as assigned
         from event_days d join events e on e.id = d.event_id
        where d.deleted_at is null and e.deleted_at is null
        order by d.date, d.id`,
      [user.id],
    );
    return {
      days: rows
        .filter((r) => user.role === 'admin' || r.primary_user_id === user.id || r.assigned)
        .map((r) => ({
          id: r.id,
          label: r.label,
          date: r.date,
          startTime: r.start_time,
          endTime: r.end_time,
          room: r.room,
          eventName: r.event_name,
          isPrimary: r.primary_user_id === user.id,
          isAssigned: r.assigned,
          canControl: user.role === 'admin' || r.primary_user_id === user.id,
        })),
    };
  });

  app.get('/days/:id/workspace', async (req) => {
    const dayId = paramId(req);
    const { user, access } = await requireDayMember(db, req, dayId);
    const schedule = await getDaySchedule(db, dayId);
    for (const e of schedule.entries) if (e.started) await ensureEvaluations(db, e.entryId);

    const myEvals = await db.query<any>(
      `select ev.id, ev.entry_id, ev.status from evaluations ev join schedule_entries e on e.id = ev.entry_id
        where e.day_id = $1 and ev.user_id = $2`,
      [dayId, user.id],
    );
    const myAssignments = await db.query<{ group_id: number | null }>('select group_id from evaluator_assignments where day_id = $1 and user_id = $2', [
      dayId,
      user.id,
    ]);
    const assignedAll = myAssignments.some((a) => a.group_id === null);
    const assignedGroups = new Set(myAssignments.map((a) => a.group_id));

    const entries = schedule.entries
      .map((e) => {
        const mine = myEvals.find((m) => m.entry_id === e.entryId);
        return {
          ...e,
          assignedToMe: assignedAll || assignedGroups.has(e.groupId),
          myEvaluationId: mine?.id ?? null,
          myEvaluationStatus: mine?.status ?? null,
        };
      })
      .filter((e) => access.canControl || e.assignedToMe);

    const curRow = schedule.entries.find((e) => e.isCurrent) ?? null;
    let current: any = null;
    if (curRow) {
      const g = await db.one<any>(
        `select description, advisor, advisors, project_url, pdf_url, slides_url, github_url,
                exists (select 1 from group_files f where f.group_id = groups.id and f.deleted_at is null) as has_files
           from groups where id = $1`,
        [curRow.groupId],
      );
      const students = await db.query<{ name: string }>(
        'select s.name from group_students gs join students s on s.id = gs.student_id where gs.group_id = $1 order by gs.position, s.name',
        [curRow.groupId],
      );
      const mine = myEvals.find((m) => m.entry_id === curRow.entryId);
      current = {
        ...curRow,
        description: g?.description ?? null,
        advisor: g?.advisor ?? null,
        advisors: g?.advisors ?? [],
        hasMaterials: !!(g?.description || g?.project_url || g?.pdf_url || g?.slides_url || g?.github_url || g?.has_files),
        students: students.map((s) => s.name),
        myEvaluationId: mine?.id ?? null,
        myEvaluationStatus: mine?.status ?? null,
      };
    }

    // Progresso das fichas (somente situação, nunca notas) — visível ao primário/administrador.
    let progress: Array<{ userId: number; name: string; status: string }> | null = null;
    if (access.canControl && curRow) {
      const assigned = await resolveAssignments(db, dayId, curRow.groupId);
      const evs = await db.query<any>('select user_id, status from evaluations where group_id = $1', [curRow.groupId]);
      const names = await db.query<any>('select id, name from users where id = any($1::int[])', [assigned.map((a) => a.userId)]);
      progress = assigned.map((a) => ({
        userId: a.userId,
        name: names.find((n) => n.id === a.userId)?.name ?? '—',
        status: evs.find((e) => e.user_id === a.userId)?.status ?? 'not_opened',
      }));
    }

    const event = await db.one<any>('select id, name, edit_after_submit, warn_pct, danger_pct from events where id = $1', [schedule.day.eventId]);
    // Telão: este dia está sendo exibido? (ou outro dia ocupa o telão)
    const disp = await activeDisplay(db);
    const display = {
      active: disp?.dayId === dayId,
      other: disp && disp.dayId !== dayId ? { dayId: disp.dayId, label: disp.label, eventName: disp.eventName } : null,
    };
    const primary = schedule.day.primaryUserId ? await db.one<any>('select name from users where id = $1', [schedule.day.primaryUserId]) : null;
    return {
      day: schedule.day,
      event: { id: event.id, name: event.name, editAfterSubmit: event.edit_after_submit, warnPct: event.warn_pct, dangerPct: event.danger_pct },
      access,
      primaryName: primary?.name ?? null,
      entries,
      warnings: access.canControl ? schedule.warnings : [],
      predictedEnd: schedule.predictedEnd,
      current,
      progress,
      display,
    };
  });

  /** Grupo com dia e tipo de rubrica, liberado para quem atua no dia do grupo (sem dia: só o administrador). */
  const groupForMember = async (req: FastifyRequest, groupId: number) => {
    const g = await db.one<any>(
      `select g.*, e.day_id, e.position, coalesce(rt.name, ert.name) as rubric_type_name
         from groups g join events ev on ev.id = g.event_id
         left join schedule_entries e on e.group_id = g.id
         left join rubric_types rt on rt.id = g.rubric_type_id
         left join rubric_types ert on ert.id = ev.rubric_type_id
        where g.id = $1`,
      [groupId],
    );
    if (!g) throw notFound('Grupo não encontrado.');
    if (g.day_id) await requireDayMember(db, req, g.day_id);
    else requireAdmin(req);
    return g;
  };

  /** Resumo, orientadores e materiais do projeto (links e arquivos enviados) — para quem atua no dia do grupo. */
  app.get('/groups/:id/project', async (req) => {
    const groupId = paramId(req);
    const g = await groupForMember(req, groupId);
    const files = (await groupFilesFor(db, [groupId])).get(groupId);
    const students = await db.query<{ name: string }>(
      'select s.name from group_students gs join students s on s.id = gs.student_id where gs.group_id = $1 order by gs.position, s.name',
      [groupId],
    );
    return {
      id: g.id,
      code: g.code,
      className: g.class_name,
      title: g.title,
      summary: g.description,
      advisors: g.advisors ?? [],
      students: students.map((s) => s.name),
      projectUrl: g.project_url,
      pdfUrl: g.pdf_url,
      slidesUrl: g.slides_url,
      githubUrl: g.github_url,
      slidesFile: files?.slides ?? null,
      articleFile: files?.article ?? null,
      color: g.color,
      position: g.position,
      rubricTypeName: g.rubric_type_name,
    };
  });

  /** Conteúdo do arquivo enviado (slides ou artigo). PDF abre na página; `?download=1` força o download. */
  app.get('/groups/:id/files/:kind', async (req, reply) => {
    const groupId = paramId(req);
    const kind = parseFileKind((req.params as any).kind);
    await groupForMember(req, groupId);
    const f = await db.one<any>(`select filename, mime, data from group_files where group_id = $1 and kind = $2 and deleted_at is null
          and exists (select 1 from groups g where g.id = group_id and g.deleted_at is null)`, [groupId, kind]);
    if (!f) throw notFound('Arquivo não enviado.');
    const data: Uint8Array = f.data;
    const download = (req.query as any)?.download === '1' || f.mime !== 'application/pdf';
    return reply
      .header('Content-Type', f.mime)
      .header('Content-Disposition', contentDisposition(f.filename, download))
      .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });

  app.get('/evaluations/:id', async (req) => {
    const user = requireUser(req);
    return getEvaluationForm(db, paramId(req), user.id);
  });

  const draftSchema = z.object({
    revision: z.number().int().positive(),
    generalComment: z.string().max(10000).optional(),
    scores: z
      .array(z.object({ criterionId: z.number().int().positive(), score: z.number().finite().nullable(), comment: z.string().max(5000).optional() }))
      .max(200),
    votes: z.array(z.object({ questionId: z.number().int().positive(), optionId: z.number().int().positive().nullable() })).max(50).optional(),
  });

  app.put('/evaluations/:id/draft', async (req) => {
    const user = requireUser(req);
    const body = draftSchema.parse(req.body);
    return db.tx((q) => saveDraft(q, paramId(req), user.id, body));
  });

  app.post('/evaluations/:id/submit', async (req) => {
    const user = requireUser(req);
    const body = z.object({ revision: z.number().int().positive() }).parse(req.body);
    const result = await db.tx((q) => submitEvaluation(q, paramId(req), user.id, body.revision));
    if (!result.alreadySubmitted && 'dayId' in result && result.dayId) {
      hub.broadcast(result.dayId, { type: 'day-changed', dayId: result.dayId, reason: 'evaluation_submitted' });
    }
    return result;
  });
}
