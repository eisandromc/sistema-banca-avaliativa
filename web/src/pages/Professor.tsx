import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { countdownLeft, useDayChannel, useTimerView, type Signal } from '../lib/realtime.ts';
import type { MyDay, Workspace } from '../lib/types.ts';
import { TimerDisplay } from '../components/TimerDisplay.tsx';
import { TimerControls } from '../components/TimerControls.tsx';
import { EvaluationForm } from '../components/EvaluationForm.tsx';
import { Review } from '../components/Review.tsx';
import { ActionButton, Alert, Button, Empty, ErrorBox, EvalStatus, Modal, Spinner, StartedCheck, StatusBadge, useLoad, useToast } from '../components/ui.tsx';
import { ConnectionBadge } from './Cronometro.tsx';
import { OrderBadge, ProjectModal, namesList } from '../components/ProjectMaterials.tsx';
import { dayLabel, fmtDate, fmtTime } from '../lib/format.ts';

/** Área 2 — Professor (avaliador e, quando designado, primário). */
export function ProfessorPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const days = useLoad(() => (user ? api.get<{ days: MyDay[] }>('/api/me/days') : Promise.resolve({ days: [] })), [user?.id]);
  const dayId = Number(params.get('dia')) || null;

  useEffect(() => {
    const list = days.data?.days ?? [];
    if (!dayId && list.length === 1) setParams({ dia: String(list[0]!.id) }, { replace: true });
  }, [days.data, dayId, setParams]);

  if (!user) return <Navigate to="/login?voltar=/professor" replace />;
  if (user.role === 'viewer')
    return (
      <div className="page">
        <Alert kind="info">Sua conta é de visualização do cronômetro. Use a área Cronômetro.</Alert>
      </div>
    );
  if (days.loading) return <Spinner />;
  if (days.error) return <ErrorBox error={days.error} onRetry={days.reload} />;
  const list = days.data!.days;

  if (!dayId) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Área do professor</h1>
            <p className="muted">Escolha o dia da banca em que você vai atuar.</p>
          </div>
        </div>
        {list.length === 0 ? (
          <Empty>Você ainda não está vinculado a nenhum dia de banca. Fale com a administração.</Empty>
        ) : (
          <ul className="day-cards">
            {list.map((d) => (
              <li key={d.id}>
                <button className="day-card" onClick={() => setParams({ dia: String(d.id) })} aria-label={`${dayLabel(d)}${d.isPrimary ? ' · Primário(a)' : ''}`}>
                  <span className="day-card-event">{d.eventName}</span>
                  <span className="day-card-title">{d.label}</span>
                  <span className="day-card-meta">
                    {fmtDate(d.date)}
                    {d.startTime ? ` · ${d.startTime}–${d.endTime}` : ''}
                    {d.room ? ` · ${d.room}` : ''}
                  </span>
                  <span className="row gap wrap">
                    {d.isPrimary && <span className="pill pill-info">Conduz a banca</span>}
                    {d.isAssigned && <span className="pill">Avalia</span>}
                    {!d.isPrimary && !d.isAssigned && d.canControl && <span className="pill">Administração</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return <DayWorkspace key={dayId} dayId={dayId} onChangeDay={list.length > 1 ? () => setParams({}) : undefined} />;
}

function DayWorkspace({ dayId, onChangeDay }: { dayId: number; onChangeDay?: () => void }) {
  const toast = useToast();
  const ws = useLoad(() => api.get<Workspace>(`/api/days/${dayId}/workspace`), [dayId]);
  const reloadTimer = useRef<number | undefined>(undefined);
  const onSignal = useCallback(
    (s: Signal) => {
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void ws.reload(true), 150);
      if (s.type === 'evaluations-opened') toast.push({ kind: 'info', text: 'Apresentação iniciada: as fichas de avaliação foram liberadas.' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { live, receivedAt, connection } = useDayChannel(dayId, onSignal);
  const view = useTimerView(live, receivedAt);
  const [selectedEval, setSelectedEval] = useState<number | null>(null);
  const [reviewGroup, setReviewGroup] = useState<number | null>(null);
  const [projectOf, setProjectOf] = useState<number | null>(null);

  // Quando o grupo atual muda (ou sua ficha é aberta), volta para a ficha do grupo atual.
  const currentEvalId = ws.data?.current?.myEvaluationId ?? null;
  const currentEntryId = ws.data?.current?.entryId ?? null;
  useEffect(() => setSelectedEval(null), [currentEvalId, currentEntryId]);

  if (ws.loading && !ws.data) return <Spinner />;
  if (ws.error) return <ErrorBox error={ws.error} onRetry={ws.reload} />;
  const w = ws.data!;
  const evalId = selectedEval ?? currentEvalId;
  const viewingOther = selectedEval !== null && selectedEval !== currentEvalId;
  const selectedEntry = w.entries.find((e) => e.myEvaluationId === evalId);
  const activeTimer = live?.timer && (live.timer.status === 'running' || live.timer.status === 'paused');

  const selectGroup = async (entryId: number) => {
    await api.post(`/api/days/${dayId}/select`, { entryId });
    await ws.reload(true);
  };
  // Avaliadores aguardam o primário (antes de ele abrir a sessão, na troca de grupo ou depois do último) com a lista do dia em ordem.
  const waiting = !w.access.canControl && !(w.current?.started && w.current.status !== 'finalized') && !viewingOther;

  return (
    <div className="page wide">
      <div className="ws-head">
        <div>
          <p className="kicker">{w.event.name}</p>
          <h1>Área do professor</h1>
          <div className="ws-meta">
            <span>
              {w.day.label} · {fmtDate(w.day.date)}
            </span>
            {w.day.room && <span>{w.day.room}</span>}
            <span>Primário(a): {w.primaryName ?? 'não designado'}</span>
            {w.predictedEnd && <span>Término previsto {w.predictedEnd}</span>}
          </div>
        </div>
        <div className="row gap wrap">
          {w.access.canControl && <span className="pill pill-info">{w.access.isAdmin ? 'Administrador' : 'Você é o(a) professor(a) primário(a)'}</span>}
          <ConnectionBadge connection={connection} />
          {onChangeDay && (
            <Button variant="ghost" onClick={onChangeDay}>
              Trocar dia
            </Button>
          )}
        </div>
      </div>

      {waiting ? (
        <WaitingBoard w={w} onProject={setProjectOf} onOpenEval={setSelectedEval} />
      ) : (
      <div className="workspace">
        <div className="ws-main">
          <section className="card" aria-labelledby="grupo-atual">
            <div className="card-title">
              <h2 id="grupo-atual">Grupo atual</h2>
              {w.current && <StatusBadge status={w.current.status} label={w.current.statusLabel} />}
            </div>
            {w.current ? (
              <div className="now-card group-accent" style={{ ['--group-color' as string]: w.current.color }}>
                <div className="current-group">
                  <div className="group-code">
                    <OrderBadge position={w.current.position} color={w.current.color} large />
                    <span>
                      {w.current.code}
                      {w.current.className && ` · ${w.current.className}`}
                    </span>
                  </div>
                  <p className="group-title">{w.current.title}</p>
                  <ul className="meta-list">
                    <li>
                      <b>{w.current.advisors.length > 1 ? 'Orientadores:' : 'Orientação:'}</b> {w.current.advisors.length ? namesList(w.current.advisors) : '—'}
                    </li>
                    <li>
                      <b>Alunos:</b> {w.current.students.join('; ') || '—'}
                    </li>
                    <li>
                      <b>Hora programada:</b> {w.current.predictedStart}–{w.current.predictedEnd}
                      {w.current.startedAt && ` · início real ${fmtTime(w.current.startedAt)}`}
                    </li>
                  </ul>
                  <Button onClick={() => setProjectOf(w.current!.groupId)}>{w.current.hasMaterials ? 'Resumo e materiais do projeto' : 'Detalhes do projeto'}</Button>
                </div>
                {live && <TimerDisplay live={live} view={view} compact countdownMs={countdownLeft(live, receivedAt)} />}
              </div>
            ) : (
              <Alert kind="info">Nenhum grupo selecionado ainda{w.access.canControl ? ': escolha um no cronograma.' : '. Aguarde o professor primário.'}</Alert>
            )}
            {w.access.canControl && live && (
              <div role="group" aria-label="Condução da sessão">
                <hr className="sep" />
                <h3 className="h4" style={{ marginTop: 0 }}>
                  Condução da sessão
                </h3>
                <DisplayControl dayId={dayId} display={w.display} onChanged={() => void ws.reload(true)} />
                <TimerControls dayId={dayId} live={live} view={view} />
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="minha-ficha">
            <div className="card-title">
              <h2 id="minha-ficha">{viewingOther ? `Minha ficha — ${selectedEntry?.code ?? ''}` : 'Minha ficha do grupo atual'}</h2>
              {viewingOther && (
                <Button variant="ghost" onClick={() => setSelectedEval(null)}>
                  ← Voltar ao grupo atual
                </Button>
              )}
            </div>
            {evalId ? (
              <EvaluationForm key={evalId} evaluationId={evalId} onSubmitted={() => void ws.reload(true)} />
            ) : w.current && !w.entries.find((e) => e.entryId === w.current!.entryId)?.assignedToMe ? (
              <Empty>Você não está designado(a) para avaliar este grupo.</Empty>
            ) : (
              <Empty>A ficha será aberta automaticamente, em tempo real, quando o professor primário iniciar a apresentação.</Empty>
            )}
          </section>
        </div>

        <aside className="ws-side" aria-label="Cronograma e acompanhamento">
          {w.access.canControl && w.progress && (
            <section className="card primary-bar progress-list" aria-labelledby="fichas-grupo">
              <h2 id="fichas-grupo" className="h3">
                Fichas do grupo atual
              </h2>
              <ul>
                {w.progress.map((p) => (
                  <li key={p.userId}>
                    <span>{p.name}</span> <EvalStatus status={p.status} />
                  </li>
                ))}
              </ul>
              {w.current && w.current.started && (
                <Button variant="primary" className="btn-block" onClick={() => setReviewGroup(w.current!.groupId)}>
                  Conferir e fechar avaliação
                </Button>
              )}
            </section>
          )}
          <section className="card" aria-labelledby="cronograma">
            <h2 id="cronograma" className="h3">
              Cronograma
            </h2>
            {w.access.canControl && activeTimer && (
              <p className="small muted" role="note">
                Apresentação em andamento: encerre-a para selecionar outro grupo.
              </p>
            )}
            {w.warnings.map((x, i) => (
              <Alert key={i} kind="warn">
                {x}
              </Alert>
            ))}
            <ol className="schedule-list">
              {w.entries.map((e) => (
                <li
                  key={e.entryId}
                  className={`sched-item ${e.isCurrent ? 'is-current' : ''}`}
                  style={{ ['--group-color' as string]: e.color }}
                  aria-current={e.isCurrent ? 'true' : undefined}
                >
                  <div className="sched-head">
                    <OrderBadge position={e.position} color={e.color} />
                    <span className="sched-time" title="Hora programada">
                      <span className="sr-only">Hora programada </span>
                      {e.predictedStart}
                    </span>
                    <strong className="sched-code">{e.code}</strong>
                    <StatusBadge status={e.status} label={e.statusLabel} />
                  </div>
                  <div className="sched-title">
                    {e.className} — {e.title}
                  </div>
                  <div className="small muted">
                    Programado {e.predictedStart}–{e.predictedEnd}
                    {e.overflow && <span className="warn-text"> após o término do dia</span>}
                    {e.startedAt && ` · real ${fmtTime(e.startedAt)}${e.endedAt ? `–${fmtTime(e.endedAt)}` : ''}`}
                  </div>
                  <div className="sched-actions small">
                    <StartedCheck started={e.started} at={e.startedAt} />
                    <Button variant="ghost" onClick={() => setProjectOf(e.groupId)} aria-label={`Projeto de ${e.code}`}>
                      Projeto
                    </Button>
                    {e.assignedToMe && <EvalStatus status={e.myEvaluationStatus ?? (e.started ? 'not_opened' : null)} />}
                    {e.myEvaluationId && e.myEvaluationId !== evalId && (
                      <Button variant="ghost" onClick={() => setSelectedEval(e.myEvaluationId)}>
                        Abrir minha ficha
                      </Button>
                    )}
                    {w.access.canControl && !e.isCurrent && (
                      // Com um grupo em apresentação (inclusive pausada), a troca fica bloqueada até encerrar.
                      <Button
                        variant="ghost"
                        disabled={!!activeTimer}
                        title={activeTimer ? 'Encerre a apresentação em andamento para selecionar outro grupo.' : undefined}
                        onClick={async () => {
                          try {
                            await selectGroup(e.entryId);
                          } catch (err) {
                            toast.push({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
                          }
                        }}
                      >
                        Selecionar
                      </Button>
                    )}
                    {w.access.canControl && e.started && (
                      <Button variant="ghost" onClick={() => setReviewGroup(e.groupId)}>
                        Conferência
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      )}

      {projectOf !== null && <ProjectModal groupId={projectOf} onClose={() => setProjectOf(null)} />}
      <Modal open={reviewGroup !== null} onOpenChange={(v) => !v && setReviewGroup(null)} title="Conferir e fechar avaliação" wide>
        {reviewGroup !== null && <Review groupId={reviewGroup} onChanged={() => void ws.reload(true)} />}
      </Modal>
    </div>
  );
}

/** Telão: o primário ativa o dia; o /cronometro passa a exibi-lo sozinho (sem seleção na tela). */
function DisplayControl({ dayId, display, onChanged }: { dayId: number; display: Workspace['display']; onChanged: () => void }) {
  const toast = useToast();
  const set = async (active: boolean) => {
    await api.post(`/api/days/${dayId}/display`, { active });
    toast.push({ kind: 'success', text: active ? 'Dia ativado no telão. O grupo aparece quando a apresentação for iniciada.' : 'Telão desativado (mostra "Aguardando").' });
    onChanged();
  };
  return (
    <div className="display-control" role="group" aria-label="Telão">
      <span className="display-status">
        <strong>Telão:</strong>{' '}
        {display.active ? (
          <span className="pill pill-ok">● Exibindo este dia</span>
        ) : display.other ? (
          <span className="pill pill-warn">
            Exibindo outro dia: {display.other.eventName} · {display.other.label}
          </span>
        ) : (
          <span className="pill">Desativado — mostra "Aguardando"</span>
        )}
      </span>
      {display.active ? (
        <ActionButton variant="ghost" onAction={() => set(false)}>
          Desativar telão
        </ActionButton>
      ) : (
        <ActionButton variant="primary" onAction={() => set(true)}>
          {display.other ? 'Trazer este dia para o telão' : 'Ativar no telão'}
        </ActionButton>
      )}
      <span className="small muted">O grupo só aparece no telão quando a apresentação é iniciada; na troca de grupo, o telão mostra "Aguardando".</span>
    </div>
  );
}

/** Tela de espera do avaliador: a lista do dia em ordem de apresentação, com hora programada e acesso aos projetos. */
function WaitingBoard({ w, onProject, onOpenEval }: { w: Workspace; onProject: (groupId: number) => void; onOpenEval: (evaluationId: number) => void }) {
  const next = w.current && !w.current.started ? w.current : (w.entries.find((e) => e.status === 'waiting') ?? null);
  const allDone = w.entries.length > 0 && w.entries.every((e) => e.started);
  const drafts = w.entries.filter((e) => e.started && e.myEvaluationId && e.myEvaluationStatus === 'draft');
  return (
    <div className="waiting-board">
      {drafts.map((d) => (
        <Alert key={d.entryId} kind="warn">
          Sua ficha de <strong>{d.code}</strong> ainda não foi enviada.{' '}
          <Button variant="primary" onClick={() => onOpenEval(d.myEvaluationId!)}>
            Continuar minha ficha de {d.code}
          </Button>
        </Alert>
      ))}
      <section className="card waiting-hero" aria-live="polite">
        <span className="waiting-dot" aria-hidden="true" />
        <div>
          <h2>{allDone ? 'Todas as apresentações do dia já começaram' : 'Aguardando o professor primário'}</h2>
          <p className="muted">
            {allDone
              ? 'Você ainda pode abrir e revisar suas fichas na lista abaixo.'
              : 'Quando a próxima apresentação começar, a ficha de avaliação abre sozinha nesta tela. Enquanto isso, conheça os projetos do dia.'}
          </p>
          {next && !allDone && (
            <p className="waiting-next">
              {w.current && !w.current.started ? 'Próximo a se apresentar: ' : 'Primeiro da fila: '}
              <OrderBadge position={next.position} color={next.color} /> <strong>{next.code}</strong> — {next.title} · {next.predictedStart}
            </p>
          )}
        </div>
      </section>
      <section className="card" aria-labelledby="ordem-dia">
        <h2 id="ordem-dia" className="h3">
          Ordem de apresentação · {w.day.label}
        </h2>
        {w.entries.length === 0 ? (
          <Empty>Nenhum grupo para você avaliar neste dia.</Empty>
        ) : (
          <ol className="order-list">
            {w.entries.map((e) => (
              <li
                key={e.entryId}
                className={`order-row ${e.isCurrent ? 'is-current' : ''} ${e.status === 'finalized' ? 'is-done' : ''}`}
                style={{ ['--group-color' as string]: e.color }}
                aria-current={e.isCurrent ? 'true' : undefined}
              >
                <OrderBadge position={e.position} color={e.color} large />
                <span className="order-time" title="Hora programada">
                  <span className="sr-only">Hora programada </span>
                  {e.predictedStart}
                </span>
                <span className="order-main">
                  <strong>{e.code}</strong>
                  {e.className && <span className="muted"> · {e.className}</span>}
                  <span className="order-title">{e.title}</span>
                </span>
                <span className="order-side">
                  <StatusBadge status={e.status} label={e.statusLabel} />
                  {e.assignedToMe && e.myEvaluationStatus && <EvalStatus status={e.myEvaluationStatus} />}
                  <Button variant="ghost" onClick={() => onProject(e.groupId)} aria-label={`Projeto de ${e.code}`}>
                    Projeto
                  </Button>
                  {e.myEvaluationId && (
                    <Button variant="ghost" onClick={() => onOpenEval(e.myEvaluationId!)}>
                      Minha ficha
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
