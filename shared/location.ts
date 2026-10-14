/**
 * Monta o "Local" impresso a partir da sala do dia e do local da escola,
 * usando o modelo configurado na banca (marcadores {sala} e {escola}).
 * Se só um dos dois existir, usa apenas ele (sem separadores sobrando).
 */
export const DEFAULT_LOCATION_FORMAT = '{sala} — {escola}';

export function formatLocation(format: string | null | undefined, sala: string | null | undefined, escola: string | null | undefined): string {
  const s = (sala ?? '').trim();
  const e = (escola ?? '').trim();
  if (!s && !e) return '';
  if (!s) return e;
  if (!e) return s;
  const f = format && format.trim() ? format : DEFAULT_LOCATION_FORMAT;
  return f.replaceAll('{sala}', s).replaceAll('{escola}', e).trim();
}
