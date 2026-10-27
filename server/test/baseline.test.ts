import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPgliteDatabase, type Database } from '../src/db/database.ts';
import { migrate } from '../src/db/migrate.ts';
import { PI_EVENT_CONFIG, PI_LOGO_DATA_URL, PI_RUBRICS, PI_TYPE_NAME } from '../src/templates/projetoIntegrador.ts';

/** Rubrica do Projeto Integrador garantida em qualquer banco (servidor, `db:migrate`, testes), sem duplicar. */

/** Rubricas vigentes do tipo "Projeto Integrador", na ordem das fichas. */
const piRubrics = (db: Database) =>
  db.query<any>(
    `select v.title, v.scale_min, v.scale_max, v.scale_labels, (select count(*)::int from rubric_criteria c where c.version_id = v.id) as criteria
       from rubric_types rt
       join rubric_templates t on t.type_id = rt.id
       join lateral (select * from rubric_versions v where v.template_id = t.id and v.deleted_at is null order by v.version desc limit 1) v on true
      where lower(rt.name) = lower($1) and rt.deleted_at is null
      order by t.type_position`,
    [PI_TYPE_NAME],
  );

async function withDb(fn: (db: Database) => Promise<void>) {
  const db = await createPgliteDatabase(null);
  try {
    await fn(db);
  } finally {
    await db.close();
  }
}

describe('rubrica do Projeto Integrador em todo banco', () => {
  it('banco novo: só migrar já deixa o tipo com as 4 rubricas completas; repetir não duplica', () =>
    withDb(async (db) => {
      await migrate(db);
      await migrate(db);
      const rows = await piRubrics(db);
      expect(rows.map((r) => r.title)).toEqual(PI_RUBRICS.map((r) => r.title));
      for (const r of rows) {
        expect(r.criteria).toBe(5);
        expect([r.scale_min, r.scale_max]).toEqual([0, 5]);
        expect(r.scale_labels).toHaveLength(6);
      }
      expect((await db.one<any>('select count(*)::int as n from rubric_templates')).n).toBe(4);
      expect((await db.one<any>('select count(*)::int as n from rubric_types')).n).toBe(1);
    }));

  it('tipo ou versão enviados para a lixeira voltam a existir, completos, na próxima inicialização', () =>
    withDb(async (db) => {
      await migrate(db);
      await db.query('update rubric_types set deleted_at = now() where lower(name) = lower($1)', [PI_TYPE_NAME]);
      await migrate(db);
      expect(await piRubrics(db)).toHaveLength(4); // o tipo recriado não fica vazio

      const first = await db.one<any>('select v.id from rubric_versions v join rubric_templates t on t.id = v.template_id where t.name = $1', [PI_RUBRICS[0]!.name]);
      await db.query('update rubric_versions set deleted_at = now() where id = $1', [first.id]);
      await migrate(db);
      const rows = await piRubrics(db);
      expect(rows.map((r) => r.title)).toEqual(PI_RUBRICS.map((r) => r.title));
      expect(rows.every((r) => r.criteria === 5)).toBe(true);
    }));

  it('bancas que já usavam o modelo recebem, uma única vez, a cor, a orientação e o logotipo do instrumento', () =>
    withDb(async (db) => {
      await migrate(db);
      const old = `C${PI_EVENT_CONFIG.reportGuidance.slice(1)}`;
      const ev = await db.one<any>("insert into events (name, report_header, report_color, report_guidance) values ('Banca antiga', $1, '#0b5cab', $2) returning id", [
        PI_EVENT_CONFIG.reportHeader,
        old,
      ]);
      const other = await db.one<any>("insert into events (name, report_header, report_color) values ('Outra banca', 'Outro documento', '#0b5cab') returning id");
      await db.query("delete from schema_migrations where name = 'pi_documento_original'");
      await migrate(db);
      const e = await db.one<any>('select report_color, report_guidance, logo_data_url from events where id = $1', [ev.id]);
      expect(e).toEqual({ report_color: '#005ca9', report_guidance: PI_EVENT_CONFIG.reportGuidance, logo_data_url: PI_LOGO_DATA_URL });
      expect((await db.one<any>('select report_color, logo_data_url from events where id = $1', [other.id]))).toEqual({ report_color: '#0b5cab', logo_data_url: null });

      // Logotipo removido depois pelo administrador não volta.
      await db.query('update events set logo_data_url = null where id = $1', [ev.id]);
      await migrate(db);
      expect((await db.one<any>('select logo_data_url from events where id = $1', [ev.id])).logo_data_url).toBeNull();
    }));
});

describe('atribuição por ficha (migração 011)', () => {
  it('converte atribuições antigas (versão fixada) em fichas do tipo da banca, inclusive rubricas sem tipo', () =>
    withDb(async (db) => {
      // Banco no esquema anterior (até a 010), com atribuições que apontavam versões.
      const dir = resolve(import.meta.dirname, '../src/db/migrations');
      await db.exec('create table schema_migrations (name text primary key, applied_at timestamptz not null default now())');
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '011').sort()) {
        await db.exec(`begin;\n${readFileSync(resolve(dir, f), 'utf8')}\ninsert into schema_migrations (name) values ('${f}');\ncommit;`);
      }
      const user = (await db.one<any>("insert into users (name, email, password_hash, role) values ('Prof', 'p@x', 'x', 'teacher') returning id")).id;
      const version = async (name: string, typeId: number | null, position: number) => {
        const t = await db.one<any>('insert into rubric_templates (name, type_id, type_position) values ($1, $2, $3) returning id', [name, typeId, position]);
        return (await db.one<any>("insert into rubric_versions (template_id, version, title) values ($1, 1, $2) returning id", [t.id, name])).id;
      };
      const typeA = (await db.one<any>("insert into rubric_types (name) values ('Tipo A') returning id")).id;
      const a1 = await version('A1', typeA, 1);
      const a2 = await version('A2', typeA, 2);
      const solta = await version('Sem tipo', null, 0);
      const day = async (event: string, typeId: number | null) => {
        const e = await db.one<any>('insert into events (name, rubric_type_id) values ($1, $2) returning id', [event, typeId]);
        return (await db.one<any>("insert into event_days (event_id, date, start_time, end_time) values ($1, '2026-10-20', '08:00', '12:00') returning id", [e.id])).id;
      };
      const comTipo = await day('Com tipo', typeA);
      const semTipo = await day('Sem tipo, rubricas tipadas', null);
      const avulsa = await day('Rubrica avulsa', null);
      const assign = (d: number, v: number) => db.query('insert into evaluator_assignments (day_id, user_id, rubric_version_id) values ($1, $2, $3)', [d, user, v]);
      await assign(comTipo, a2);
      await assign(semTipo, a1);
      await assign(avulsa, solta);

      await migrate(db);
      const rows = await db.query<any>(
        `select e.name, a.rubric_position as p, t.name as type from evaluator_assignments a join event_days d on d.id = a.day_id
           join events e on e.id = d.event_id left join rubric_types t on t.id = e.rubric_type_id order by e.id`,
      );
      expect(rows).toEqual([
        { name: 'Com tipo', p: 2, type: 'Tipo A' },
        { name: 'Sem tipo, rubricas tipadas', p: 1, type: 'Tipo A' },
        { name: 'Rubrica avulsa', p: 1, type: 'Rubricas — Rubrica avulsa (#3)' },
      ]);
      expect(await db.one<any>("select type_position from rubric_templates where name = 'Sem tipo'")).toEqual({ type_position: 1 });
    }));
});
