import { describe, expect, it } from 'vitest';
import { computeTimer, formatClock, stageAlertPhase, stageNumber, totalDurationMs, type Stage } from '../../shared/timer.ts';
import { finalScore, round2, teacherScore, validateScore, normalizeScore, formatScore } from '../../shared/scoring.ts';
import { computeSchedule, validateDayTimes } from '../../shared/schedule.ts';
import { tallyVotes } from '../../shared/votes.ts';

const STAGES: Stage[] = [
  { name: 'Apresentação', durationSeconds: 600, color: '#2563eb' },
  { name: 'Demonstração', durationSeconds: 300, color: '#7c3aed' },
  { name: 'Perguntas e considerações', durationSeconds: 300, color: '#0f766e' },
];
const MIN = 60_000;

describe('cronômetro — pausa e alerta de troca de etapa', () => {
  const WITH_PAUSE: Stage[] = [
    { name: 'Apresentação', durationSeconds: 600, color: '#2563eb' },
    { name: 'Demonstração', durationSeconds: 300, color: '#7c3aed', alert: true },
    { name: 'Pausa — preparação', durationSeconds: 30, color: '#64748b', pause: true },
    { name: 'Perguntas e considerações', durationSeconds: 300, color: '#0f766e' },
  ];
  const W = { beforeSeconds: 15, afterSeconds: 5 };
  const SEC = 1000;

  it('a pausa de 30 s entre Demonstração e Perguntas não entra na numeração das etapas', () => {
    expect(totalDurationMs(WITH_PAUSE)).toBe(20 * MIN + 30 * SEC);
    expect(stageNumber(WITH_PAUSE, 1)).toEqual({ number: 2, of: 3 });
    expect(stageNumber(WITH_PAUSE, 2)).toEqual({ number: 0, of: 3 });
    expect(stageNumber(WITH_PAUSE, 3)).toEqual({ number: 3, of: 3 });
    const pause = computeTimer(WITH_PAUSE, 15 * MIN + 29 * SEC, 'running');
    expect(pause.stage?.pause).toBe(true);
    expect(pause.nextStage?.name).toBe('Perguntas e considerações');
    expect(pause.level).toBe('normal'); // a pausa não pinta de laranja
    expect(computeTimer(WITH_PAUSE, 15 * MIN + 30 * SEC, 'running').stage?.name).toBe('Perguntas e considerações');
  });

  it('pulsa nos 15 s antes de entrar na Demonstração e nos 5 s depois; fora disso, normal', () => {
    const at = (ms: number, status: 'running' | 'paused' = 'running') => stageAlertPhase(computeTimer(WITH_PAUSE, ms, status), W);
    expect(at(10 * MIN - 16 * SEC)).toBeNull();
    expect(at(10 * MIN - 15 * SEC)).toBe('pre');
    expect(at(10 * MIN - 1)).toBe('pre');
    expect(at(10 * MIN)).toBe('enter');
    expect(at(10 * MIN + 4999)).toBe('enter');
    expect(at(10 * MIN + 5 * SEC)).toBeNull();
    // Etapas sem destaque (Perguntas) e cronômetro pausado não pulsam.
    expect(at(15 * MIN + 20 * SEC)).toBeNull();
    expect(at(10 * MIN - 5 * SEC, 'paused')).toBeNull();
    // 0 segundos desliga cada janela.
    expect(stageAlertPhase(computeTimer(WITH_PAUSE, 10 * MIN - 5 * SEC, 'running'), { beforeSeconds: 0, afterSeconds: 5 })).toBeNull();
    expect(stageAlertPhase(computeTimer(WITH_PAUSE, 10 * MIN + 1 * SEC, 'running'), { beforeSeconds: 15, afterSeconds: 0 })).toBeNull();
  });
});

