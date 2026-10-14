import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { Button, ErrorBox, Spinner, useLoad } from '../../components/ui.tsx';
import { fmtDateTime } from '../../lib/format.ts';

export function AuditTab() {
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/audit?limit=300${applied ? `&action=${encodeURIComponent(applied)}` : ''}`), [applied]);
  return (
    <div>

      <form
        className="row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(action.trim());
        }}
      >
        <label>
          Filtrar por ação (prefixo){' '}
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="ex.: closure. ou timer." />
        </label>
        <Button type="submit">Filtrar</Button>
        <Button variant="ghost" onClick={() => reload()}>
          Atualizar
        </Button>
      </form>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Quem</th>
                <th scope="col">Ação</th>
                <th scope="col">Entidade</th>
                <th scope="col">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((l: any) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.at)}</td>
                  <td>{l.actorName ?? 'sistema'}</td>
                  <td>
                    <code>{l.action}</code>
                  </td>
                  <td>
                    {l.entity} {l.entityId}
                  </td>
                  <td className="small details-cell">{l.details ? JSON.stringify(l.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
