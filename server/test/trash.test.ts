import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv, type Client } from './helpers.ts';

/** Lixeira: exclusão lógica, restauração, eliminação definitiva e vínculos preservados. */
let env: TestEnv;
let admin: Client;
let ana: Client;

const trash = async () => (await admin.get('/api/trash')).body.items as Array<{ kind: string; id: number; name: string }>;

beforeAll(async () => {
  env = await setupEnv();
  admin = await env.login('admin@demo.banca');
  ana = await env.login('ana@demo.banca');
});
afterAll(async () => env.close());

describe('lixeira', () => {
  it('só o administrador acessa', async () => {
    expect((await ana.get('/api/trash')).status).toBe(403);
    expect((await env.anon.get('/api/trash')).status).toBe(401);
  });

  it('grupo excluído vai para a lixeira, some das listas e pode ser restaurado', async () => {
    const c = await admin.post(`/api/events/${env.seed.eventId}/groups`, { code: 'L-01', title: 'Grupo da lixeira (fictício)', students: ['Aluno L'] });
    const id = c.body.id;
    expect((await admin.del(`/api/groups/${id}`)).status).toBe(200);

    const row = await env.db.one<any>('select deleted_at, purged_at from groups where id = $1', [id]);
    expect(row.deleted_at).not.toBeNull();
    expect(row.purged_at).toBeNull();

    const groups = (await admin.get(`/api/events/${env.seed.eventId}/groups`)).body.groups;
    expect(groups.some((g: any) => g.id === id)).toBe(false);
    expect((await trash()).some((t) => t.kind === 'group' && t.id === id)).toBe(true);

    // O código liberado pode ser reaproveitado; restaurar então conflita enquanto o código estiver em uso.
    const again = await admin.post(`/api/events/${env.seed.eventId}/groups`, { code: 'L-01', title: 'Outro', students: ['X'] });
    expect(again.status).toBe(200);
    expect((await admin.post(`/api/trash/group/${id}/restore`)).status).toBe(409);
    expect((await admin.del(`/api/groups/${again.body.id}`)).status).toBe(200);

    expect((await admin.post(`/api/trash/group/${id}/restore`)).status).toBe(200);
    const back = (await admin.get(`/api/events/${env.seed.eventId}/groups`)).body.groups;
    expect(back.some((g: any) => g.id === id)).toBe(true);
    expect((await trash()).some((t) => t.kind === 'group' && t.id === id)).toBe(false);
  });

  it('eliminar definitivamente (UPDATE) impede ver e restaurar', async () => {
    const c = await admin.post('/api/rubric-types', { name: 'Tipo descartável' });
    const id = c.body.id;
    await admin.del(`/api/rubric-types/${id}`);
    expect((await trash()).some((t) => t.kind === 'rubric_type' && t.id === id)).toBe(true);

    expect((await admin.del(`/api/trash/rubric_type/${id}`)).status).toBe(200);
    expect((await trash()).some((t) => t.kind === 'rubric_type' && t.id === id)).toBe(false);
    expect((await admin.post(`/api/trash/rubric_type/${id}/restore`)).status).toBe(404);
    const row = await env.db.one<any>('select purged_at from rubric_types where id = $1', [id]);
    expect(row.purged_at).not.toBeNull();
  });

  it('perfil em uso excluído continua listado como excluído (para aparecer taxado)', async () => {
    const days = (await admin.get('/api/events')).body.events.flatMap((e: any) => e.days);
    const used = days.find((d: any) => d.defaultProfileId);
    expect(used).toBeTruthy();
    const pid = used.defaultProfileId;
    expect((await admin.del(`/api/profiles/${pid}`)).status).toBe(200);

    const p = (await admin.get('/api/profiles')).body.profiles.find((x: any) => x.id === pid);
    expect(p.deleted).toBe(true);
    expect(p.usage).toBeGreaterThan(0);

    // Mesmo eliminado em definitivo, o vínculo segue exibindo o perfil como excluído.
    await admin.del(`/api/trash/profile/${pid}`);
    expect((await trash()).some((t) => t.kind === 'profile' && t.id === pid)).toBe(false);
    expect((await admin.get('/api/profiles')).body.profiles.find((x: any) => x.id === pid)?.deleted).toBe(true);
  });

  it('dia e banca excluídos somem; dia só restaura depois da banca', async () => {
    const ev = await admin.post('/api/events', { name: 'Banca temporária (fictícia)' });
    const eventId = ev.body.id;
    const day = await admin.post(`/api/events/${eventId}/days`, { label: 'Dia T', date: '2026-11-01', startTime: '08:00', endTime: '12:00' });
    const dayId = day.body.id;

    expect((await admin.del(`/api/days/${dayId}`)).status).toBe(200);
    expect((await admin.get('/api/events')).body.events.find((e: any) => e.id === eventId).days).toHaveLength(0);
    expect((await admin.del(`/api/events/${eventId}`)).status).toBe(200);
    expect((await admin.get('/api/events')).body.events.some((e: any) => e.id === eventId)).toBe(false);

    expect((await admin.post(`/api/trash/day/${dayId}/restore`)).status).toBe(409);
    expect((await admin.post(`/api/trash/event/${eventId}/restore`)).status).toBe(200);
    expect((await admin.post(`/api/trash/day/${dayId}/restore`)).status).toBe(200);
    expect((await admin.get('/api/events')).body.events.find((e: any) => e.id === eventId).days).toHaveLength(1);
  });

  it('tipo de rubrica excluído leva junto as rubricas dele e o roteiro pede outro tipo para a banca', async () => {
    const rubricCount = async () => (await admin.get('/api/admin/overview')).body.rubrics as number;
    const rubricCheck = async () => (await admin.get(`/api/events/${env.seed.eventId}/readiness`)).body.checks.find((c: any) => c.key === 'rubrics');
    const before = await rubricCount();
    expect((await rubricCheck()).status).toBe('ok');

    expect((await admin.del(`/api/rubric-types/${env.seed.rubricTypeId}`)).status).toBe(200);
    expect(await rubricCount()).toBe(before - 2);
    expect(await rubricCheck()).toMatchObject({ status: 'todo', tab: 'bancas' });

    expect((await admin.post(`/api/trash/rubric_type/${env.seed.rubricTypeId}/restore`)).status).toBe(200);
    expect(await rubricCount()).toBe(before);
    expect((await rubricCheck()).status).toBe('ok');
  });

  it('esvaziar a lixeira elimina tudo definitivamente', async () => {
    const c = await admin.post('/api/rubric-types', { name: 'Outro descartável' });
    await admin.del(`/api/rubric-types/${c.body.id}`);
    expect((await trash()).length).toBeGreaterThan(0);
    expect((await admin.del('/api/trash')).status).toBe(200);
    expect(await trash()).toHaveLength(0);
    const left = await env.db.one<any>('select count(*)::int as n from rubric_types where deleted_at is not null and purged_at is null');
    expect(left.n).toBe(0);
  });

  it('professor excluído perde o acesso, some da lista e pode ser restaurado', async () => {
    const c = await admin.post('/api/users', { name: 'Prof Lixo', email: 'lixo@demo.banca', role: 'teacher', password: 'senha-12345' });
    const id = c.body.id;
    const prof = await env.login('lixo@demo.banca', 'senha-12345');
    expect((await prof.get('/api/me/days')).status).toBe(200);

    expect((await admin.del(`/api/users/${id}`)).status).toBe(200);
    expect((await prof.get('/api/me/days')).status).toBe(401);
    expect((await admin.get('/api/users')).body.users.some((u: any) => u.id === id)).toBe(false);
    expect((await trash()).some((t) => t.kind === 'user' && t.id === id)).toBe(true);

    expect((await admin.post(`/api/trash/user/${id}/restore`)).status).toBe(200);
    expect((await admin.get('/api/users')).body.users.some((u: any) => u.id === id)).toBe(true);

    await admin.del(`/api/users/${id}`);
    expect((await admin.del(`/api/trash/user/${id}`)).status).toBe(200);
    expect((await admin.post(`/api/trash/user/${id}/restore`)).status).toBe(404);
  });

  it('não permite excluir a própria conta', async () => {
    const me = (await admin.get('/api/auth/me')).body.user.id;
    expect((await admin.del(`/api/users/${me}`)).status).toBe(400);
  });
});
