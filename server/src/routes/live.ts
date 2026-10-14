import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Queryable } from '../db/database.ts';
import { getDayAccess, requireDayController, type SessionUser } from '../auth/session.ts';
import { forbidden, paramId } from '../http.ts';
import { activeDisplay, notifyDisplay, setDisplay } from '../services/display.ts';

/** Quem pode ver o estado público do cronômetro de um dia. */
export async function canViewLive(q: Queryable, user: SessionUser | null, dayId: number): Promise<boolean> {
  const access = await getDayAccess(q, user, dayId);
  if (access.isAdmin || access.isViewer || access.isPrimary || access.isAssigned) return true;
  const ev = await q.one<{ public_display: boolean }>('select e.public_display from events e where e.id = $1', [access.eventId]);
  return !!ev?.public_display;
}

export const stagesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(60),
      durationSeconds: z.number().int().min(1).max(86400),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
  )
  .min(1)
  .max(20);

export async function liveRoutes(app: FastifyInstance) {
  const { db, timer, hub } = app.ctx;

  /**
   * Telão: qual dia exibir. Sem seleção na tela — o professor primário ativa o dia.
   * Sem login, só aparece se a banca permite exibição pública.
   */
  app.get('/public/display', async (req) => {
    const d = await activeDisplay(db);
    if (!d) return { display: null, restricted: false };
    if (!(await canViewLive(db, req.user, d.dayId))) return { display: null, restricted: true };
    return { display: d, restricted: false };
  });

  /** Ativa/desativa o dia no telão: professor primário do dia ou administrador. */
  app.post('/days/:id/display', async (req) => {
    const dayId = paramId(req);
    const { user } = await requireDayController(db, req, dayId);
    const body = z.object({ active: z.boolean() }).parse(req.body);
    const r = await db.tx((q) => setDisplay(q, dayId, body.active, user.id));
    if (r.changed) notifyDisplay(hub, dayId, r.previousDayId);
    return { active: body.active, changed: r.changed };
  });

  /** Lista de dias para a tela de projeção. Sem login: apenas bancas com exibição pública. */
  app.get('/public/days', async (req) => {
    const user = req.user;
    const rows = await db.query<any>(
      `select d.id, d.label, d.date, d.room, e.id as event_id, e.name as event_name, e.public_display
         from event_days d join events e on e.id = d.event_id order by d.date desc, d.id`,
    );
    const out = [];
    for (const r of rows) {
      if (r.public_display || (user && (await canViewLive(db, user, r.id)))) {
        out.push({ id: r.id, label: r.label, date: r.date, room: r.room, eventId: r.event_id, eventName: r.event_name });
      }
    }
    return { days: out };
  });

  app.get('/days/:id/live', async (req) => {
    const dayId = paramId(req);
    if (!(await canViewLive(db, req.user, dayId))) throw forbidden('A exibição pública desta banca está desativada. Faça login.');
    return timer.liveState(dayId);
  });

  const ctl = async (req: FastifyRequest) => {
    const dayId = paramId(req);
    const { user } = await requireDayController(db, req, dayId);
    return { dayId, user };
  };

  app.post('/days/:id/select', async (req) => {
    const { dayId, user } = await ctl(req);
    const body = z
      .object({ entryId: z.number().int().positive(), confirm: z.boolean().optional(), reason: z.string().trim().max(500).optional() })
      .parse(req.body);
    return timer.select(user.id, dayId, body.entryId, body);
  });

  app.post('/days/:id/timer/start', async (req) => {
    const { dayId, user } = await ctl(req);
    const body = z.object({ entryId: z.number().int().positive() }).parse(req.body);
    const result = await timer.start(user.id, dayId, body.entryId);
    // Se nenhum dia está no telão, a primeira apresentação iniciada ativa este dia automaticamente.
    const auto = await db.tx(async (q) => ((await activeDisplay(q)) ? null : setDisplay(q, dayId, true, user.id, 'auto_start')));
    if (auto?.changed) notifyDisplay(hub, dayId);
    return result;
  });

  app.post('/days/:id/timer/pause', async (req) => {
    const { dayId, user } = await ctl(req);
    return timer.pause(user.id, dayId);
  });

  app.post('/days/:id/timer/resume', async (req) => {
    const { dayId, user } = await ctl(req);
    return timer.resume(user.id, dayId);
  });

  app.post('/days/:id/timer/advance', async (req) => {
    const { dayId, user } = await ctl(req);
    return timer.advance(user.id, dayId);
  });

  app.post('/days/:id/timer/finish', async (req) => {
    const { dayId, user } = await ctl(req);
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    return timer.finish(user.id, dayId, body.reason);
  });

  app.post('/days/:id/timer/adjust', async (req) => {
    const { dayId, user } = await ctl(req);
    const body = z.object({ stages: stagesSchema, reason: z.string().trim().min(5).max(500) }).parse(req.body);
    return timer.adjust(user.id, dayId, body.stages, body.reason);
  });

  app.post('/days/:id/timer/restart', async (req) => {
    const { dayId, user } = await ctl(req);
    const body = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    return timer.restart(user.id, dayId, body.reason);
  });
}
