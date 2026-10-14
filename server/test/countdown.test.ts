import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv, type Client } from './helpers.ts';

/** Contagem regressiva 10, 9, …, 0 (11 números, um por segundo) entre "Iniciar apresentação" e o início do tempo (relógio do servidor). */
let env: TestEnv;
let ana: Client;
let dayId: number;
let entryId: number;

beforeAll(async () => {
  env = await setupEnv({ countdownSeconds: 10 });
  ana = await env.login('ana@demo.banca');
  dayId = env.seed.dayId;
  entryId = (await ana.get(`/api/days/${dayId}/workspace`)).body.entries[0].entryId;
});
afterAll(async () => env.close());

describe('contagem regressiva do início', () => {
  it('ao iniciar, todas as telas recebem a contagem de 10 a 0 e o tempo só corre depois', async () => {
    expect((await ana.post(`/api/days/${dayId}/timer/start`, { entryId })).status).toBe(200);
    let live = (await env.anon.get(`/api/days/${dayId}/live`)).body;
    expect(live.timer.status).toBe('running');
    expect(live.timer.countdownMs).toBe(11_000);
    expect(live.timer.elapsedMs).toBe(0);
    // As fichas já abriram no clique.
    expect((await env.db.one<{ n: number }>('select count(*)::int as n from evaluations'))!.n).toBeGreaterThan(0);

    env.clock.advance(4_000);
    await env.app.ctx.timer.tick();
    live = (await env.anon.get(`/api/days/${dayId}/live`)).body;
    expect(live.timer.countdownMs).toBe(7_000);
    expect(live.timer.elapsedMs).toBe(0);

    env.clock.advance(8_500);
    await env.app.ctx.timer.tick();
    live = (await env.anon.get(`/api/days/${dayId}/live`)).body;
    expect(live.timer.countdownMs).toBe(0);
    expect(live.timer.elapsedMs).toBe(1_500);
  });

  it('pausar e retomar não repete a contagem', async () => {
    expect((await ana.post(`/api/days/${dayId}/timer/pause`)).status).toBe(200);
    expect((await ana.post(`/api/days/${dayId}/timer/resume`)).status).toBe(200);
    const live = (await env.anon.get(`/api/days/${dayId}/live`)).body;
    expect(live.timer.countdownMs).toBe(0);
    expect(live.timer.elapsedMs).toBe(1_500);
  });
});
