/** Texto orientador de um nível da escala, em um critério (rubrica analítica). */
export interface LevelDescriptor {
  value: number;
  text: string;
}

const EPS = 1e-9;

/** Níveis da escala (mín. a máx., no incremento). Escalas com mais de `limit` níveis devolvem lista vazia. */
export function scaleLevels(min: number, max: number, step: number, limit = 21): number[] {
  if (!(step > 0) || max <= min) return [];
  const n = Math.round((max - min) / step) + 1;
  if (n > limit) return [];
  return Array.from({ length: n }, (_, i) => Math.round((min + i * step) * 1000) / 1000);
}

/** Texto do nível correspondente à nota (ou null, se a nota não tem descritor). */
export function levelText(descriptors: LevelDescriptor[] | null | undefined, score: number | null | undefined): string | null {
  if (score === null || score === undefined || !descriptors?.length) return null;
  return descriptors.find((d) => Math.abs(d.value - score) < EPS)?.text ?? null;
}
