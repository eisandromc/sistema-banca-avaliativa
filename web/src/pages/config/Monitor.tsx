import { useCallback } from 'react';
import { api } from '../../lib/api.ts';
import { useDayChannel } from '../../lib/realtime.ts';
import { Alert, ErrorBox, EvalStatus, Spinner, StartedCheck, StatusBadge, useLoad } from '../../components/ui.tsx';
import { NeedDay, useConfig } from '../Configuracao.tsx';
import { fmtDateTime, fmtTime } from '../../lib/format.ts';
import { ConnectionBadge } from '../Cronometro.tsx';

const EVENT_PT: Record<string, string> = {
  started: 'Iniciado',
  paused: 'Pausado',
  resumed: 'Retomado',
  advanced: 'Etapa avançada',
  stage_changed: 'Troca automática de etapa',
  time_up: 'Tempo encerrado',
  finished_early: 'Encerrado antes do prazo',
  adjusted: 'Tempos ajustados',
  restarted: 'Reiniciado',
  stopped_by_switch: 'Interrompido por troca de grupo',
};

export function MonitorTab() {
  return (
    <NeedDay>
      <MonitorInner />
    </NeedDay>
  );
}

function MonitorInner() {
  const { dayId, event } = useConfig();
  const tz = event?.timezone;
  const m = useLoad(() => api.get(`/api/days/${dayId}/monitor`), [dayId]);
  const ev = useLoad(() => api.get(`/api/days/${dayId}/timer-events`), [dayId]);
  const onSignal = useCallback(() => {
    void m.reload(true);
    void ev.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { connection } = useDayChannel(dayId, onSignal);
  if (m.loading && !m.data) return <Spinner />;
  if (m.error) return <ErrorBox error={m.error} onRetry={m.reload} />;
  return (
    <div>
      <div className="row between wrap">
        <h2>Acompanhamento dos grupos</h2>
        <ConnectionBadge connection={connection} />
      </div>
      {m.data.warnings.map((w: string, i: number) => (
        <Alert key={i} kind="warn">
          {w}
        </Alert>
      ))}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Grupo</th>
              <th scope="col">Previsto</th>
              <th scope="col">Real</th>
              <th scope="col">Iniciado</th>
              <th scope="col">Situação</th>
              <th scope="col">Fichas</th>
            </tr>
          </thead>
          <tbody>
            {m.data.entries.map((e: any) => (
              <tr key={e.entryId} className={e.isCurrent ? 'is-current' : ''}>
                <td>{e.position}</td>
                <td>
                  <strong>{e.code}</strong> · {e.className}
                  <div className="small">{e.title}</div>
                  {e.isCurrent && <span className="pill pill-ok">Grupo atual</span>}
                </td>
                <td>
                  {e.predictedStart}–{e.predictedEnd}
                  {e.overflow && <div className="warn-text small">ultrapassa o dia</div>}
                </td>
                <td>{e.startedAt ? `${fmtTime(e.startedAt, tz)}–${e.endedAt ? fmtTime(e.endedAt, tz) : '…'}` : '—'}</td>
                <td>
                  <StartedCheck started={e.started} at={e.startedAt} />
                </td>
                <td>
                  <StatusBadge status={e.status} label={e.statusLabel} />
                  {e.closureVersion && <div className="small muted">fechamento v{e.closureVersion}</div>}
                </td>
                <td>
                  <ul className="plain">
                    {e.evaluators.map((x: any) => (
                      <li key={x.userId}>
                        {x.name}: <EvalStatus status={x.status} />
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Eventos do cronômetro</h3>
      {ev.data?.events?.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Grupo</th>
                <th scope="col">Evento</th>
                <th scope="col">Decorrido</th>
                <th scope="col">Por</th>
                <th scope="col">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {ev.data.events.map((x: any) => (
                <tr key={x.id}>
                  <td>{fmtDateTime(x.at, tz)}</td>
                  <td>{x.groupCode}</td>
                  <td>{EVENT_PT[x.type] ?? x.type}</td>
                  <td>{Math.round(x.elapsedMs / 1000)} s</td>
                  <td>{x.actorName ?? 'sistema'}</td>
                  <td className="small">{x.details?.reason ?? x.details?.stage ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nenhum evento ainda.</p>
      )}
    </div>
  );
}
