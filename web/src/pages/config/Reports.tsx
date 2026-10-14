import { api } from '../../lib/api.ts';
import type { DaySchedule } from '../../lib/types.ts';
import { Empty, ErrorBox, Spinner, useLoad } from '../../components/ui.tsx';
import { NeedDay, useConfig } from '../Configuracao.tsx';

export function ReportsTab() {
  return (
    <NeedDay>
      <ReportsInner />
    </NeedDay>
  );
}

function ReportsInner() {
  const { dayId } = useConfig();
  const sch = useLoad(() => api.get<DaySchedule>(`/api/days/${dayId}/schedule`), [dayId]);
  if (sch.loading && !sch.data) return <Spinner />;
  if (sch.error) return <ErrorBox error={sch.error} onRetry={sch.reload} />;
  const closed = sch.data!.entries.filter((e) => e.closureVersion !== null);
  return (
    <div>

      <p className="muted">O PDF de cada projeto é gerado no servidor a partir do registro imutável do fechamento. O acesso é restrito a administradores e ao professor primário do dia.</p>
      {closed.length === 0 ? (
        <Empty>Nenhum projeto fechado neste dia.</Empty>
      ) : (
        <>
          <a className="btn btn-primary" href={`/api/days/${dayId}/report.pdf`} download>
            ⬇ Baixar todos os projetos fechados do dia (PDF único)
          </a>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Grupo</th>
                  <th scope="col">Título</th>
                  <th scope="col">Versão vigente</th>
                  <th scope="col">PDF</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((e) => (
                  <tr key={e.entryId}>
                    <td>{e.code}</td>
                    <td>{e.title}</td>
                    <td>v{e.closureVersion}</td>
                    <td>
                      <a href={`/api/groups/${e.groupId}/report.pdf`} download>
                        Baixar PDF de {e.code}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
