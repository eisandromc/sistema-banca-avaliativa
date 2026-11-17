import type { ReactNode } from 'react';
import { OrderBadge } from './ProjectMaterials.tsx';
import { MaterialsIndicator, materialsOfGroup } from './MaterialsIndicator.tsx';
import { IconAdvisor, IconUsers } from './icons.tsx';

/** Partículas que ficam em minúsculo no meio do nome (ex.: "Maria da Silva"). */
const PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du', 'del', 'van', 'von']);

/** "MARIA DA SILVA" / "maria da silva" → "Maria da Silva": só a primeira letra de cada nome em maiúsculo. */
export function formatPersonName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICLES.has(w) ? w : w.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('pt-BR'))))
    .join(' ');
}

type CardGroup = Parameters<typeof materialsOfGroup>[0] & {
  code: string;
  className: string | null;
  title: string;
  color: string;
  started: boolean;
};

/**
 * Conteúdo padrão do card de um projeto (grupo), igual nas abas Grupos e Distribuição:
 * cabeçalho (ordem/cor, código, turma e `aside` à direita), título, alunos participantes,
 * materiais e, por fim, `actions`. `lead` entra antes do cabeçalho (ex.: alça de arrastar).
 */
export function GroupCardBody({
  g,
  position,
  lead,
  aside,
  note,
  actions,
  hideMaterials,
}: {
  g: CardGroup;
  position?: number | null;
  lead?: ReactNode;
  aside?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  hideMaterials?: boolean;
}) {
  return (
    <>
      <div className="group-card-head">
        {lead}
        {position != null ? <OrderBadge position={position} color={g.color} /> : <span className="color-dot" style={{ background: g.color }} aria-hidden="true" />}
        <strong>{g.code}</strong>
        {g.className && <span className="muted">{g.className}</span>}
        {aside && (
          <>
            <span className="spacer" />
            {aside}
          </>
        )}
      </div>
      <p className="group-card-title">{g.title}</p>
      <PeopleList icon={<IconUsers size={14} />} label="Alunos" names={g.students} empty="Nenhum aluno informado" />
      <PeopleList
        icon={<IconAdvisor size={14} />}
        label={g.advisors.length > 1 ? 'Professores orientadores' : 'Professor(a) orientador(a)'}
        names={g.advisors}
        empty="Nenhum orientador informado"
      />
      {note}
      {(!hideMaterials || g.started) && (
        <div className="group-card-tags">
          {!hideMaterials && <MaterialsIndicator materials={materialsOfGroup(g)} groupCode={g.code} />}
          {g.started && <span className="tag tag-ok">já se apresentou</span>}
        </div>
      )}
      {actions && <div className="row-actions">{actions}</div>}
    </>
  );
}

/** Lista de pessoas do card (alunos, orientadores): rótulo com total e um nome por linha, já formatado. */
function PeopleList({ icon, label, names, empty }: { icon: ReactNode; label: string; names: string[]; empty: string }) {
  return (
    <div className="group-card-students">
      <span className="group-card-students-label">
        {icon} {label} {names.length > 0 && `(${names.length})`}
      </span>
      {names.length ? (
        <ul>
          {names.map((n, i) => (
            <li key={i}>{formatPersonName(n)}</li>
          ))}
        </ul>
      ) : (
        <span className="small muted">{empty}</span>
      )}
    </div>
  );
}
