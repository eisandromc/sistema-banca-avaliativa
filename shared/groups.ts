/** Cores de identificação dos grupos: contrastam com texto branco e entre si. */
export const GROUP_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#4f46e5',
  '#b45309',
  '#0d9488',
  '#be123c',
] as const;

/** Próxima cor para um grupo novo: a menos usada na banca (em empate, a primeira da paleta). */
export function nextGroupColor(used: string[]): string {
  const count = new Map<string, number>(GROUP_COLORS.map((c) => [c, 0]));
  for (const u of used) {
    const k = u.toLowerCase();
    if (count.has(k)) count.set(k, count.get(k)! + 1);
  }
  let best: string = GROUP_COLORS[0];
  for (const c of GROUP_COLORS) if (count.get(c)! < count.get(best)!) best = c;
  return best;
}

/** Endereço aceito para links de materiais: http(s) ou caminho do próprio sistema. */
export function isSafeLink(url: string, allowLocal = true): boolean {
  if (allowLocal && /^\/(?!\/)/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Converte o link de compartilhamento em um endereço que pode ser exibido dentro da página.
 * Google Apresentações/Docs/Drive e Canva têm endereços próprios de incorporação; os demais são usados como estão.
 */
export function embedUrl(url: string): string {
  let m = /^https?:\/\/docs\.google\.com\/presentation\/d\/([\w-]+)/.exec(url);
  if (m) return `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false`;
  m = /^https?:\/\/docs\.google\.com\/(document|spreadsheets)\/d\/([\w-]+)/.exec(url);
  if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`;
  m = /^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/.exec(url);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  m = /^https?:\/\/(?:www\.)?canva\.com\/design\/([\w-]+)\/([\w-]+)/.exec(url);
  if (m) return `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed`;
  return url;
}

/** Link de download direto, quando o serviço oferece um (Google Drive); senão, o próprio link. */
export function downloadUrl(url: string): string {
  const m = /^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/.exec(url);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}

/** Arquivos que podem ser enviados no cadastro do grupo. Só o PDF abre dentro do sistema; os demais são baixados. */
export type GroupFileKind = 'slides' | 'article';
export const GROUP_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const GROUP_FILE_TYPES: Record<GroupFileKind, Record<string, string>> = {
  slides: {
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    odp: 'application/vnd.oasis.opendocument.presentation',
  },
  article: {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    odt: 'application/vnd.oasis.opendocument.text',
  },
};

/** Extensão do arquivo em minúsculas ("" se não houver). */
export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** Endereço aceito para o repositório: https://github.com/… */
export function isGithubLink(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && /^(www\.)?github\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}
