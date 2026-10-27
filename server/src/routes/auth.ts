import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, sha256, verifyPassword } from '../auth/password.ts';
import { createSession, readSessionToken, requireUser, SESSION_COOKIE, setSessionCookie } from '../auth/session.ts';
import { HttpError, badRequest } from '../http.ts';
import { audit } from '../audit.ts';

// Limitação simples de tentativas de login (por IP + e-mail), em memória.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

function checkRate(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return;
  }
  a.count++;
  if (a.count > MAX_ATTEMPTS) throw new HttpError(429, 'Muitas tentativas de login. Aguarde alguns minutos.', 'RATE_LIMIT');
}

export async function authRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;

  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) }).parse(req.body);
    const key = `${req.ip}|${body.email.toLowerCase()}`;
    checkRate(key);
    const user = await db.one<any>('select * from users where lower(email) = lower($1) and deleted_at is null', [body.email]);
    // Verifica sempre a senha (mesmo sem usuário) para reduzir diferenças de tempo.
    const ok = user
      ? await verifyPassword(body.password, user.password_hash)
      : await verifyPassword(body.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    if (!user || !ok || !user.active) {
      throw new HttpError(401, 'E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');
    }
    attempts.delete(key);
    const token = await createSession(db, config, user.id);
    setSessionCookie(reply, config, token);
    await audit(db, user.id, 'auth.login', 'user', user.id, { ip: req.ip });
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = readSessionToken(req);
    if (token) await db.query('delete from auth_sessions where token_hash = $1', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    if (!req.user) return { user: null };
    const primaryDays = await db.query<{ id: number }>('select id from event_days where primary_user_id = $1', [req.user.id]);
    return { user: req.user, primaryDayIds: primaryDays.map((d) => d.id) };
  });

  app.post('/auth/password', async (req) => {
    const user = requireUser(req);
    const body = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) }).parse(req.body);
    const row = await db.one<any>('select password_hash from users where id = $1', [user.id]);
    if (!row || !(await verifyPassword(body.current, row.password_hash))) throw badRequest('Senha atual incorreta.');
    await db.query('update users set password_hash = $2 where id = $1', [user.id, await hashPassword(body.next)]);
    await audit(db, user.id, 'auth.password_changed', 'user', user.id);
    return { ok: true };
  });
}
