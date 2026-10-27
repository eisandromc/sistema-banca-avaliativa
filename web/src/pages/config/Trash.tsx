import { api, errorMessage } from '../../lib/api.ts';
import { ActionButton, Empty, ErrorBox, Spinner, useLoad, useToast } from '../../components/ui.tsx';
import { fmtDateTime } from '../../lib/format.ts';
import { useConfig } from '../Configuracao.tsx';

interface TrashItem {
  kind: string;
  kindLabel: string;
  id: number;
  name: string;
  context: string | null;
  deletedAt: string;
  deletedBy: string | null;
}

export function TrashTab() {
  const { reloadEvents, reloadProfiles } = useConfig();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get<{ items: TrashItem[] }>('/api/trash'), []);
  const items = data?.items ?? [];

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    try {
      await fn();
      toast.push({ kind: 'success', text: okText });
    } catch (e) {
      toast.push({ kind: 'error', text: errorMessage(e) });
    }
    await reload(true);
    await Promise.all([reloadEvents(), reloadProfiles()]);
  };

  return (
    <div>
      <p className="muted">Tudo o que é excluído vem para cá e pode ser restaurado. Itens excluídos definitivamente (ou ao limpar a lixeira) deixam de aparecer e não podem ser recuperados pela plataforma.</p>
      <div className="row gap">
        <ActionButton
          variant="delete"
          disabled={items.length === 0}
          onAction={async () => {
            if (!window.confirm('Limpar a lixeira? Todos os itens serão excluídos definitivamente e não poderão ser recuperados.')) return;
            await run(() => api.del('/api/trash'), 'Lixeira limpa.');
          }}
        >
          Limpar lixeira
        </ActionButton>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Empty>A lixeira está vazia.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table trash-table">
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Nome</th>
                <th scope="col">Origem</th>
                <th scope="col">Excluído em</th>
                <th scope="col">Por</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.kind}-${i.id}`}>
                  <td>{i.kindLabel}</td>
                  <td>{i.name}</td>
                  <td>{i.context ?? '—'}</td>
                  <td>{fmtDateTime(i.deletedAt)}</td>
                  <td>{i.deletedBy ?? '—'}</td>
                  <td>
                    <div className="row gap">
                      <ActionButton onAction={() => run(() => api.post(`/api/trash/${i.kind}/${i.id}/restore`, {}), 'Item restaurado.')}>Restaurar</ActionButton>
                      <ActionButton
                        variant="delete"
                        className="btn-sm"
                        onAction={async () => {
                          if (!window.confirm(`Excluir definitivamente "${i.name}"? Não será possível recuperar.`)) return;
                          await run(() => api.del(`/api/trash/${i.kind}/${i.id}`), 'Excluído definitivamente.');
                        }}
                      >
                        Excluir definitivamente
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
