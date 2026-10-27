/**
 * Cálculo puro do estado do cronômetro. Usado pelo servidor (fonte autoritativa)
 * e pelo cliente (interpolação visual entre mensagens do servidor).
 */

export interface Stage {
  name: string;
  durationSeconds: number;
  color: string;
  /** Pausa entre etapas (ex.: preparar os alunos): não entra na numeração "Etapa X/Y" nem muda de faixa de cor. */
  pause?: boolean;
  /** Destaca a troca para esta etapa: pulsa antes de entrar e logo depois de entrar. */
  alert?: boolean;
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
    // Pausa não "aperta": a faixa de cor fica normal até a próxima etapa.
    level: stage?.pause && !timeUp ? 'normal' : levelFor(stageRemainingPct, timeUp, thresholds),
  };
}

/** Numeração das etapas sem contar as pausas: { number: posição entre as etapas (0 numa pausa), of: total de etapas }. */
export function stageNumber(stages: Stage[], index: number): { number: number; of: number } {
  const of = stages.filter((s) => !s.pause).length;
  if (index < 0 || stages[index]?.pause) return { number: 0, of };
  return { number: stages.slice(0, index + 1).filter((s) => !s.pause).length, of };
}

export interface StageAlertWindow {
  /** Segundos de alerta antes de entrar numa etapa com destaque. */
  beforeSeconds: number;
  /** Segundos de destaque depois de entrar na etapa. */
  afterSeconds: number;
}

export const DEFAULT_STAGE_ALERT: StageAlertWindow = { beforeSeconds: 15, afterSeconds: 5 };

/**
 * Fase do alerta de troca de etapa: 'pre' nos últimos segundos antes de uma etapa com destaque,
 * 'enter' nos primeiros segundos dentro dela, null fora dessas janelas (ou com o tempo parado).
 */
export function stageAlertPhase(view: TimerView, w: StageAlertWindow): 'pre' | 'enter' | null {
  if (view.status !== 'running' || view.timeUp) return null;
  if (view.nextStage?.alert && w.beforeSeconds > 0 && view.stageRemainingMs <= w.beforeSeconds * 1000) return 'pre';
  if (view.stage?.alert && w.afterSeconds > 0 && view.stageElapsedMs < w.afterSeconds * 1000) return 'enter';
  return null;
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
