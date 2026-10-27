import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database, Queryable } from '../db/database.ts';
import type { AppConfig } from '../config.ts';
import { forbidden, notFound, unauthorized } from '../http.ts';
import { newToken, sha256 } from './password.ts';

export type Role = 'admin' | 'teacher' | 'viewer';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export const SESSION_COOKIE = 'banca_sid';
export const CSRF_HEADER = 'x-banca-csrf';

export async function createSession(db: Queryable, cfg: AppConfig, userId: number): Promise<string> {
  const token = newToken();
  const expires = new Date(Date.now() + cfg.sessionTtlHours * 3600_000);
  await db.query('insert into auth_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [sha256(token), userId, expires]);
  return token;
}

export async function userFromToken(db: Queryable, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  return db.one<SessionUser>(
    `select u.id, u.name, u.email, u.role
       from auth_sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active and u.deleted_at is null`,
    [sha256(token)],
  );
}

export function setSessionCookie(reply: FastifyReply, cfg: AppConfig, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.cookieSecure,
    signed: true,
    maxAge: cfg.sessionTtlHours * 3600,
  });
}

export function readSessionToken(req: FastifyRequest): string | undefined {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return undefined;
  const un = req.unsignCookie(raw);
  return un.valid && un.value ? un.value : undefined;
}

export function registerAuthHooks(app: FastifyInstance, db: Database) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // Proteção CSRF: toda requisição que altera estado precisa do cabeçalho customizado,
    // que navegadores não enviam em requisições cross-site sem CORS (não habilitado).
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== '1') {
      return reply.status(403).send({ error: 'Requisição recusada (proteção CSRF).', code: 'CSRF' });
    }
    req.user = await userFromToken(db, readSessionToken(req));
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== 'admin') throw forbidden('Somente administradores podem executar esta operação.');
  return u;
}

export interface DayAccess {
  dayId: number;
  eventId: number;
  isAdmin: boolean;
  isPrimary: boolean;
  isAssigned: boolean;
  isViewer: boolean;
  canControl: boolean;
}

export async function getDayAccess(q: Queryable, user: SessionUser | null, dayId: number): Promise<DayAccess> {
  const day = await q.one<{ id: number; event_id: number; primary_user_id: number | null }>(
    `select d.id, d.event_id, d.primary_user_id from event_days d join events e on e.id = d.event_id
      where d.id = $1 and d.deleted_at is null and e.deleted_at is null`,
    [dayId],
  );
  if (!day) throw notFound('Dia de banca não encontrado.');
  const isAdmin = user?.role === 'admin';
  const isPrimary = !!user && user.role === 'teacher' && day.primary_user_id === user.id;
  const assigned = user
    ? await q.one('select 1 from evaluator_assignments where day_id = $1 and user_id = $2 limit 1', [dayId, user.id])
    : null;
  return {
    dayId,
    eventId: day.event_id,
    isAdmin,
    isPrimary,
    isAssigned: !!assigned,
    isViewer: user?.role === 'viewer',
    canControl: isAdmin || isPrimary,
  };
}

export async function requireDayController(q: Queryable, req: FastifyRequest, dayId: number): Promise<{ user: SessionUser; access: DayAccess }> {
  const user = requireUser(req);
  const access = await getDayAccess(q, user, dayId);
  if (!access.canControl) {
    throw forbidden('Somente o professor primário deste dia ou um administrador pode controlar a sessão.');
  }
  return { user, access };
}

export async function requireDayMember(q: Queryable, req: FastifyRequest, dayId: number): Promise<{ user: SessionUser; access: DayAccess }> {
  const user = requireUser(req);
  const access = await getDayAccess(q, user, dayId);
  if (!access.isAdmin && !access.isPrimary && !access.isAssigned) {
    throw forbidden('Você não está vinculado a este dia de banca.');
  }
  return { user, access };
}
