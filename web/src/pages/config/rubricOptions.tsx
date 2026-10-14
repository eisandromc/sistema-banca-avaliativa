import { api } from '../../lib/api.ts';
import { useLoad } from '../../components/ui.tsx';

export interface RubricTypeRow {
  id: number;
  name: string;
  description: string | null;
  eventsUsing: number;
  groupsUsing: number;
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

export interface RubricGroup {
  typeId: number | null;
  label: string;
  options: Array<{ id: number; label: string; latest: boolean }>;
}

/**
 * Versões de rubrica agrupadas por tipo, com o tipo indicado primeiro (o da banca).
 * Dentro do tipo, na ordem das fichas: "1. Nome — v2".
 */
export function rubricGroups(data: RubricsData | null | undefined, firstTypeId?: number | null): RubricGroup[] {
  if (!data) return [];
  const byType = new Map<number | null, RubricGroup>();
  const typeName = (id: number | null) => (id === null ? 'Sem tipo' : (data.types.find((t) => t.id === id)?.name ?? 'Tipo'));
  const templates = [...data.templates].sort((a, b) => a.typePosition - b.typePosition || a.name.localeCompare(b.name, 'pt-BR'));
  for (const t of templates) {
    const g = byType.get(t.typeId) ?? { typeId: t.typeId, label: typeName(t.typeId), options: [] };
    const last = t.versions[t.versions.length - 1];
    for (const v of t.versions) {
      g.options.push({
        id: v.id,
        label: `${t.typeId !== null ? `${t.typePosition}. ` : ''}${t.name}${t.versions.length > 1 ? ` — v${v.version}` : ''}`,
        latest: v.id === last?.id,
      });
    }
    byType.set(t.typeId, g);
  }
  const groups = [...byType.values()];
  groups.sort((a, b) => {
    const rank = (g: RubricGroup) => (g.typeId === (firstTypeId ?? -1) ? 0 : g.typeId === null ? 2 : 1);
    return rank(a) - rank(b) || a.label.localeCompare(b.label, 'pt-BR');
  });
  if (firstTypeId) {
    const first = groups[0];
    if (first && first.typeId === firstTypeId) first.label = `${first.label} (tipo da banca)`;
  }
  return groups;
}

/** Seletor de rubrica agrupado por tipo. */
export function RubricSelect({
  groups,
  value,
  onChange,
  id,
  ariaLabel,
  disabled,
  placeholder = 'Selecione…',
}: {
  groups: RubricGroup[];
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <select id={id} aria-label={ariaLabel} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.typeId ?? 'none'} label={g.label}>
          {g.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Nome da rubrica (para exibição). */
export function rubricLabel(groups: RubricGroup[], versionId: number | null | undefined): string | null {
  if (!versionId) return null;
  for (const g of groups) {
    const o = g.options.find((x) => x.id === versionId);
    if (o) return o.label;
  }
  return null;
}
