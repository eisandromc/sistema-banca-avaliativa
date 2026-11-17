import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { materialItems, type GroupMaterials } from '@shared/groups.ts';
import { IconAdvisor, IconArticle, IconDoc, IconGithub, IconLink, IconSlides, IconUsers } from './icons.tsx';

const ICONS: Record<keyof GroupMaterials, (p: { size?: number }) => ReactNode> = {
  summary: IconDoc,
  advisors: IconAdvisor,
  students: IconUsers,
  github: IconGithub,
  article: IconArticle,
  slides: IconSlides,
  viewLink: IconLink,
};

/** Materiais calculados a partir do cadastro completo do grupo (telas da Configuração). */
export function materialsOfGroup(g: {
  description: string | null;
  advisors: string[];
  students: string[];
  githubUrl: string | null;
  pdfUrl: string | null;
  slidesUrl: string | null;
  projectUrl: string | null;
  articleFile: unknown;
  slidesFile: unknown;
}): GroupMaterials {
  return {
    summary: !!g.description?.trim(),
    advisors: g.advisors.length > 0,
    students: g.students.length > 0,
    github: !!g.githubUrl,
    article: !!(g.articleFile || g.pdfUrl),
    slides: !!(g.slidesFile || g.slidesUrl),
    viewLink: !!g.projectUrl,
  };
}

/**
 * Sinalizador de materiais do grupo: um ícone por item (cheio = cadastrado, apagado = faltando) e o total.
 * Passar o mouse, focar pelo teclado ou tocar abre a explicação do que existe e do que falta.
 */
export function MaterialsIndicator({ materials, groupCode, compact }: { materials: GroupMaterials; groupCode: string; compact?: boolean }) {
  const items = materialItems(materials);
  const missing = items.filter((i) => !i.present);
  const done = items.length - missing.length;
  const complete = missing.length === 0;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  // Pequena espera ao sair com o mouse: dá tempo de levar o cursor até a dica.
  const hoverOpen = () => {
    window.clearTimeout(leaveTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // Posição fixa na tela (listas com rolagem própria não cortam a dica): abaixo do ícone, ou acima se faltar espaço,
  // sempre dentro da largura da janela.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const b = btnRef.current?.getBoundingClientRect();
    const t = tipRef.current?.getBoundingClientRect();
    if (!b || !t) return;
    const gap = 6;
    const below = b.bottom + gap;
    const top = below + t.height > window.innerHeight - 8 && b.top - gap - t.height > 8 ? b.top - gap - t.height : below;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - t.width - 8));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => !wrapRef.current?.contains(e.target as Node) && close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const summary = complete ? 'Materiais completos' : `${missing.length} item(ns) faltando`;
  return (
    <span className="mat-wrap" ref={wrapRef} onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button
        ref={btnRef}
        type="button"
        className={`mat-indicator ${complete ? 'is-complete' : 'is-missing'} ${compact ? 'is-compact' : ''}`}
        aria-label={`Materiais de ${groupCode}: ${done} de ${items.length}. ${summary}.`}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => !wrapRef.current?.contains(e.relatedTarget as Node) && setOpen(false)}
      >
        {!compact &&
          items.map((i) => {
            const Icon = ICONS[i.key];
            return (
              <span key={i.key} className={`mat-icon ${i.present ? 'is-present' : 'is-absent'}`} aria-hidden="true">
                <Icon size={15} />
              </span>
            );
          })}
        <span className="mat-count" aria-hidden="true">
          {complete ? '✔' : '!'} {done}/{items.length}
        </span>
      </button>
      {open && (
        <div
          ref={tipRef}
          id={tipId}
          role="tooltip"
          className="mat-tip"
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
        >
          <p className="mat-tip-title">{complete ? 'Tudo cadastrado' : `Faltam ${missing.length} de ${items.length} itens`}</p>
          <ul>
            {[...missing, ...items.filter((i) => i.present)].map((i) => {
              const Icon = ICONS[i.key];
              return (
                <li key={i.key} className={i.present ? 'is-present' : 'is-absent'}>
                  <span className="mat-tip-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span>
                    <strong>{i.label}</strong>
                    {i.present ? <span className="mat-tip-ok"> — cadastrado</span> : <span className="mat-tip-miss"> — falta: {i.missingHint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </span>
  );
}