describe('cronômetro — cálculo de etapas', () => {
  it('perfil 10+5+5 mostra exatamente 20:00 antes de iniciar', () => {
    const v = computeTimer(STAGES, 0, 'idle');
    expect(totalDurationMs(STAGES)).toBe(20 * MIN);
    expect(formatClock(v.totalRemainingMs)).toBe('20:00');
    expect(formatClock(v.stageRemainingMs)).toBe('10:00');
    expect(v.stage?.name).toBe('Apresentação');
    expect(v.nextStage?.name).toBe('Demonstração');
    expect(v.timeUp).toBe(false);
  });

  it('troca de etapa aos 10 e aos 15 minutos preservando o tempo total', () => {
    expect(computeTimer(STAGES, 10 * MIN - 1, 'running').stageIndex).toBe(0);
    const at10 = computeTimer(STAGES, 10 * MIN, 'running');
    expect(at10.stage?.name).toBe('Demonstração');
    expect(formatClock(at10.totalRemainingMs)).toBe('10:00');
    expect(formatClock(at10.stageRemainingMs)).toBe('05:00');
    const at15 = computeTimer(STAGES, 15 * MIN, 'running');
    expect(at15.stage?.name).toBe('Perguntas e considerações');
    expect(at15.nextStage).toBeNull();
  });

  it('ao fim dos 20 minutos: 00:00, TEMPO ENCERRADO (nível "over") e sem tempo negativo', () => {
    const v = computeTimer(STAGES, 25 * MIN, 'ended');
    expect(v.timeUp).toBe(true);
    expect(v.level).toBe('over');
    expect(v.totalRemainingMs).toBe(0);
    expect(formatClock(v.totalRemainingMs)).toBe('00:00');
    expect(v.elapsedMs).toBe(20 * MIN);
  });

  it('faixas de cor: normal > 50%, amarelo 50–21%, laranja 20–1% (limiares editáveis)', () => {
    expect(computeTimer(STAGES, 4 * MIN, 'running').level).toBe('normal'); // 60% restante
    expect(computeTimer(STAGES, 5 * MIN, 'running').level).toBe('warn'); // 50%
    expect(computeTimer(STAGES, 7.9 * MIN, 'running').level).toBe('warn'); // 21%
    expect(computeTimer(STAGES, 8 * MIN, 'running').level).toBe('danger'); // 20%
    expect(computeTimer(STAGES, 9.95 * MIN, 'running').level).toBe('danger');
    expect(computeTimer(STAGES, 4 * MIN, 'running', { warnPct: 70, dangerPct: 30 }).level).toBe('warn');
  });

  it('formatação arredonda para cima (não mostra 00:00 antes do fim)', () => {
    expect(formatClock(500)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(61_000)).toBe('01:01');
  });
});

