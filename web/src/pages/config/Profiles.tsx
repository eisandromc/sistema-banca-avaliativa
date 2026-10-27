import { useState } from 'react';
import type { Stage } from '@shared/timer.ts';
import { formatClock } from '@shared/timer.ts';
import { api, errorMessage } from '../../lib/api.ts';
import { ActionButton, Alert, Button, Checkbox, Field, Modal } from '../../components/ui.tsx';
import { StageEditor, stagesValid } from '../../components/StageEditor.tsx';
import { useConfig } from '../Configuracao.tsx';

export function ProfilesTab() {
  const { profiles, reloadProfiles } = useConfig();
  const [editing, setEditing] = useState<null | 'new' | (typeof profiles)[number]>(null);
  return (
    <div>
      <div className="row between wrap">
        <h2>Perfis de tempo</h2>
        <Button variant="create" onClick={() => setEditing('new')}>
          + Novo perfil
        </Button>
      </div>
      <p className="muted">
        Cada apresentação copia as etapas do perfil no momento do início: editar um perfil não altera sessões já iniciadas. Durante a sessão, use “Ajustar tempos”. Uma <strong>pausa</strong> (ex.: 30 s para preparar os
        alunos) não conta na numeração das etapas; <strong>destacar entrada</strong> faz o cronômetro pulsar antes e logo depois da troca para a etapa (segundos configurados na banca, aba Regras).
      </p>
      <div className="cards">
        {/* Perfis excluídos ficam só na Lixeira (a lista ainda os traz para exibir vínculos taxados). */}
        {profiles.filter((p) => !p.deleted).map((p) => (
          <section key={p.id} className={`card ${p.active ? '' : 'inactive'}`}>
            <div className="row between">
              <h3>{p.name}</h3>
              <span className="pill">{p.active ? 'Ativo' : 'Inativo'}</span>
            </div>
            <ol>
              {p.stages.map((s: Stage, i: number) => (
                <li key={i}>
                  <span className="swatch" style={{ background: s.color }} aria-hidden="true" /> {s.name} — {formatClock(s.durationSeconds * 1000)}
                  {s.pause && (
                    <>
                      {' '}
                      <span className="pill">pausa</span>
                    </>
                  )}
                  {s.alert && (
                    <>
                      {' '}
                      <span className="pill pill-info">destaque na entrada</span>
                    </>
                  )}
                </li>
              ))}
            </ol>
            <p>
              <strong>Total: {formatClock(p.totalSeconds * 1000)}</strong> · em uso: {p.usage}
            </p>
            <div className="row gap">
              <Button variant="edit" onClick={() => setEditing(p)}>Editar</Button>
              <ActionButton
                variant="create"
                onAction={async () => {
                  await api.post(`/api/profiles/${p.id}/duplicate`);
                  await reloadProfiles();
                }}
              >
                Duplicar
              </ActionButton>
              <ActionButton
                variant="delete"
                onAction={async () => {
                  if (!window.confirm(`Mover o perfil "${p.name}" para a lixeira?${p.usage ? ` Ele ainda é usado por ${p.usage} dia(s)/grupo(s), que o exibirão taxado.` : ''}`)) return;
                  await api.del(`/api/profiles/${p.id}`);
                  await reloadProfiles();
                }}
              >
                Excluir
              </ActionButton>
            </div>
          </section>
        ))}
      </div>
      {editing && <ProfileDialog initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => (await reloadProfiles(), setEditing(null))} />}
    </div>
  );
}

function ProfileDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: {
    id: number;
    name: string;
    active: boolean;
    stages: Stage[];
  } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [stages, setStages] = useState<Stage[]>(
    initial?.stages ?? [
      { name: 'Apresentação', durationSeconds: 600, color: '#2563eb' },
      {
        name: 'Demonstração',
        durationSeconds: 300,
        color: '#7c3aed',
        alert: true,
      },
      {
        name: 'Pausa — preparação',
        durationSeconds: 30,
        color: '#64748b',
        pause: true,
      },
      {
        name: 'Perguntas e considerações',
        durationSeconds: 300,
        color: '#0f766e',
      },
    ],
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial ? 'Editar perfil de tempo' : 'Novo perfil de tempo'} wide>
      <Field label="Nome" required>
        {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Checkbox label="Perfil ativo" checked={active} onChange={setActive} />
      <StageEditor stages={stages} onChange={setStages} />
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!name.trim() || !stagesValid(stages)}
          onClick={async () => {
            setBusy(true);
            try {
              const body = { name, active, stages };
              if (initial) await api.put(`/api/profiles/${initial.id}`, body);
              else await api.post('/api/profiles', body);
              await onSaved();
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar perfil
        </Button>
      </div>
    </Modal>
  );
}
