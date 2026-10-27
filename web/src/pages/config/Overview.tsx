import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { ActionButton, Button, ErrorBox, Spinner, useLoad } from '../../components/ui.tsx';
import { fmtDate } from '../../lib/format.ts';
import { NeedEvent, useConfig } from '../Configuracao.tsx';

interface Check {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'todo';
  detail: string;
  tab: string;
}
interface Readiness {
  checks: Check[];
  days: Array<{
    dayId: number;
    label: string;
    date: string;
    room: string | null;
    checks: Check[];
    progress: {
      total: number;
      started: number;
      finalized: number;
      running: boolean;
    };
    displayActive: boolean;
  }>;
  summary: { ok: number; warn: number; todo: number; ready: boolean };
}

const ICON = { ok: '✓', warn: '!', todo: '×' } as const;
const STATUS_TEXT = {
  ok: 'Pronto',
  warn: 'Atenção',
  todo: 'Pendente',
} as const;

const LABELS: Array<[string, string]> = [
  ['events', 'Bancas'],
  ['days', 'Dias'],
  ['groups', 'Grupos'],
  ['teachers', 'Docentes ativos'],
  ['started', 'Apresentações iniciadas'],
  ['closed', 'Avaliações fechadas'],
];

function Checklist({ checks }: { checks: Check[] }) {
  const { goTo } = useConfig();
  return (
    <ul className="checklist">
      {checks.map((c) => (
        <li key={c.key} className={`check-item check-${c.status}`}>
          <span className="check-icon" aria-hidden="true">
            {ICON[c.status]}
          </span>
          <div>
            <div className="check-label">
              {c.label} <span className="sr-only">({STATUS_TEXT[c.status]})</span>
            </div>
            <div className="check-detail">{c.detail}</div>
          </div>
          {c.status !== 'ok' && (
            <Button variant="ghost" onClick={() => goTo(c.tab)} aria-label={`Resolver: ${c.label}`}>
              Resolver
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function OverviewTab() {
  return (
    <NeedEvent>
      <OverviewInner />
    </NeedEvent>
  );
}

function OverviewInner() {
  const { event } = useConfig();
  const stats = useLoad(() => api.get('/api/admin/overview'), []);
  const r = useLoad(() => api.get<Readiness>(`/api/events/${event!.id}/readiness`), [event!.id]);
  if (r.loading && !r.data) return <Spinner />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const data = r.data!;
  const { summary } = data;

  return (
    <div>
      <div className={`readiness-banner ${summary.ready ? 'is-ready' : 'is-pending'}`} role="status">
        <strong>{summary.ready ? '✓ Banca pronta para começar' : `${summary.todo} item(ns) pendente(s) antes de começar`}</strong>
        <span>
          {summary.ok} pronto(s) · {summary.warn} de atenção · {summary.todo} pendente(s)
        </span>
        <Button variant="ghost" onClick={() => void r.reload()} className="ml">
          Atualizar
        </Button>
      </div>

      <div className="readiness-grid">
        <section className="card" style={{ margin: 0 }} aria-labelledby="rd-banca">
          <div className="card-title">
            <h3 id="rd-banca">{event!.name}</h3>
          </div>
          <Checklist checks={data.checks} />
        </section>
        {data.days.map((d) => {
          const pct = d.progress.total ? Math.round((d.progress.finalized / d.progress.total) * 100) : 0;
          return (
            <section key={d.dayId} className="card" style={{ margin: 0 }} aria-labelledby={`rd-dia-${d.dayId}`}>
              <div className="card-title">
                <h3 id={`rd-dia-${d.dayId}`}>
                  {d.label} · {fmtDate(d.date)}
                </h3>
                <span className="row gap wrap">
                  {d.displayActive && <span className="pill pill-ok">● No telão</span>}
                  {d.progress.running && <span className="pill pill-info">Apresentação em andamento</span>}
                </span>
              </div>
              <div className="small muted">
                {d.room ?? 'Sala não definida'} · {d.progress.started} de {d.progress.total} grupo(s) apresentado(s) · {d.progress.finalized} fechado(s)
              </div>
              <div className="progress-track" role="img" aria-label={`${pct}% dos grupos com avaliação fechada`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <Checklist checks={d.checks} />
              <div className="row gap wrap" style={{ marginTop: 8 }}>
                <Link className="btn btn-ghost" to={`/professor?dia=${d.dayId}`}>
                  Abrir na área do professor
                </Link>
                <ActionButton
                  variant={d.displayActive ? 'ghost' : 'secondary'}
                  onAction={async () => {
                    await api.post(`/api/days/${d.dayId}/display`, {
                      active: !d.displayActive,
                    });
                    await r.reload(true);
                  }}
                >
                  {d.displayActive ? 'Desativar telão' : 'Ativar no telão'}
                </ActionButton>
                <Link className="btn btn-ghost" to="/cronometro">
                  Abrir telão
                </Link>
              </div>
            </section>
          );
        })}
      </div>

      {stats.data && (
        <>
          <h3 style={{ marginTop: 28 }}>Números do sistema</h3>
          <div className="stats">
            {LABELS.map(([k, label]) => (
              <div key={k} className="stat">
                <div className="stat-value">{stats.data[k]}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
