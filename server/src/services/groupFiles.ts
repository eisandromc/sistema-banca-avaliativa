import type { Queryable } from '../db/database.ts';
import { badRequest } from '../http.ts';
import { GROUP_FILE_MAX_BYTES, GROUP_FILE_TYPES, fileExtension, type GroupFileKind } from '../../../shared/groups.ts';

export interface GroupFileInfo {
  kind: GroupFileKind;
  name: string;
  mime: string;
  size: number;
  uploadedAt: string;
  /** Endereço para exibir (PDF) ou baixar o arquivo. */
  url: string;
}

export function parseFileKind(raw: unknown): GroupFileKind {
  if (raw === 'slides' || raw === 'article') return raw;
  throw badRequest('Tipo de arquivo inválido (use slides ou article).');
}

const KIND_LABEL: Record<GroupFileKind, string> = { slides: 'Apresentação', article: 'Artigo' };

/** Assinatura dos primeiros bytes: PDF, pacote ZIP (pptx/docx/odp/odt) ou documento OLE antigo (ppt/doc). */
function matchesSignature(ext: string, data: Buffer): boolean {
  if (ext === 'pdf') return data.subarray(0, 5).toString('latin1') === '%PDF-';
  if (['pptx', 'docx', 'odp', 'odt'].includes(ext)) return data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (['ppt', 'doc'].includes(ext)) return data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return false;
}

/** Valida nome, tamanho e conteúdo do arquivo enviado e devolve o nome limpo e o tipo MIME. */
export function validateGroupFile(kind: GroupFileKind, rawName: string, data: Buffer) {
  const name = rawName
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(-200);
  const ext = fileExtension(name);
  const allowed = GROUP_FILE_TYPES[kind];
  const list = Object.keys(allowed).map((e) => e.toUpperCase()).join(', ');
  if (!name || !allowed[ext]) throw badRequest(`${KIND_LABEL[kind]}: envie um arquivo ${list}.`);
  if (!data.length) throw badRequest('O arquivo está vazio.');
  if (data.length > GROUP_FILE_MAX_BYTES) throw badRequest(`Arquivo muito grande (máx. ${GROUP_FILE_MAX_BYTES / 1024 / 1024} MB).`);
  if (!matchesSignature(ext, data)) throw badRequest(`O conteúdo do arquivo não corresponde a um ${ext.toUpperCase()} válido.`);
  return { name, mime: allowed[ext]! };
}

const toInfo = (r: any): GroupFileInfo => ({
  kind: r.kind,
  name: r.filename,
  mime: r.mime,
  size: r.size,
  uploadedAt: new Date(r.uploaded_at).toISOString(),
  // A versão no endereço evita que o navegador mostre o arquivo anterior após a troca.
  url: `/api/groups/${r.group_id}/files/${r.kind}?v=${new Date(r.uploaded_at).getTime()}`,
});

/** Arquivos (sem o conteúdo) de cada grupo, agrupados por id do grupo. */
export async function groupFilesFor(q: Queryable, groupIds: number[]) {
  const out = new Map<number, Partial<Record<GroupFileKind, GroupFileInfo>>>();
  if (!groupIds.length) return out;
  const rows = await q.query<any>('select group_id, kind, filename, mime, size, uploaded_at from group_files where group_id = any($1::int[]) and deleted_at is null', [groupIds]);
  for (const r of rows) {
    const m = out.get(r.group_id) ?? {};
    m[r.kind as GroupFileKind] = toInfo(r);
    out.set(r.group_id, m);
  }
  return out;
}

export function uploadedFile(r: any): GroupFileInfo {
  return toInfo(r);
}

/** Cabeçalho Content-Disposition com nome em UTF-8 (e alternativa ASCII para navegadores antigos). */
export function contentDisposition(name: string, download: boolean): string {
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/[\\"]/g, '') || 'arquivo';
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
