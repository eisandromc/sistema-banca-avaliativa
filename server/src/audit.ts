import type { Queryable } from './db/database.ts';

export async function audit(
  q: Queryable,
  actorId: number | null,
  action: string,
  entity: string,
  entityId: number | string | null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await q.query(
    'insert into audit_logs (actor_id, action, entity, entity_id, details) values ($1, $2, $3, $4, $5)',
    [actorId, action, entity, entityId === null ? null : String(entityId), details],
  );
}
