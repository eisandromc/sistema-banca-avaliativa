import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv, type Client } from './helpers.ts';

/** Pausa entre etapas e alerta de troca de etapa: perfis, banca e migração dos perfis existentes. */
let env: TestEnv;
let admin: Client;
let ana: Client;

beforeAll(async () => {
  env = await setupEnv();
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
});
afterAll(async () => env.close());

const DEMO_STAGES = [
  { name: 'Apresentação', durationSeconds: 600, color: '#2563eb' },
  { name: 'Demonstração', durationSeconds: 300, color: '#7c3aed', alert: true },
  { name: 'Pausa — preparação', durationSeconds: 30, color: '#64748b', pause: true },
  { name: 'Perguntas e considerações', durationSeconds: 300, color: '#0f766e' },
];

describe('perfil de tempo com pausa e destaque', () => {
  it('grava, lista e duplica a pausa e o destaque de entrada', async () => {
    const r = await admin.post('/api/profiles', { name: 'Com pausa', stages: DEMO_STAGES });
    expect(r.status).toBe(200);
    expect((await admin.post(`/api/profiles/${r.body.id}/duplicate`)).status).toBe(200);
    const list = (await admin.get('/api/profiles')).body.profiles;
    for (const name of ['Com pausa', 'Com pausa (cópia)']) {
      const p = list.find((x: any) => x.name === name);
      expect(p.stages).toEqual(DEMO_STAGES);
      expect(p.totalSeconds).toBe(1230);
    }
  });

  it('recusa perfil só com pausas', async () => {
    const r = await admin.post('/api/profiles', { name: 'Só pausa', stages: [{ name: 'Pausa', durationSeconds: 30, color: '#64748b', pause: true }] });
    expect(r.status).toBe(400);
  });

  it('a banca guarda os segundos do alerta e o telão os recebe', async () => {
    const ev = (await admin.get('/api/events')).body.events.find((e: any) => e.days.some((d: any) => d.id === env.seed.dayId));
    expect(ev.stageAlertBeforeSeconds).toBe(15);
    expect(ev.stageAlertAfterSeconds).toBe(5);
    const { id, hasLogo, days, ...body } = ev;
    expect((await admin.put(`/api/events/${id}`, { ...body, stageAlertBeforeSeconds: 20, stageAlertAfterSeconds: 3 })).status).toBe(200);
    expect((await admin.put(`/api/events/${id}`, { ...body, stageAlertBeforeSeconds: 500 })).status).toBe(400);
    const live = (await env.anon.get(`/api/days/${env.seed.dayId}/live`)).body;
    expect(live.event).toMatchObject({ stageAlertBeforeSeconds: 20, stageAlertAfterSeconds: 3 });
  });
});

describe('migração 006', () => {
  it('insere a pausa de 30 s entre Demonstração e Perguntas e destaca a Demonstração nos perfis existentes', async () => {
    const seedProfile = (await env.db.one<{ id: number }>("select id from time_profiles where name like 'Padrão 10 + 5 + 5%' order by id limit 1"))!.id;
    await env.db.query('update time_stages set alert = false where profile_id = $1', [seedProfile]);
    // Reaplica só a parte de dados da migração (as colunas já existem).
    const sql = readFileSync(resolve(import.meta.dirname, '../src/db/migrations/006_pausa_alerta_etapa.sql'), 'utf8');
    await env.db.exec(`begin;\n${sql.slice(sql.indexOf('-- Perfis existentes'))}\ncommit;`);
    const stages = await env.db.query<any>('select position, name, duration_seconds, is_pause, alert from time_stages where profile_id = $1 order by position', [seedProfile]);
    expect(stages.map((s) => [s.position, s.name, s.duration_seconds, s.is_pause, s.alert])).toEqual([
      [0, 'Apresentação', 600, false, false],
      [1, 'Demonstração', 300, false, true],
      [2, 'Pausa — preparação', 30, true, false],
      [3, 'Perguntas e considerações', 300, false, false],
    ]);
    // A sessão iniciada copia as etapas com a pausa e o destaque.
    const entryId = (await ana.get(`/api/days/${env.seed.dayId}/workspace`)).body.entries[0].entryId;
    expect((await ana.post(`/api/days/${env.seed.dayId}/timer/start`, { entryId })).status).toBe(200);
    const live = (await env.anon.get(`/api/days/${env.seed.dayId}/live`)).body;
    expect(live.timer.stages).toEqual(DEMO_STAGES);
  });
});
