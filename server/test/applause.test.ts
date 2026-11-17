import { describe, expect, it } from 'vitest';
import { applauseDue, demoStageIndex, type Stage } from '../../shared/timer.ts';

const s = (name: string, min: number, pause = false): Stage => ({ name, durationSeconds: min * 60, color: '#000', pause });
// Perfil da banca: Apresentação 8 → Demonstração 5 → Pausa 0,5 → Perguntas 5.
const perfil = [s('Apresentação', 8), s('Demonstração', 5), s('Pausa — preparação', 0.5, true), s('Perguntas e considerações', 5)];
const min = (m: number) => m * 60_000;

describe('palmas do telão', () => {
  it('disparam quando o relógio da Demonstração zera (13:00), e não antes', () => {
    expect(demoStageIndex(perfil)).toBe(1);
    expect(applauseDue(perfil, min(13) - 1, 'running')).toBe(false);
    expect(applauseDue(perfil, min(13), 'running')).toBe(true);
    expect(applauseDue(perfil, min(15), 'running')).toBe(true);
  });

  it('reconhece a etapa sem acento ou em outra caixa', () => {
    expect(demoStageIndex([s('Apresentacao', 1), s('DEMONSTRACAO DO PRODUTO', 1)])).toBe(1);
  });

  it('sem etapa de demonstração, disparam no fim do tempo total', () => {
    const semDemo = [s('Apresentação', 8), s('Perguntas', 5)];
    expect(applauseDue(semDemo, min(13) - 1, 'running')).toBe(false);
    expect(applauseDue(semDemo, min(13), 'ended')).toBe(true);
  });

  it('não disparam com o cronômetro parado no início', () => {
    expect(applauseDue(perfil, min(20), 'idle')).toBe(false);
  });
});
