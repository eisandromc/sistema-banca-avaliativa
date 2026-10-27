import type { Queryable } from '../db/database.ts';
import { conflict, notFound } from '../http.ts';

export type TrashKind = 'event' | 'day' | 'profile' | 'group' | 'group_file' | 'rubric_type' | 'rubric_version' | 'vote_question' | 'user';

interface KindDef {
  table: string;
  label: string;
  /** Expressões SQL (alias `t`; `p` = item pai) para o nome exibido e o contexto (de onde o item vem). */
  name: string;
  context: string;
  joins?: string;
}

export const TRASH_KINDS: Record<TrashKind, KindDef> = {
  event: { table: 'events', label: 'Banca', name: 't.name', context: 'null' },
  day: {
    table: 'event_days',
    label: 'Dia de banca',
    name: `coalesce(nullif(t.label, ''), to_char(t.date, 'DD/MM/YYYY'))`,
    context: 'p.name',
    joins: 'join events p on p.id = t.event_id',
  },
  profile: { table: 'time_profiles', label: 'Perfil de tempo', name: 't.name', context: 'null' },
  group: { table: 'groups', label: 'Grupo', name: `t.code || ' — ' || t.title`, context: 'p.name', joins: 'join events p on p.id = t.event_id' },
  group_file: {
    table: 'group_files',
    label: 'Arquivo do grupo',
    name: `case t.kind when 'slides' then 'Apresentação' else 'Artigo' end || ' — ' || t.filename`,
    context: `p.code || ' — ' || p.title`,
    joins: 'join groups p on p.id = t.group_id',
  },
  rubric_type: { table: 'rubric_types', label: 'Tipo de rubrica', name: 't.name', context: 'null' },
  rubric_version: {
    table: 'rubric_versions',
    label: 'Rubrica',
    name: `t.title || ' (v' || t.version || ')'`,
    context: 'p.name',
    joins: 'join rubric_templates p on p.id = t.template_id',
  },
  user: { table: 'users', label: 'Usuário', name: 't.name', context: 't.email' },
  vote_question: { table: 'vote_questions', label: 'Pergunta de votação', name: 't.title', context: 'p.name', joins: 'join events p on p.id = t.event_id' },
};

export function parseTrashKind(raw: unknown): TrashKind {
  if (typeof raw === 'string' && Object.hasOwn(TRASH_KINDS, raw)) return raw as TrashKind;
  throw notFound('Tipo de item da lixeira inválido.');
}

/** Exclusão lógica: marca o item como excluído (vai para a lixeira). Devolve false se não existia ou já estava excluído. */
export async function softDelete(q: Queryable, kind: TrashKind, id: number, userId: number): Promise<boolean> {
  const rows = await q.query(`update ${TRASH_KINDS[kind].table} set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null returning id`, [id, userId]);
  return rows.length > 0;
}

export interface TrashItem {
  kind: TrashKind;
  kindLabel: string;
  id: number;
  name: string;
  context: string | null;
  deletedAt: string;
  deletedBy: string | null;
}

/** Itens na lixeira (excluídos e ainda não eliminados definitivamente), do mais recente ao mais antigo. */
export async function listTrash(q: Queryable): Promise<TrashItem[]> {
  const out: TrashItem[] = [];
  for (const [kind, def] of Object.entries(TRASH_KINDS) as Array<[TrashKind, KindDef]>) {
    const rows = await q.query<any>(
      `select t.id, ${def.name} as name, ${def.context} as context, t.deleted_at, u.name as deleted_by
         from ${def.table} t ${def.joins ?? ''}
         left join users u on u.id = t.deleted_by
        where t.deleted_at is not null and t.purged_at is null`,
    );
    for (const r of rows) {
      out.push({ kind, kindLabel: def.label, id: r.id, name: r.name, context: r.context, deletedAt: new Date(r.deleted_at).toISOString(), deletedBy: r.deleted_by });
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Torna o item visível novamente, desde que as dependências dele (banca, grupo…) não estejam excluídas. */
export async function restoreItem(q: Queryable, kind: TrashKind, id: number): Promise<void> {
  const def = TRASH_KINDS[kind];
  const row = await q.one<any>(`select * from ${def.table} where id = $1 and deleted_at is not null and purged_at is null`, [id]);
  if (!row) throw notFound('Item não encontrado na lixeira.');

  if ((kind === 'day' || kind === 'group' || kind === 'vote_question') && (await q.one('select 1 from events where id = $1 and deleted_at is not null', [row.event_id]))) {
    throw conflict('A banca deste item está na lixeira: restaure a banca primeiro.', 'PARENT_DELETED');
  }
  if (kind === 'group_file' && (await q.one('select 1 from groups where id = $1 and deleted_at is not null', [row.group_id]))) {
    throw conflict('O grupo deste arquivo está na lixeira: restaure o grupo primeiro.', 'PARENT_DELETED');
  }
  if (kind === 'group' && (await q.one('select 1 from groups where event_id = $1 and code = $2 and deleted_at is null', [row.event_id, row.code]))) {
    throw conflict(`Já existe outro grupo com o código ${row.code} nesta banca. Renomeie-o antes de restaurar.`, 'DUPLICATE');
  }
  if (kind === 'rubric_type' && (await q.one('select 1 from rubric_types where lower(name) = lower($1) and deleted_at is null', [row.name]))) {
    throw conflict('Já existe um tipo de rubrica com este nome. Renomeie-o antes de restaurar.', 'DUPLICATE');
  }
  if (kind === 'user' && (await q.one('select 1 from users where lower(email) = lower($1) and deleted_at is null', [row.email]))) {
    throw conflict('Já existe um usuário com este e-mail. Altere-o antes de restaurar.', 'DUPLICATE');
  }
  await q.query(`update ${def.table} set deleted_at = null, deleted_by = null where id = $1`, [id]);
}

/** Eliminação definitiva (UPDATE): o item deixa de aparecer na lixeira e não pode mais ser restaurado pela plataforma. */
export async function purgeItem(q: Queryable, kind: TrashKind, id: number): Promise<boolean> {
  const rows = await q.query(`update ${TRASH_KINDS[kind].table} set purged_at = now() where id = $1 and deleted_at is not null and purged_at is null returning id`, [id]);
  return rows.length > 0;
}

export async function purgeAll(q: Queryable): Promise<number> {
  let n = 0;
  for (const def of Object.values(TRASH_KINDS)) {
    n += (await q.query(`update ${def.table} set purged_at = now() where deleted_at is not null and purged_at is null returning 1`)).length;
  }
  return n;
}
