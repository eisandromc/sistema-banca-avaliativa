import { api } from '../../lib/api.ts';
import { useLoad } from '../../components/ui.tsx';

export interface RubricTypeRow {
  id: number;
  name: string;
  description: string | null;
  eventsUsing: number;
  groupsUsing: number;
  deleted?: boolean;
}

export interface RubricsData {
  types: RubricTypeRow[];
  templates: Array<{
    id: number;
    name: string;
    description: string | null;
    typeId: number | null;
    typePosition: number;
    versions: any[];
  }>;
}

export function useRubrics() {
  return useLoad(() => api.get<RubricsData>('/api/rubrics'), []);
}

/** Ficha de um tipo de rubrica: a posição (1ª, 2ª…) que o docente preenche. */
export interface Ficha {
  position: number;
  label: string;
}

/**
 * Fichas de um tipo, na ordem: "1ª ficha — Avaliador - Conteúdo Técnico" (título da versão mais recente).
 * A atribuição do docente guarda só a ficha; a rubrica vem sempre do tipo da banca (ou do grupo).
 */
export function fichasOf(data: RubricsData | null | undefined, typeId: number | null | undefined): Ficha[] {
  if (!data || !typeId) return [];
  return data.templates
    .filter((t) => t.typeId === typeId && t.typePosition > 0 && t.versions.length > 0)
    .sort((a, b) => a.typePosition - b.typePosition)
    .map((t) => ({ position: t.typePosition, label: `${t.typePosition}ª ficha — ${t.versions[t.versions.length - 1]?.title || t.name}` }));
}

/** Nome da ficha (para exibição); `null` se a posição não existe no tipo. */
export function fichaLabel(fichas: Ficha[], position: number | null | undefined): string | null {
  return fichas.find((f) => f.position === position)?.label ?? null;
}

/** Seletor da ficha do tipo de rubrica; uma ficha atribuída que saiu do tipo continua visível, marcada. */
export function FichaSelect({
  fichas,
  value,
  onChange,
  id,
  ariaLabel,
  disabled,
  placeholder = 'Selecione…',
}: {
  fichas: Ficha[];
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const missing = value !== null && !fichas.some((f) => f.position === value);
  return (
    <select id={id} aria-label={ariaLabel} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{fichas.length ? placeholder : 'Banca sem tipo de rubrica'}</option>
      {fichas.map((f) => (
        <option key={f.position} value={f.position}>
          {f.label}
        </option>
      ))}
      {missing && <option value={value}>{value}ª ficha (não existe no tipo)</option>}
    </select>
  );
}
