import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, DEMO_DATE, type TestEnv } from './helpers.ts';
import { seedPiDemo } from '../src/db/seed.ts';
import { seedScenarios } from '../src/db/scenarios.ts';
import { enrichDemoData, DEMO_LINKS } from '../src/db/demoMaterials.ts';
import { migrate } from '../src/db/migrate.ts';

/** Complemento das bancas de demonstração: tipos de rubrica, resumo, orientadores e materiais (dados fictícios). */
let env: TestEnv;

beforeAll(async () => {
  env = await setupEnv();
  await seedPiDemo(env.db, { date: DEMO_DATE });
  await seedScenarios(env.db, { date: DEMO_DATE, now: Date.parse(`${DEMO_DATE}T11:00:00Z`) });
});
afterAll(async () => env.close());

describe('demonstração', () => {
  it('vincula um tipo de rubrica a cada banca de demonstração e preenche os materiais', async () => {
    await enrichDemoData(env.db);
    const events = await env.db.query<any>(
      "select e.name, t.name as type, (select count(*)::int from rubric_templates r where r.type_id = t.id) as n from events e left join rubric_types t on t.id = e.rubric_type_id where e.name like '%DEMONSTRAÇÃO%' order by e.name",
    );
    expect(events.length).toBe(3);
    for (const e of events) {
      expect(e.type, e.name).toBeTruthy();
      expect(e.n, e.name).toBeGreaterThanOrEqual(2);
    }
    const groups = await env.db.query<any>("select g.code, g.advisors, g.pdf_url, g.slides_url, g.github_url, g.description from groups g join events e on e.id = g.event_id where e.name like '%DEMONSTRAÇÃO%'");
    expect(groups.length).toBeGreaterThan(10);
    for (const g of groups) {
      expect(g.advisors.length, g.code).toBeGreaterThan(0);
      expect(g.pdf_url, g.code).toBe(DEMO_LINKS.pdfUrl);
      expect(g.github_url, g.code).toBe(DEMO_LINKS.githubUrl);
      expect(g.description, g.code).toBeTruthy();
    }
    // Um a cada três fica sem apresentação, para mostrar o caso vazio.
    expect(groups.some((g) => g.slides_url === null)).toBe(true);
    expect(groups.some((g) => g.slides_url === DEMO_LINKS.slidesUrl)).toBe(true);
  });

  it('é idempotente e não sobrescreve o que já foi preenchido', async () => {
    await env.db.query("update groups set pdf_url = 'https://example.org/meu.pdf' where code = 'Grupo 01'");
    await enrichDemoData(env.db);
    await enrichDemoData(env.db);
    const g = await env.db.one<any>("select pdf_url from groups where code = 'Grupo 01'");
    expect(g.pdf_url).toBe('https://example.org/meu.pdf');
    // Projeto Integrador (todas as bancas de demonstração) + o tipo de exemplo que os testes vinculam à banca base.
    expect((await env.db.one<any>('select count(*)::int as n from rubric_types')).n).toBe(2);
  });

  it('cores distintas: grupos novos da mesma banca não repetem a cor enquanto houver cores livres', async () => {
    const rows = await env.db.query<any>("select g.color from groups g join events e on e.id = g.event_id where e.name like 'Banca de Cenários%' order by g.code");
    expect(new Set(rows.slice(0, 10).map((r) => r.color)).size).toBe(10);
  });

  it('as migrações continuam idempotentes', async () => {
    await expect(migrate(env.db, () => undefined)).resolves.not.toThrow();
  });
});
