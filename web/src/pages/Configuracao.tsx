import * as Tabs from '@radix-ui/react-tabs';
import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Alert, ErrorBox, Spinner, useLoad } from '../components/ui.tsx';
import { dayLabel } from '../lib/format.ts';
import { OverviewTab } from './config/Overview.tsx';
import { EventsTab } from './config/Events.tsx';
import { ProfilesTab } from './config/Profiles.tsx';
import { GroupsTab } from './config/Groups.tsx';
import { DistributionTab } from './config/Distribution.tsx';
import { RubricsTab } from './config/Rubrics.tsx';
import { VotesTab } from './config/Votes.tsx';
import { AccountsTab, EvaluatorsTab } from './config/Teachers.tsx';
import { MonitorTab } from './config/Monitor.tsx';
import { ClosureTab } from './config/Closure.tsx';
import { ReportsTab } from './config/Reports.tsx';
import { AuditTab } from './config/Audit.tsx';
import { TrashTab } from './config/Trash.tsx';

export interface EventData {
  id: number;
  name: string;
  institution: string | null;
  period: string | null;
  timezone: string;
  reportHeader: string | null;
  reportSubtitle: string | null;
  reportFooter: string | null;
  reportColor: string;
  showStudentNames: boolean;
  publicDisplay: boolean;
  warnPct: number;
  dangerPct: number;
  stageAlertBeforeSeconds: number;
  stageAlertAfterSeconds: number;
  editAfterSubmit: 'locked' | 'until_closure';
  votePrivacy: 'nominal' | 'anonymous';
  institutionDetail: string | null;
  reportPurpose: string | null;
  reportGuidance: string | null;
  schoolLocation: string | null;
  locationFormat: string;
  aggregation: 'mean' | 'sum';
  verdictOptions: string[];
  rubricTypeId: number | null;
  hasLogo: boolean;
  days: Array<{
    id: number;
    label: string;
    date: string;
    startTime: string;
    endTime: string;
    room: string | null;
    gapMinutes: number;
    defaultProfileId: number | null;
    primaryUserId: number | null;
    primaryRubricPosition: number | null;
    breaks: Array<{ id: number; label: string; start: string; end: string }>;
  }>;
}

interface ConfigCtxValue {
  events: EventData[];
  reloadEvents: () => Promise<void>;
  event: EventData | null;
  setEventId: (id: number | null) => void;
  dayId: number | null;
  setDayId: (id: number | null) => void;
  profiles: Array<{ id: number; name: string; active: boolean; stages: any[]; totalSeconds: number; usage: number; deleted?: boolean }>;
  reloadProfiles: () => Promise<void>;
  users: Array<{ id: number; name: string; email: string; role: string; active: boolean; deleted?: boolean; days?: Array<{ id: number; label: string; date: string; eventName: string }> }>;
  reloadUsers: () => Promise<void>;
  /** Abre outra seção da Configuração (ex.: a partir do roteiro de preparação). */
  goTo: (tab: string) => void;
}

const ConfigCtx = createContext<ConfigCtxValue | null>(null);
export const useConfig = () => useContext(ConfigCtx)!;

interface TabDef {
  id: string;
  label: string;
  description: string;
  step?: number;
}

/**
 * Seções na ordem de preenchimento. Primeiro os cadastros reutilizáveis (de que a banca depende),
 * depois a montagem da banca em si. A numeração é o roteiro sugerido.
 */
