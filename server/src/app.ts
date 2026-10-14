import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from './config.ts';
import { createDatabase, type Database } from './db/database.ts';
import { migrate } from './db/migrate.ts';
import { errorHandler } from './http.ts';
import { registerAuthHooks } from './auth/session.ts';
import { RealtimeHub } from './realtime/hub.ts';
import { TimerService } from './services/timer.ts';
import { authRoutes } from './routes/auth.ts';
import { liveRoutes } from './routes/live.ts';
import { professorRoutes } from './routes/professor.ts';
import { closureRoutes } from './routes/closure.ts';
import { adminRoutes } from './routes/admin.ts';
import { realtimeRoutes } from './routes/realtime.ts';

export interface AppContext {
  config: AppConfig;
  db: Database;
  hub: RealtimeHub;
  timer: TimerService;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export async function buildApp(config: AppConfig, opts: { db?: Database; logger?: boolean; ticker?: boolean; now?: () => number } = {}) {
  const db = opts.db ?? (await createDatabase(config));
  await migrate(db, (m) => console.log(m));
  const hub = new RealtimeHub();
  const timer = new TimerService(db, hub, config.timerSpeed, opts.now, config.countdownSeconds > 0 ? (config.countdownSeconds + 1) * 1000 : 0); // N, N-1, …, 0: um número por segundo
  await timer.init();
  if (opts.ticker !== false) timer.startTicker();

  const app: FastifyInstance = Fastify({
    logger: opts.logger ?? config.env !== 'test',
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  });
  app.decorate('ctx', { config, db, hub, timer });
  app.setErrorHandler(errorHandler);

  await app.register(cookie, { secret: config.cookieSecret });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  registerAuthHooks(app, db);

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    );
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(liveRoutes);
      await api.register(professorRoutes);
      await api.register(closureRoutes);
      await api.register(adminRoutes);
      api.get('/health', async () => ({ ok: true, db: db.kind, timerSpeed: config.timerSpeed, env: config.env }));
    },
    { prefix: '/api' },
  );
  await app.register(realtimeRoutes);

  if (config.webDist && existsSync(resolve(config.webDist, 'index.html'))) {
    // wildcard (padrão): arquivos servidos dinamicamente — um novo build não exige reiniciar.
    await app.register(fastifyStatic, { root: config.webDist, index: ['index.html'] });
    // SPA: rotas do frontend (/cronometro, /professor, /configuracao...) devolvem o index.html;
    // caminhos de arquivo inexistentes (com extensão) recebem 404 real.
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0]!;
      const isFile = /\.[a-z0-9]+$/i.test(path);
      if (req.method === 'GET' && !isFile && !path.startsWith('/api/') && !path.startsWith('/ws')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'Rota não encontrada.', code: 'NOT_FOUND' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Rota não encontrada.', code: 'NOT_FOUND' }));
  }

  app.addHook('onClose', async () => {
    timer.stopTicker();
    if (!opts.db) await db.close();
  });

  return app;
}
