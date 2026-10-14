import { useState } from 'react';
import { api } from '../../lib/api.ts';
import type { DaySchedule } from '../../lib/types.ts';
import { Empty, ErrorBox, Spinner, StatusBadge, useLoad } from '../../components/ui.tsx';
import { Review } from '../../components/Review.tsx';
import { NeedDay, useConfig } from '../Configuracao.tsx';

export function ClosureTab() {
  return (
    <NeedDay>
      <ClosureInner />
    </NeedDay>
  );
}

function ClosureInner() {
  const { dayId } = useConfig();
  const sch = useLoad(() => api.get<DaySchedule>(`/api/days/${dayId}/schedule`), [dayId]);
  const [groupId, setGroupId] = useState<number | null>(null);
  if (sch.error) return <ErrorBox error={sch.error} onRetry={sch.reload} />;
  // Enquanto os dados do dia selecionado não chegam, não mostra (nem permite agir sobre) dados de outro dia.
  if (!sch.data || sch.data.day.id !== dayId) return <Spinner />;
  const started = sch.data.entries.filter((e) => e.started);
  // A seleção só vale se o grupo pertence ao dia atual (ao trocar de dia, volta ao primeiro grupo).
  const current = started.some((e) => e.groupId === groupId) ? groupId : (started[0]?.groupId ?? null);
  return (
    <div>
      <p className="small muted">
        Dia em conferência: <strong>{sch.data.day.label}</strong>
        {sch.data.day.room ? ` · ${sch.data.day.room}` : ''}
      </p>

      {started.length === 0 ? (
        <Empty>Nenhum grupo iniciou a apresentação neste dia.</Empty>
      ) : (
        <div className="split">
          <nav aria-label="Grupos para conferência" className="split-nav">
            <ul className="plain">
              {started.map((e) => (
                <li key={e.entryId}>
                  <button className={`nav-item ${current === e.groupId ? 'active' : ''}`} aria-current={current === e.groupId ? 'true' : undefined} onClick={() => setGroupId(e.groupId)}>
                    <strong>{e.code}</strong> <StatusBadge status={e.status} label={e.statusLabel} />
                    <div className="small">{e.title}</div>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="split-main">{current && <Review key={current} groupId={current} onChanged={() => void sch.reload(true)} />}</div>
        </div>
      )}
    </div>
  );
}
