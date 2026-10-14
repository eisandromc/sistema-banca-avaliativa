import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDayAccess, requireAdmin, requireUser } from '../auth/session.ts';
import { badRequest, conflict, forbidden, notFound, paramId } from '../http.ts';
import { audit } from '../audit.ts';
import { buildConsolidation, closeGroup, closureHistory, consolidationToken, reopenGroup, saveVerdict, type ClosureSnapshot } from '../services/closure.ts';
import { logoFromDataUrl, renderReportPdf } from '../pdf/report.ts';
import { ensureEvaluations } from '../services/evaluations.ts';

export async function closureRoutes(app: FastifyInstance) {
  const { db, hub, config } = app.ctx;

  /** Conferência/fechamento/PDF: somente administrador ou professor primário do dia do grupo. */
  async function requireGroupController(req: FastifyRequest, groupId: number) {
    const user = requireUser(req);
    const entry = await db.one<{ day_id: number }>('select day_id from schedule_entries where group_id = $1', [groupId]);
    if (!entry) {
      if (user.role === 'admin') return { user, dayId: null as number | null, isAdmin: true };
      throw notFound('Grupo não está no cronograma.');
    }
    const access = await getDayAccess(db, user, entry.day_id);
    if (!access.canControl) throw forbidden('Somente o professor primário do dia ou um administrador pode conferir e fechar avaliações.');
    return { user, dayId: entry.day_id, isAdmin: access.isAdmin };
  }

  app.get('/groups/:id/review', async (req) => {
    const groupId = paramId(req);
    const { isAdmin } = await requireGroupController(req, groupId);
    // Avaliador designado depois do início também recebe a ficha (e pode ser dispensado no fechamento).
    const entry = await db.one<{ id: number }>('select id from schedule_entries where group_id = $1', [groupId]);
    if (entry) await db.tx((q) => ensureEvaluations(q, entry.id));
    const consolidation = await buildConsolidation(db, groupId);
    const history = await closureHistory(db, groupId);
    const open = await db.one<any>('select version, snapshot from evaluation_closures where group_id = $1 and reopened_at is null', [groupId]);
    return { consolidation, reviewToken: consolidationToken(consolidation), closed: open ? (open.snapshot as ClosureSnapshot) : null, history, isAdmin };
  });

  /** Parecer da banca (opções configuradas na banca) e textos consolidados: primário ou administrador. */
  app.put('/groups/:id/verdict', async (req) => {
    const groupId = paramId(req);
    const { user, dayId } = await requireGroupController(req, groupId);
    const t = z.string().trim().max(5000).nullish().transform((v) => (v ? v : null));
    const body = z.object({ verdict: z.string().trim().max(200).nullish().transform((v) => (v ? v : null)), strengths: t, improvements: t, guidance: t }).parse(req.body);
    await db.tx((q) => saveVerdict(q, groupId, user.id, body));
    if (dayId) hub.broadcast(dayId, { type: 'day-changed', dayId, reason: 'verdict_saved' });
    return { ok: true };
  });

  async function eventLogo(groupIds: number[]) {
    const r = await db.one<{ logo_data_url: string | null }>(
      'select e.logo_data_url from groups g join events e on e.id = g.event_id where g.id = $1',
      [groupIds[0]],
    );
    return logoFromDataUrl(r?.logo_data_url);
  }

  app.post('/groups/:id/close', async (req) => {
    const groupId = paramId(req);
    const { user } = await requireGroupController(req, groupId);
    const body = z.object({ confirm: z.literal(true), reviewToken: z.string().max(100).optional() }).parse(req.body);
    const result = await db.tx((q) => closeGroup(q, groupId, user, body.reviewToken));
    if (result.dayId) hub.broadcast(result.dayId, { type: 'day-changed', dayId: result.dayId, reason: 'closed' });
    return result;
  });

  app.post('/groups/:id/reopen', async (req) => {
    const groupId = paramId(req);
    const admin = requireAdmin(req);
    const body = z.object({ reason: z.string().trim().min(10).max(2000) }).parse(req.body);
    const result = await db.tx((q) => reopenGroup(q, groupId, admin.id, body.reason));
    if (result.dayId) hub.broadcast(result.dayId, { type: 'day-changed', dayId: result.dayId, reason: 'reopened' });
    return result;
  });

  /** Exceções (dispensa de avaliador ou de critério): somente administrador, com motivo. */
  app.post('/groups/:id/exceptions', async (req) => {
    const groupId = paramId(req);
    const admin = requireAdmin(req);
    const body = z
      .object({
        kind: z.enum(['evaluator_absent', 'criterion_waived']),
        evaluationId: z.number().int().positive(),
        criterionId: z.number().int().positive().nullable().optional(),
        reason: z.string().trim().min(5).max(2000),
      })
      .parse(req.body);
    return db.tx(async (q) => {
      const ev = await q.one<any>('select id, group_id, rubric_version_id from evaluations where id = $1', [body.evaluationId]);
      if (!ev || ev.group_id !== groupId) throw badRequest('Avaliação não pertence a este grupo.');
      if (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [groupId])) {
        throw conflict('Avaliação fechada. Reabra antes de registrar exceções.', 'CLOSED');
      }
      if (body.kind === 'criterion_waived') {
        const c = await q.one('select 1 from rubric_criteria where id = $1 and version_id = $2', [body.criterionId, ev.rubric_version_id]);
        if (!c) throw badRequest('Critério não pertence à rubrica do avaliador.');
      }
      const dup = await q.one(
        `select 1 from closure_exceptions where evaluation_id = $1 and kind = $2 and coalesce(criterion_id, 0) = coalesce($3, 0) and revoked_at is null`,
        [body.evaluationId, body.kind, body.criterionId ?? null],
      );
      if (dup) throw conflict('Esta exceção já está registrada.', 'DUPLICATE');
      const row = await q.one<{ id: number }>(
        `insert into closure_exceptions (group_id, kind, evaluation_id, criterion_id, reason, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [groupId, body.kind, body.evaluationId, body.kind === 'criterion_waived' ? body.criterionId : null, body.reason, admin.id],
      );
      await audit(q, admin.id, 'closure.exception_added', 'group', groupId, { exceptionId: row!.id, ...body });
      return { id: row!.id };
    });
  });

  app.post('/exceptions/:id/revoke', async (req) => {
    const admin = requireAdmin(req);
    const id = paramId(req);
    return db.tx(async (q) => {
      const x = await q.one<any>('select * from closure_exceptions where id = $1 and revoked_at is null', [id]);
      if (!x) throw notFound('Exceção não encontrada.');
      if (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [x.group_id])) {
        throw conflict('Avaliação fechada. Reabra antes de alterar exceções.', 'CLOSED');
      }
      await q.query('update closure_exceptions set revoked_at = now() where id = $1', [id]);
      await audit(q, admin.id, 'closure.exception_revoked', 'group', x.group_id, { exceptionId: id });
      return { ok: true };
    });
  });

  app.get('/groups/:id/report.pdf', async (req, reply) => {
    const groupId = paramId(req);
    const { user } = await requireGroupController(req, groupId);
    const { version } = z.object({ version: z.coerce.number().int().positive().optional() }).parse(req.query);
    const row = version
      ? await db.one<any>('select snapshot from evaluation_closures where group_id = $1 and version = $2', [groupId, version])
      : await db.one<any>('select snapshot from evaluation_closures where group_id = $1 and reopened_at is null', [groupId]);
    if (!row) throw notFound(version ? 'Versão de fechamento não encontrada.' : 'O PDF só é gerado após o fechamento da avaliação.');
    const snap = row.snapshot as ClosureSnapshot;
    const pdf = await renderReportPdf([snap], { compress: config.env !== 'test', logo: await eventLogo([groupId]) });
    await audit(db, user.id, 'report.downloaded', 'group', groupId, { version: snap.closure.version });
    const fname = `avaliacao-${snap.group.code}-v${snap.closure.version}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${fname}"`)
      .send(pdf);
  });

  /** Lote: todos os projetos fechados de um dia em um único PDF. */
  app.get('/days/:id/report.pdf', async (req, reply) => {
    const dayId = paramId(req);
    const user = requireUser(req);
    const access = await getDayAccess(db, user, dayId);
    if (!access.canControl) throw forbidden();
    const rows = await db.query<any>(
      `select c.snapshot, c.group_id from evaluation_closures c join schedule_entries e on e.group_id = c.group_id
        where e.day_id = $1 and c.reopened_at is null order by e.position`,
      [dayId],
    );
    if (!rows.length) throw notFound('Nenhum projeto fechado neste dia.');
    const pdf = await renderReportPdf(
      rows.map((r) => r.snapshot as ClosureSnapshot),
      { compress: config.env !== 'test', logo: await eventLogo([rows[0].group_id]) },
    );
    await audit(db, user.id, 'report.batch_downloaded', 'event_day', dayId, { count: rows.length });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="avaliacoes-dia-${dayId}.pdf"`)
      .send(pdf);
  });
}
