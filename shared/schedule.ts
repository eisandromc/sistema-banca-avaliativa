/**
 * Cálculo do cronograma previsto de um dia de banca.
 * Horários de parede ("HH:MM") no fuso do evento; não depende de fuso para a previsão.
 */

export interface BreakDef {
  label: string;
  start: string;
  end: string;
}

export interface ScheduleItemInput {
  id: number;
  durationSeconds: number;
}

export interface ScheduleItemResult {
  id: number;
  startSec: number;
  endSec: number;
  /** Termina depois do horário de encerramento do dia. */
  overflow: boolean;
  /** Foi empurrado para depois de um intervalo. */
  movedAfterBreak: string | null;
}

export interface ScheduleResult {
  items: ScheduleItemResult[];
  endSec: number;
  warnings: string[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHHMM(v: string): boolean {
  return HHMM.test(v);
}

export function parseHHMM(v: string): number {
  const m = HHMM.exec(v);
  if (!m) throw new Error(`Horário inválido: ${v}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

export function formatHHMM(sec: number): string {
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Valida horários do dia e dos intervalos. Retorna lista de erros (vazia se válido). */
export function validateDayTimes(start: string, end: string, breaks: BreakDef[]): string[] {
  const errors: string[] = [];
  if (!isHHMM(start) || !isHHMM(end)) {
    errors.push('Horários de início e fim devem estar no formato HH:MM.');
    return errors;
  }
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (e <= s) errors.push('O horário de encerramento deve ser posterior ao de início.');
  const parsed: Array<{ label: string; s: number; e: number }> = [];
  for (const b of breaks) {
    if (!isHHMM(b.start) || !isHHMM(b.end)) {
      errors.push(`Intervalo "${b.label}": horários devem estar no formato HH:MM.`);
      continue;
    }
    const bs = parseHHMM(b.start);
    const be = parseHHMM(b.end);
    if (be <= bs) errors.push(`Intervalo "${b.label}": o fim deve ser posterior ao início.`);
    if (bs < s || be > e) errors.push(`Intervalo "${b.label}" está fora do horário do dia.`);
    parsed.push({ label: b.label, s: bs, e: be });
  }
  parsed.sort((a, b) => a.s - b.s);
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i]!.s < parsed[i - 1]!.e) {
      errors.push(`Intervalos "${parsed[i - 1]!.label}" e "${parsed[i]!.label}" se sobrepõem.`);
    }
  }
  return errors;
}

export function computeSchedule(input: {
  start: string;
  end: string;
  gapMinutes: number;
  breaks: BreakDef[];
  items: ScheduleItemInput[];
}): ScheduleResult {
  const dayStart = parseHHMM(input.start);
  const dayEnd = parseHHMM(input.end);
  const breaks = input.breaks
    .filter((b) => isHHMM(b.start) && isHHMM(b.end))
    .map((b) => ({ label: b.label, s: parseHHMM(b.start), e: parseHHMM(b.end) }))
    .sort((a, b) => a.s - b.s);
  const gap = Math.max(0, input.gapMinutes) * 60;
  const warnings: string[] = [];
  const items: ScheduleItemResult[] = [];
  let cursor = dayStart;

  for (const it of input.items) {
    let start = cursor;
    let movedAfterBreak: string | null = null;
    // Evita que uma apresentação atravesse um intervalo: empurra para o fim do intervalo.
    let moved = true;
    while (moved) {
      moved = false;
      for (const b of breaks) {
        const end = start + it.durationSeconds;
        if (start < b.e && end > b.s) {
          start = b.e;
          movedAfterBreak = b.label;
          moved = true;
        }
      }
    }
    const end = start + it.durationSeconds;
    const overflow = end > dayEnd;
    items.push({ id: it.id, startSec: start, endSec: end, overflow, movedAfterBreak });
    cursor = end + gap;
  }
  const endSec = items.length ? items[items.length - 1]!.endSec : dayStart;
  const overflowCount = items.filter((i) => i.overflow).length;
  if (overflowCount > 0) {
    warnings.push(
      `${overflowCount} apresentação(ões) ultrapassam o horário de encerramento (${formatHHMM(dayEnd)}). Previsão de término: ${formatHHMM(endSec)}.`,
    );
  }
  return { items, endSec, warnings };
}
