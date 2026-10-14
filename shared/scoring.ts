/**
 * Cálculo de pontuação ponderada.
 *
 * pontuação_do_professor (0–100) = Σ(nota_normalizada × peso) / Σ(peso) × 100
 *   - escala 0–10: nota_normalizada = nota / 10
 *   - outras escalas: exige normalização explícita ('linear': (nota − mín) / (máx − mín))
 * resultado final = média simples das pontuações dos professores com avaliação válida.
 *
 * Critério sem nota NUNCA vale zero: é excluído do numerador e do denominador
 * (só é possível para critérios opcionais ou dispensados pelo administrador).
 * O arredondamento (2 casas) acontece apenas na apresentação.
 */

export interface RubricScale {
  min: number;
  max: number;
  step: number;
  normalization: 'linear' | null;
}

export interface CriterionDef {
  id: number;
  title: string;
  weight: number;
  required: boolean;
}

export interface CriterionPart {
  criterionId: number;
  score: number | null;
  weight: number;
  normalized: number | null;
  /** Contribuição em pontos (0–100) para a pontuação do professor. */
  contribution: number | null;
  waived: boolean;
}

export interface TeacherScoreResult {
  score: number | null;
  usedWeight: number;
  totalWeight: number;
  missingRequired: number[];
  parts: CriterionPart[];
}

export function isDefaultScale(scale: RubricScale): boolean {
  return scale.min === 0 && scale.max === 10;
}

export function normalizationConfigured(scale: RubricScale): boolean {
  return isDefaultScale(scale) || scale.normalization === 'linear';
}

export function normalizeScore(score: number, scale: RubricScale): number {
  if (!normalizationConfigured(scale)) {
    throw new Error('Normalização da escala não configurada para esta rubrica.');
  }
  if (isDefaultScale(scale)) return score / 10;
  return (score - scale.min) / (scale.max - scale.min);
}

/** Valida uma nota contra a escala (limites e incremento). Retorna mensagem de erro ou null. */
export function validateScore(value: number, scale: RubricScale): string | null {
  if (!Number.isFinite(value)) return 'Nota inválida.';
  if (value < scale.min || value > scale.max) return `A nota deve estar entre ${scale.min} e ${scale.max}.`;
  if (scale.step > 0) {
    const steps = (value - scale.min) / scale.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) return `A nota deve variar em incrementos de ${scale.step}.`;
  }
  return null;
}

export function teacherScore(
  criteria: CriterionDef[],
  scores: ReadonlyMap<number, number | null>,
  scale: RubricScale,
  waived: ReadonlySet<number> = new Set(),
): TeacherScoreResult {
  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0);
  const missingRequired: number[] = [];
  let usedWeight = 0;
  let weighted = 0;
  const parts: CriterionPart[] = criteria.map((c) => {
    const raw = scores.get(c.id);
    const score = raw === undefined ? null : raw;
    const isWaived = waived.has(c.id);
    if (score === null || isWaived) {
      if (score === null && c.required && !isWaived) missingRequired.push(c.id);
      return { criterionId: c.id, score, weight: c.weight, normalized: null, contribution: null, waived: isWaived };
    }
    const normalized = normalizeScore(score, scale);
    usedWeight += c.weight;
    weighted += normalized * c.weight;
    return { criterionId: c.id, score, weight: c.weight, normalized, contribution: null, waived: false };
  });
  for (const p of parts) {
    if (p.normalized !== null && usedWeight > 0) p.contribution = ((p.normalized * p.weight) / usedWeight) * 100;
  }
  const score = usedWeight > 0 ? (weighted / usedWeight) * 100 : null;
  return { score, usedWeight, totalWeight, missingRequired, parts };
}

export function finalScore(teacherScores: Array<number | null>): number | null {
  const valid = teacherScores.filter((s): s is number => s !== null && Number.isFinite(s));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Arredonda para duas casas — usar SOMENTE na apresentação. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatScore(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return round2(n).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
