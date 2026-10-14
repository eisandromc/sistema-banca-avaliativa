import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync } from 'node:fs';

/**
 * Abstração mínima sobre PostgreSQL. Duas implementações com o mesmo SQL:
 *  - `pg` (node-postgres) quando DATABASE_URL está definido — servidor PostgreSQL real;
 *  - PGlite (PostgreSQL compilado para WASM) para desenvolvimento local e testes.
 *
 * IMPORTANTE: dentro de `tx(fn)`, use apenas o `q` recebido (PGlite tem uma única conexão).
 */
export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface Database extends Queryable {
  kind: 'pg' | 'pglite';
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const TYPE_DATE = 1082;
const TYPE_NUMERIC = 1700;
const TYPE_INT8 = 20;

const parseNumeric = (v: string) => (v === null ? null : Number.parseFloat(v));
const parseInt8 = (v: string) => (v === null ? null : Number.parseInt(v, 10));

function normalizeParams(params: unknown[] = []): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    // Arrays numéricos viram literal de array do PostgreSQL (use com `$n::int[]`);
    // demais objetos/arrays são serializados como JSON (colunas jsonb).
    if (Array.isArray(p) && p.every((x) => typeof x === 'number' && Number.isFinite(x))) return `{${p.join(',')}}`;
    if (p !== null && typeof p === 'object' && !(p instanceof Date)) return JSON.stringify(p);
    return p;
  });
}

export async function createPgDatabase(url: string): Promise<Database> {
  pg.types.setTypeParser(TYPE_DATE, (v) => v);
  pg.types.setTypeParser(TYPE_NUMERIC, parseNumeric);
  pg.types.setTypeParser(TYPE_INT8, parseInt8);
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query(sql, params) {
      const r = await client.query(sql, normalizeParams(params));
      return r.rows;
    },
    async one(sql, params) {
      const r = await client.query(sql, normalizeParams(params));
      return (r.rows[0] as any) ?? null;
    },
  });
  const base = wrap(pool);
  return {
    kind: 'pg',
    ...base,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createPgliteDatabase(dataDir: string | null): Promise<Database> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  // Forma com objeto: com `new PGlite(undefined, opts)` as opções seriam ignoradas.
  const db = new PGlite({
    ...(dataDir ? { dataDir } : {}),
    parsers: {
      [TYPE_DATE]: (v: string) => v,
      [TYPE_NUMERIC]: parseNumeric,
      [TYPE_INT8]: parseInt8,
    },
  });
  await db.waitReady;
  const wrap = (client: Pick<PGlite, 'query'>): Queryable => ({
    async query(sql, params) {
      const r = await client.query(sql, normalizeParams(params));
      return r.rows as any[];
    },
    async one(sql, params) {
      const r = await client.query(sql, normalizeParams(params));
      return (r.rows[0] as any) ?? null;
    },
  });
  const base = wrap(db);
  return {
    kind: 'pglite',
    ...base,
    async tx(fn) {
      return db.transaction(async (t) => fn(wrap(t as any)));
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

export async function createDatabase(opts: { databaseUrl: string | null; pgliteDir: string | null }): Promise<Database> {
  if (opts.databaseUrl) return createPgDatabase(opts.databaseUrl);
  return createPgliteDatabase(opts.pgliteDir);
}
