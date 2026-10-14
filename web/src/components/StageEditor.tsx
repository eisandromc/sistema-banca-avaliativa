import type { Stage } from '@shared/timer.ts';
import { formatClock } from '@shared/timer.ts';
import { Button } from './ui.tsx';

const PALETTE = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#be123c', '#4d7c0f'];

/** Editor de etapas ordenadas (nome, duração e cor), com total recalculado. */
export function StageEditor({ stages, onChange }: { stages: Stage[]; onChange: (s: Stage[]) => void }) {
  const set = (i: number, patch: Partial<Stage>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= stages.length) return;
    const copy = [...stages];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    onChange(copy);
  };
  const total = stages.reduce((a, s) => a + s.durationSeconds, 0);
  return (
    <div className="stage-editor">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Ordem</th>
            <th scope="col">Etapa</th>
            <th scope="col">Minutos</th>
            <th scope="col">Segundos</th>
            <th scope="col">Cor</th>
            <th scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input aria-label={`Nome da etapa ${i + 1}`} value={s.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} />
              </td>
              <td>
                <input
                  aria-label={`Minutos da etapa ${i + 1}`}
                  type="number"
                  min={0}
                  max={1440}
                  className="num"
                  value={Math.floor(s.durationSeconds / 60)}
                  onChange={(e) => set(i, { durationSeconds: Math.max(0, Number(e.target.value) || 0) * 60 + (s.durationSeconds % 60) })}
                />
              </td>
              <td>
                <input
                  aria-label={`Segundos da etapa ${i + 1}`}
                  type="number"
                  min={0}
                  max={59}
                  className="num"
                  value={s.durationSeconds % 60}
                  onChange={(e) => set(i, { durationSeconds: Math.floor(s.durationSeconds / 60) * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
                />
              </td>
              <td>
                <input aria-label={`Cor da etapa ${i + 1}`} type="color" value={s.color} onChange={(e) => set(i, { color: e.target.value })} />
              </td>
              <td className="row-actions">
                <Button variant="ghost" aria-label={`Subir etapa ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </Button>
                <Button variant="ghost" aria-label={`Descer etapa ${i + 1}`} disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </Button>
                <Button variant="ghost" aria-label={`Remover etapa ${i + 1}`} disabled={stages.length <= 1} onClick={() => onChange(stages.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row between">
        <Button onClick={() => onChange([...stages, { name: `Etapa ${stages.length + 1}`, durationSeconds: 300, color: PALETTE[stages.length % PALETTE.length]! }])}>
          + Adicionar etapa
        </Button>
        <strong>Total: {formatClock(total * 1000)}</strong>
      </div>
      {stages.some((s) => s.durationSeconds <= 0 || !s.name.trim()) && <p className="error-text">Toda etapa precisa de nome e duração maior que zero.</p>}
    </div>
  );
}

export function stagesValid(stages: Stage[]) {
  return stages.length > 0 && stages.every((s) => s.durationSeconds > 0 && s.name.trim());
}
