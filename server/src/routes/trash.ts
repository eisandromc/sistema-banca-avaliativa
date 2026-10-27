import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/session.ts';
import { audit } from '../audit.ts';
import { notFound, paramId } from '../http.ts';
import { listTrash, parseTrashKind, purgeAll, purgeItem, restoreItem } from '../services/trash.ts';

export async function trashRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  app.get('/trash', async (req) => {
    requireAdmin(req);
    return { items: await listTrash(db) };
  });

  app.post('/trash/:kind/:id/restore', async (req) => {
    const admin = requireAdmin(req);
    const kind = parseTrashKind((req.params as any).kind);
    const id = paramId(req);
    return db.tx(async (q) => {
      await restoreItem(q, kind, id);
      await audit(q, admin.id, 'trash.restored', kind, id);
      return { ok: true };
    });
  });

  // Eliminação definitiva de um item: ele some da lixeira e não pode mais ser restaurado.
  app.delete('/trash/:kind/:id', async (req) => {
    const admin = requireAdmin(req);
    const kind = parseTrashKind((req.params as any).kind);
    const id = paramId(req);
    return db.tx(async (q) => {
      if (!(await purgeItem(q, kind, id))) throw notFound('Item não encontrado na lixeira.');
      await audit(q, admin.id, 'trash.purged', kind, id);
      return { ok: true };
    });
  });

  app.delete('/trash', async (req) => {
    const admin = requireAdmin(req);
    return db.tx(async (q) => {
      const purged = await purgeAll(q);
      await audit(q, admin.id, 'trash.emptied', 'trash', null, { purged });
      return { ok: true, purged };
    });
  });
}
