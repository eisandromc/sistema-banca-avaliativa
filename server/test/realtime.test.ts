import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { setupEnv, type Client, type TestEnv } from './helpers.ts';

let env: TestEnv;
let base: string;
let ana: Client, bruno: Client;

class WsClient {
  messages: any[] = [];
  private waiters: Array<{ pred: (m: any) => boolean; resolve: (m: any) => void }> = [];
  constructor(public ws: WebSocket) {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.resolve(m);
          return false;
        }
        return true;
      });
    });
  }
  static async open(url: string, cookie?: string) {
    const ws = new WebSocket(url, cookie ? { headers: { cookie } } : {});
    const c = new WsClient(ws);
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    return c;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  waitFor(pred: (m: any) => boolean, timeoutMs = 4000): Promise<any> {
    const found = this.messages.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout aguardando mensagem')), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }
  clear() {
    this.messages = [];
  }
  close() {
    this.ws.close();
  }
}

beforeAll(async () => {
  env = await setupEnv();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = env.app.server.address() as { port: number };
  base = `ws://127.0.0.1:${addr.port}/ws`;
  ana = await env.login('ana@demo.banca');
  bruno = await env.login('bruno@demo.banca');
});

afterAll(async () => env.close());

describe('sincronização em tempo real', () => {
  it('projeção (anônima) e docente recebem o início em tempo real e a abertura das fichas', async () => {
    const dayId = env.seed.dayId;
    const projector = await WsClient.open(base);
    const teacher = await WsClient.open(base, bruno.cookie!);
    for (const c of [projector, teacher]) {
      c.send({ type: 'subscribe', dayId });
      const first = await c.waitFor((m) => m.type === 'live');
      expect(first.state.timer).toBeNull();
    }
    const entries = (await ana.get(`/api/days/${dayId}/workspace`)).body.entries;
    projector.clear();
    teacher.clear();
    const r = await ana.post(`/api/days/${dayId}/timer/start`, { entryId: entries[0].entryId });
    expect(r.status).toBe(200);

    for (const c of [projector, teacher]) {
      const live = await c.waitFor((m) => m.type === 'live' && m.state.timer?.status === 'running');
      expect(live.state.current.code).toBe('Grupo 01');
      const opened = await c.waitFor((m) => m.type === 'evaluations-opened');
      expect(opened.entryId).toBe(entries[0].entryId);
    }
    // As mensagens transmitidas não carregam notas, comentários nem votos.
    const all = JSON.stringify([...projector.messages, ...teacher.messages]);
    expect(all).not.toMatch(/score|comment|vote/i);

    // Docente recebe a ficha sem recarregar: o sinal leva ao REST, que já devolve a ficha aberta.
    const ws = (await bruno.get(`/api/days/${dayId}/workspace`)).body;
    expect(ws.current.myEvaluationId).toBeGreaterThan(0);

    // Pausa propagada aos dois clientes com o mesmo tempo decorrido.
    projector.clear();
    teacher.clear();
    env.clock.advance(65_000);
    await ana.post(`/api/days/${dayId}/timer/pause`);
    const p1 = await projector.waitFor((m) => m.type === 'live' && m.state.timer?.status === 'paused');
    const p2 = await teacher.waitFor((m) => m.type === 'live' && m.state.timer?.status === 'paused');
    expect(p1.state.timer.elapsedMs).toBe(65_000);
    expect(p2.state.timer.elapsedMs).toBe(p1.state.timer.elapsedMs);
    expect(p1.state.timer.sessionId).toBe(p2.state.timer.sessionId);

    // Reconexão: um novo cliente recebe o mesmo estado (o cronômetro não reinicia).
    projector.close();
    const again = await WsClient.open(base);
    again.send({ type: 'subscribe', dayId });
    const restored = await again.waitFor((m) => m.type === 'live');
    expect(restored.state.timer.sessionId).toBe(p1.state.timer.sessionId);
    expect(restored.state.timer.elapsedMs).toBe(65_000);
    again.close();
    teacher.close();
  });

  it('exibição pública desativada bloqueia anônimos no canal', async () => {
    const admin = await env.login('admin@demo.banca');
    const events = (await admin.get('/api/events')).body.events;
    const ev = events[0];
    await admin.put(`/api/events/${ev.id}`, { ...ev, publicDisplay: false });
    const anon = await WsClient.open(base);
    anon.send({ type: 'subscribe', dayId: env.seed.dayId });
    const err = await anon.waitFor((m) => m.type === 'error');
    expect(err.error).toMatch(/permissão/);
    expect((await env.anon.get(`/api/days/${env.seed.dayId}/live`)).status).toBe(403);
    anon.close();
  });
});