const SECTIONS: Array<{ label: string; hint?: string; tabs: TabDef[] }> = [
  {
    label: 'Início',
    tabs: [{ id: 'visao', label: 'Visão geral', description: 'Roteiro de preparação da banca selecionada: o que já está pronto e o que falta, dia a dia.' }],
  },
  {
    label: 'Cadastros base',
    hint: 'Valem para todas as bancas',
    tabs: [
      { id: 'professores', step: 1, label: 'Professores', description: 'Contas de acesso dos professores, administradores e do telão.' },
      { id: 'perfis', step: 2, label: 'Perfis de tempo', description: 'Etapas da apresentação com nome, duração e cor (ex.: 10 + 5 + 5 min). Cada dia usa um perfil padrão.' },
      {
        id: 'rubricas',
        step: 3,
        label: 'Tipos de rubrica',
        description: 'Cada tipo reúne as rubricas (fichas) usadas juntas numa banca. Ex.: “Projeto Integrador” com 4 fichas, uma por avaliador.',
      },
    ],
  },
  {
    label: 'Montagem da banca',
    hint: 'Banca selecionada acima',
    tabs: [
      { id: 'bancas', step: 4, label: 'Banca e dias', description: 'Dados da banca, o tipo de rubrica que ela usa, os dias (data, horário, sala, perfil de tempo) e o documento PDF.' },
      { id: 'grupos', step: 5, label: 'Grupos', description: 'Cada grupo com título, resumo, alunos, orientadores, materiais (PDF, apresentação, link) e cor de identificação.' },
      { id: 'distribuicao', step: 6, label: 'Distribuição nos dias', description: 'Arraste os grupos para o dia em que se apresentam e defina a ordem. Os horários previstos são calculados sozinhos.' },
      { id: 'avaliadores', step: 7, label: 'Primário e avaliadores', description: 'Em cada dia: quem conduz a banca (professor primário) e quem avalia, com qual ficha do tipo de rubrica da banca.' },
      { id: 'votacao', step: 8, label: 'Votação (opcional)', description: 'Perguntas votadas pelos avaliadores junto com a ficha (ex.: indicação para a feira).' },
    ],
  },
  {
    label: 'Durante a banca',
    tabs: [{ id: 'acompanhamento', label: 'Acompanhamento', description: 'Situação de cada grupo e das fichas em tempo real, e o histórico do cronômetro.' }],
  },
  {
    label: 'Resultados',
    tabs: [
      { id: 'fechamento', label: 'Conferência e fechamento', description: 'Conferir as notas, registrar exceções e parecer, fechar e reabrir avaliações.' },
      { id: 'relatorios', label: 'Relatórios', description: 'PDF de cada projeto fechado e o lote do dia.' },
    ],
  },
  {
    label: 'Sistema',
    tabs: [
      { id: 'auditoria', label: 'Auditoria', description: 'Registro de todas as ações administrativas e da condução das bancas.' },
      {
        id: 'lixeira',
        label: 'Lixeira',
        description: 'Tudo o que foi excluído vem para cá. Restaure para voltar a usar o item ou elimine definitivamente (não há como recuperar depois).',
      },
    ],
  },
];
const ALL_TABS = SECTIONS.flatMap((s) => s.tabs.map((t) => ({ ...t, section: s.label })));
const STEPS = ALL_TABS.filter((t) => t.step).length;
/** Endereços antigos (?secao=...) continuam funcionando. */
const LEGACY_TABS: Record<string, string> = { cronograma: 'distribuicao' };

const PANELS: Record<string, () => React.ReactNode> = {
  visao: () => <OverviewTab />,
  professores: () => <AccountsTab />,
  perfis: () => <ProfilesTab />,
  rubricas: () => <RubricsTab />,
  bancas: () => <EventsTab />,
  grupos: () => <GroupsTab />,
  distribuicao: () => <DistributionTab />,
  avaliadores: () => <EvaluatorsTab />,
  votacao: () => <VotesTab />,
  acompanhamento: () => <MonitorTab />,
  fechamento: () => <ClosureTab />,
  relatorios: () => <ReportsTab />,
  auditoria: () => <AuditTab />,
  lixeira: () => <TrashTab />,
};

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* sem armazenamento */
  }
}

/** Área 3 — Configuração (administrador). As abas são internas a esta área. */
export function ConfiguracaoPage() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login?voltar=/configuracao" replace />;
  if (user.role !== 'admin')
    return (
      <div className="page narrow">
        <h1>Configuração</h1>
        <Alert kind="warn">Somente administradores acessam a configuração. Professores primários conduzem a sessão e o fechamento pela área Professor.</Alert>
      </div>
    );
  return <ConfigShell />;
}

