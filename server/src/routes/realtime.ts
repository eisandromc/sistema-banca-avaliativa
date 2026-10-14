import type { FastifyInstance } from 'fastify';
import { userFromToken, readSessionToken } from '../auth/session.ts';
import { canViewLive } from './live.ts';
import { DISPLAY_ROOM } from '../services/display.ts';

/**
 * Canal WebSocket em /ws. O cliente envia {type:"subscribe", dayId} e recebe:
 *  - "live": estado público do cronômetro (sem notas/comentários);
 *  - "day-changed": sinal para recarregar dados pelo REST (com autorização própria);
 *  - "evaluations-opened": as fichas do grupo foram liberadas.
 * Heartbeat por ping a cada 25 s; o cliente reconecta com backoff e tem fallback por polling.
 */
export async function realtimeRoutes(app: FastifyInstance) {
  const { db, hub, timer } = app.ctx;

  app.get('/ws', { websocket: true }, (socket, req) => {
    // Listeners registrados de forma síncrona; a sessão é resolvida em paralelo.
    const userP = userFromToken(db, readSessionToken(req)).catch(() => null);
    let alive = true;
    socket.on('pong', () => (alive = true));
    const hb = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 25_000);

    hub.send(socket, { type: 'hello', serverNow: Date.now() });

    socket.on('message', async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return hub.send(socket, { type: 'error', error: 'Mensagem inválida.' });
      }
      if (msg?.type === 'subscribe' && Number.isInteger(msg.dayId)) {
        try {
          const user = await userP;
          if (!(await canViewLive(db, user, msg.dayId))) return hub.send(socket, { type: 'error', error: 'Sem permissão para este dia.' });
          hub.join(msg.dayId, socket);
          hub.send(socket, { type: 'subscribed', dayId: msg.dayId });
          hub.send(socket, { type: 'live', dayId: msg.dayId, state: await timer.liveState(msg.dayId) });
        } catch {
          hub.send(socket, { type: 'error', error: 'Dia não encontrado.' });
        }
      } else if (msg?.type === 'subscribe-display') {
        // Telão: só recebe o sinal "o dia exibido mudou"; o cliente consulta /api/public/display.
        hub.join(DISPLAY_ROOM, socket);
        hub.send(socket, { type: 'display-changed' });
      } else if (msg?.type === 'unsubscribe' && Number.isInteger(msg.dayId)) {
        hub.leave(msg.dayId, socket);
      }
    });

    socket.on('close', () => {
      clearInterval(hb);
      hub.drop(socket);
    });
  });
}
