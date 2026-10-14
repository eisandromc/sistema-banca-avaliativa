/**
 * Cálculo puro do estado do cronômetro. Usado pelo servidor (fonte autoritativa)
 * e pelo cliente (interpolação visual entre mensagens do servidor).
 */

export interface Stage {
  name: string;
  durationSeconds: number;
  color: string;
}

export type TimerStatus = 'idle' | 'running' | 'paused' | 'ended' | 'stopped';

export type TimerLevel = 'normal' | 'warn' | 'danger' | 'over';

export interface Thresholds {
  /** Acima deste percentual restante da etapa: faixa normal. */
  warnPct: number;
  /** Até este percentual restante da etapa: faixa laranja. */
  dangerPct: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { warnPct: 50, dangerPct: 20 };

export interface TimerView {
  status: TimerStatus;
  totalMs: number;
  elapsedMs: number;
  totalRemainingMs: number;
  stageIndex: number;
  stage: Stage | null;
  nextStage: Stage | null;
  stageDurationMs: number;
  stageElapsedMs: number;
  stageRemainingMs: number;
  stageRemainingPct: number;
  progressPct: number;
  /** Tempo total esgotado (00:00). */
  timeUp: boolean;
  level: TimerLevel;
}

export function totalDurationMs(stages: Stage[]): number {
  return stages.reduce((acc, s) => acc + s.durationSeconds * 1000, 0);
}

/** Início (ms decorridos) da etapa de índice `index`. */
export function stageStartMs(stages: Stage[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < stages.length; i++) acc += stages[i]!.durationSeconds * 1000;
  return acc;
}

export function computeTimer(
  stages: Stage[],
  rawElapsedMs: number,
  status: TimerStatus,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): TimerView {
  const totalMs = totalDurationMs(stages);
  // Tempo negativo é bloqueado: o decorrido nunca passa do total.
  const elapsedMs = Math.max(0, Math.min(rawElapsedMs, totalMs));
  const totalRemainingMs = totalMs - elapsedMs;
  const timeUp = totalMs > 0 && totalRemainingMs <= 0 && status !== 'idle';

  let stageIndex = stages.length - 1;
  let acc = 0;
  for (let i = 0; i < stages.length; i++) {
    const d = stages[i]!.durationSeconds * 1000;
    if (elapsedMs < acc + d) {
      stageIndex = i;
      break;
    }
    acc += d;
  }
  if (stages.length === 0) stageIndex = -1;
  const stage = stageIndex >= 0 ? stages[stageIndex]! : null;
  const stageDurationMs = stage ? stage.durationSeconds * 1000 : 0;
  const stageStart = stageIndex >= 0 ? stageStartMs(stages, stageIndex) : 0;
  const stageElapsedMs = Math.min(stageDurationMs, elapsedMs - stageStart);
  const stageRemainingMs = timeUp ? 0 : Math.max(0, stageDurationMs - stageElapsedMs);
  const stageRemainingPct = stageDurationMs > 0 ? (stageRemainingMs / stageDurationMs) * 100 : 0;
  const nextStage = !timeUp && stageIndex >= 0 && stageIndex + 1 < stages.length ? stages[stageIndex + 1]! : null;

  return {
    status,
    totalMs,
    elapsedMs,
    totalRemainingMs,
    stageIndex,
    stage,
    nextStage,
    stageDurationMs,
    stageElapsedMs,
    stageRemainingMs,
    stageRemainingPct,
    progressPct: totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0,
    timeUp,
    level: levelFor(stageRemainingPct, timeUp, thresholds),
  };
}

export function levelFor(stageRemainingPct: number, timeUp: boolean, t: Thresholds): TimerLevel {
  if (timeUp) return 'over';
  if (stageRemainingPct > t.warnPct) return 'normal';
  if (stageRemainingPct > t.dangerPct) return 'warn';
  return 'danger';
}

export const LEVEL_LABEL: Record<TimerLevel, string> = {
  normal: 'Tempo confortável',
  warn: 'Atenção: metade do tempo da etapa',
  danger: 'Reta final da etapa',
  over: 'TEMPO ENCERRADO',
};

/** Formata milissegundos restantes como MM:SS (arredonda para cima, exibe 20:00 no início e 00:00 só no fim). */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<TimerStatus, string> = {
  idle: 'Não iniciado',
  running: 'Em execução',
  paused: 'Pausado',
  ended: 'Encerrado',
  stopped: 'Encerrado',
};