function ConfigShell() {
  const ev = useLoad(() => api.get<{ events: EventData[] }>('/api/events'), []);
  const pr = useLoad(() => api.get('/api/profiles'), []);
  const us = useLoad(() => api.get('/api/users'), []);
  const [eventId, setEventIdState] = useState<number | null>(() => Number(remembered('banca.cfg.event')) || null);
  const [dayId, setDayIdState] = useState<number | null>(() => Number(remembered('banca.cfg.day')) || null);
  // A seção fica na URL (?secao=...), para links diretos e o botão Voltar do navegador.
  const [params, setParams] = useSearchParams();
  const valid = (t: string | null) => !!t && ALL_TABS.some((x) => x.id === t);
  const rawUrl = params.get('secao');
  const fromUrl = rawUrl && LEGACY_TABS[rawUrl] ? LEGACY_TABS[rawUrl] : rawUrl;
  const tab = valid(fromUrl) ? fromUrl! : valid(remembered('banca.cfg.tab')) ? remembered('banca.cfg.tab')! : 'visao';
  const setTab = (v: string) => {
    remember('banca.cfg.tab', v);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('secao', v);
        return n;
      },
      { replace: false },
    );
  };

  const events = ev.data?.events ?? [];
  const event = events.find((e) => e.id === eventId) ?? events[0] ?? null;
  useEffect(() => {
    if (event && event.id !== eventId) setEventIdState(event.id);
  }, [event, eventId]);
  const day = event?.days.find((d) => d.id === dayId) ?? event?.days[0] ?? null;
  useEffect(() => {
    if ((day?.id ?? null) !== dayId) setDayIdState(day?.id ?? null);
  }, [day, dayId]);

  if (ev.loading && !ev.data) return <Spinner />;
  if (ev.error) return <ErrorBox error={ev.error} onRetry={ev.reload} />;

  const ctx: ConfigCtxValue = {
    events,
    reloadEvents: () => ev.reload(true),
    event,
    setEventId: (id) => {
      setEventIdState(id);
      remember('banca.cfg.event', id ? String(id) : null);
    },
    dayId: day?.id ?? null,
    setDayId: (id) => {
      setDayIdState(id);
      remember('banca.cfg.day', id ? String(id) : null);
    },
    profiles: pr.data?.profiles ?? [],
    reloadProfiles: () => pr.reload(true),
    users: us.data?.users ?? [],
    reloadUsers: () => us.reload(true),
    goTo: (t) => {
      setTab(t);
      window.scrollTo({ top: 0 });
    },
  };

  return (
    <ConfigCtx.Provider value={ctx}>
      <Tabs.Root value={tab} onValueChange={setTab} orientation="vertical" className="cfg">
        <aside className="cfg-side">
          <div>
            <p className="kicker">Configuração</p>
            <div className="cfg-context" role="group" aria-label="Banca e dia em edição">
              <label>
                Banca
                <select value={event?.id ?? ''} onChange={(e) => ctx.setEventId(Number(e.target.value) || null)}>
                  {events.length === 0 && <option value="">(nenhuma)</option>}
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dia
                <select value={day?.id ?? ''} onChange={(e) => ctx.setDayId(Number(e.target.value) || null)}>
                  {(event?.days.length ?? 0) === 0 && <option value="">(nenhum)</option>}
                  {event?.days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {dayLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <nav className="cfg-nav" aria-label="Seções da configuração">
            {SECTIONS.map((sec) => (
              <div key={sec.label} className="cfg-nav-group">
                <p className="cfg-nav-label" aria-hidden="true">
                  {sec.label}
                  {sec.hint && <span className="cfg-nav-hint">{sec.hint}</span>}
                </p>
                <Tabs.List className="tab-list" aria-label={sec.label} loop={false}>
                  {sec.tabs.map((t) => (
                    <Tabs.Trigger key={t.id} value={t.id} className="tab-trigger">
                      {t.step && (
                        <span className="tab-step" aria-hidden="true">
                          {t.step}
                        </span>
                      )}
                      {t.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </div>
            ))}
          </nav>
        </aside>
        <div className="cfg-main">
          {ALL_TABS.map((t) => (
            <Tabs.Content key={t.id} value={t.id} className="tab-panel">
              <div className="panel-head">
                <p className="kicker">
                  {t.section}
                  {t.step ? ` · etapa ${t.step} de ${STEPS}` : ''}
                </p>
                <h2>{t.label}</h2>
                <p>{t.description}</p>
              </div>
              {tab === t.id && PANELS[t.id]!()}
              {tab === t.id && t.step && <StepNav current={t.step} onGo={setTab} />}
            </Tabs.Content>
          ))}
        </div>
      </Tabs.Root>
    </ConfigCtx.Provider>
  );
}

export function NeedEvent({ children }: { children: React.ReactNode }) {
  const { event } = useConfig();
  if (!event) return <Alert kind="info">Cadastre uma banca na etapa 4, “Banca e dias”.</Alert>;
  return <>{children}</>;
}

export function NeedDay({ children }: { children: React.ReactNode }) {
  const { event, dayId } = useConfig();
  if (!event) return <Alert kind="info">Cadastre uma banca na etapa 4, “Banca e dias”.</Alert>;
  if (!dayId) return <Alert kind="info">Cadastre um dia para esta banca na etapa 4, “Banca e dias”.</Alert>;
  return <>{children}</>;
}

/** Navegação entre etapas do roteiro: anterior e próxima, no fim de cada etapa. */
function StepNav({ current, onGo }: { current: number; onGo: (tab: string) => void }) {
  const prev = ALL_TABS.find((t) => t.step === current - 1);
  const next = ALL_TABS.find((t) => t.step === current + 1);
  return (
    <nav className="step-nav" aria-label="Etapas da preparação">
      {prev ? (
        <button type="button" className="btn btn-ghost" onClick={() => (onGo(prev.id), window.scrollTo({ top: 0 }))}>
          ← {prev.step}. {prev.label}
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button type="button" className="btn btn-secondary" onClick={() => (onGo(next.id), window.scrollTo({ top: 0 }))}>
          Próxima etapa: {next.step}. {next.label} →
        </button>
      )}
    </nav>
  );
}
