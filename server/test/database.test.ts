import { describe, expect, it } from 'vitest';
import { createPgliteDatabase } from '../src/db/database.ts';

describe('parâmetros de array', () => {
  it('lista vazia gravada em jsonb continua lista; `$n::int[]` aceita lista vazia', async () => {
    const db = await createPgliteDatabase(null);
    try {
      await db.exec('create table t (id int primary key, opts jsonb not null)');
      await db.query('insert into t values ($1, $2), ($3, $4)', [1, [], 2, [7, 8]]);
      const rows = await db.query<{ opts: unknown }>('select opts from t order by id');
      expect(rows.map((r) => r.opts)).toEqual([[], [7, 8]]);
      expect(await db.query('select id from t where id = any($1::int[])', [[]])).toEqual([]);
      expect(await db.query('select id from t where id = any($1::int[]) order by id', [[2, 1]])).toEqual([{ id: 1 }, { id: 2 }]);
    } finally {
      await db.close();
    }
  });
});
