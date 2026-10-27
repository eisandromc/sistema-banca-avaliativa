import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Database } from './database.ts';
import { ensurePiBaseline } from '../templates/projetoIntegrador.ts';

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'migrations');

/**
 * Aplica, em ordem e em transação, as migrações .sql ainda não registradas e, em seguida, garante os
 * dados de base (rubrica do Projeto Integrador), em qualquer ambiente e banco.
 */
export async function migrate(db: Database, log: (msg: string) => void = () => undefined): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    const safeName = file.replace(/'/g, "''");
    await db.exec(`begin;\n${sql}\ninsert into schema_migrations (name) values ('${safeName}');\ncommit;`);
    log(`migração aplicada: ${file}`);
    done.push(file);
  }
  await ensurePiBaseline(db);
  return done;
}