describe('pontuação ponderada', () => {
  const scale = { min: 0, max: 10, step: 0.5, normalization: null };
  const criteria = [
    { id: 1, title: 'A', weight: 3, required: true },
    { id: 2, title: 'B', weight: 1, required: true },
    { id: 3, title: 'C', weight: 1, required: false },
  ];

  it('aplica a fórmula SUM((nota/10)*peso)/SUM(peso)*100', () => {
    const r = teacherScore(criteria, new Map([[1, 8], [2, 6], [3, 10]]), scale);
    // (0.8*3 + 0.6*1 + 1*1) / 5 * 100 = 80
    expect(r.score).toBeCloseTo(80, 10);
    expect(r.missingRequired).toEqual([]);
  });

  it('nota 0 é válida e diferente de campo vazio', () => {
    const zero = teacherScore(criteria, new Map([[1, 0], [2, 0], [3, 0]]), scale);
    expect(zero.score).toBe(0);
    expect(zero.missingRequired).toEqual([]);
    const empty = teacherScore(criteria, new Map([[1, null], [2, 5]]), scale);
    expect(empty.missingRequired).toEqual([1]);
    // critério opcional vazio não entra como zero: só B conta → 50
    expect(teacherScore(criteria, new Map([[1, 5], [2, 5], [3, null]]), scale).score).toBe(50);
  });

  it('critério dispensado sai do numerador e do denominador', () => {
    const r = teacherScore(criteria, new Map([[1, null], [2, 10], [3, 10]]), scale, new Set([1]));
    expect(r.missingRequired).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('resultado final = média simples das pontuações válidas; arredonda só na apresentação', () => {
    const f = finalScore([80, 70.333333, null]);
    expect(f).toBeCloseTo(75.1666665, 6);
    expect(round2(f!)).toBe(75.17);
    expect(formatScore(f)).toBe('75,17');
    expect(finalScore([null])).toBeNull();
  });

  it('escala diferente de 0–10 exige normalização explícita', () => {
    expect(() => normalizeScore(3, { min: 1, max: 5, step: 1, normalization: null })).toThrow(/Normalização/);
    expect(normalizeScore(3, { min: 1, max: 5, step: 1, normalization: 'linear' })).toBe(0.5);
  });

  it('valida limites e incrementos da escala', () => {
    expect(validateScore(10.5, scale)).toMatch(/entre/);
    expect(validateScore(-1, scale)).toMatch(/entre/);
    expect(validateScore(7.3, scale)).toMatch(/incrementos/);
    expect(validateScore(7.5, scale)).toBeNull();
    expect(validateScore(0, scale)).toBeNull();
  });
});

describe('cronograma', () => {
  it('calcula horários previstos com intervalo entre grupos e empurra apresentação que atravessaria o intervalo', () => {
    const r = computeSchedule({
      start: '07:30',
      end: '08:30',
      gapMinutes: 5,
      breaks: [{ label: 'Intervalo', start: '08:00', end: '08:10' }],
      items: [
        { id: 1, durationSeconds: 1200 },
        { id: 2, durationSeconds: 1200 },
        { id: 3, durationSeconds: 1200 },
      ],
    });
    expect(r.items[0]).toMatchObject({ startSec: 7.5 * 3600, endSec: 7.5 * 3600 + 1200, movedAfterBreak: null });
    // 07:55 + 20 min atravessaria 08:00–08:10 → começa 08:10
    expect(r.items[1]).toMatchObject({ startSec: 8 * 3600 + 600, movedAfterBreak: 'Intervalo' });
    expect(r.items[2]!.overflow).toBe(true);
    expect(r.warnings[0]).toMatch(/ultrapassam/);
  });

  it('valida horários do dia e sobreposição de intervalos', () => {
    expect(validateDayTimes('12:30', '07:30', [])).not.toHaveLength(0);
    expect(
      validateDayTimes('07:30', '12:30', [
        { label: 'A', start: '09:00', end: '09:30' },
        { label: 'B', start: '09:15', end: '09:45' },
      ]).join(' '),
    ).toMatch(/sobrepõem/);
    expect(validateDayTimes('07:30', '12:30', [{ label: 'A', start: '13:00', end: '13:10' }]).join(' ')).toMatch(/fora/);
    expect(validateDayTimes('07:30', '12:30', [{ label: 'A', start: '10:00', end: '10:20' }])).toEqual([]);
  });
});

describe('apuração de votos', () => {
  const options = [
    { id: 1, label: 'Aprovar', isAbstain: false },
    { id: 2, label: 'Não aprovar', isAbstain: false },
    { id: 3, label: 'Abster-se', isAbstain: true },
  ];
  it('maioria simples ignora abstenções', () => {
    const t = tallyVotes(options, [1, 1, 2, 3], 'simple_majority', null);
    expect(t.decision).toEqual({ kind: 'winner', optionId: 1, label: 'Aprovar' });
    expect(t.abstentions).toBe(1);
    expect(t.validVotes).toBe(3);
  });
  it('empate não gera decisão', () => {
    expect(tallyVotes(options, [1, 2], 'simple_majority', null).decision.kind).toBe('tie');
  });
  it('quórum mínimo', () => {
    expect(tallyVotes(options, [1, 3, 3], 'quorum', 2).decision.kind).toBe('no_quorum');
    expect(tallyVotes(options, [1, 1, 2], 'quorum', 2).decision.kind).toBe('winner');
  });
  it('somente contagem não decide', () => {
    const t = tallyVotes(options, [1, 1, 1], 'counts_only', null);
    expect(t.decision.kind).toBe('counts_only');
    expect(t.counts.find((c) => c.optionId === 1)!.count).toBe(3);
  });
});
