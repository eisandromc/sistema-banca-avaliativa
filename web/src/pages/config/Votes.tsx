import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { ActionButton, Alert, Button, Checkbox, Empty, ErrorBox, Field, Modal, Spinner, useLoad } from '../../components/ui.tsx';
import { NeedEvent, useConfig } from '../Configuracao.tsx';
import { VOTE_RULE_LABEL, type VoteRule } from '@shared/votes.ts';

interface Q {
  id?: number;
  title: string;
  prompt: string;
  enabled: boolean;
  required: boolean;
  allowAbstain: boolean;
  rule: VoteRule;
  quorumMin: number | null;
  position: number;
  votes?: number;
  options: Array<{ label: string; isAbstain: boolean }>;
}

const PRESETS: Record<string, Q['options']> = {
  'Aprovar / Não aprovar / Abster-se': [
    { label: 'Aprovar', isAbstain: false },
    { label: 'Não aprovar', isAbstain: false },
    { label: 'Abster-se', isAbstain: true },
  ],
  'Indicar / Não indicar': [
    { label: 'Indicar', isAbstain: false },
    { label: 'Não indicar', isAbstain: false },
  ],
};

export function VotesTab() {
  return (
    <NeedEvent>
      <VotesInner />
    </NeedEvent>
  );
}

function VotesInner() {
  const { event } = useConfig();
  const { data, error, loading, reload } = useLoad(() => api.get<{ questions: Q[] }>(`/api/events/${event!.id}/vote-questions`), [event!.id]);
  const [editing, setEditing] = useState<Q | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div>
      <div className="row between wrap">
        <h2>Votação</h2>
        <Button
          variant="create"
          onClick={() =>
            setEditing({
              title: '',
              prompt: '',
              enabled: true,
              required: true,
              allowAbstain: true,
              rule: 'simple_majority',
              quorumMin: null,
              position: data!.questions.length,
              options: PRESETS['Aprovar / Não aprovar / Abster-se']!,
            })
          }
        >
          + Nova pergunta
        </Button>
      </div>
      <p className="muted">
        A votação é opcional e independente das notas: abre junto com a ficha ao iniciar o cronômetro, cada docente vota uma vez por pergunta e grupo, e a apuração aparece separada no fechamento e no PDF. Nenhuma decisão
        é inferida a partir da média.
      </p>
      {data!.questions.length === 0 ? (
        <Empty>Nenhuma pergunta configurada — a votação está desabilitada para esta banca.</Empty>
      ) : (
        data!.questions.map((q) => (
          <section key={q.id} className={`card ${q.enabled ? '' : 'inactive'}`}>
            <div className="row between wrap">
              <h3>
                {q.title} <span className="pill">{q.enabled ? 'Habilitada' : 'Desabilitada'}</span>
              </h3>
              <div className="row gap">
                <Button variant="edit" onClick={() => setEditing(q)}>Editar</Button>
                {q.votes === 0 && (
                  <ActionButton
                    variant="delete"
                    onAction={async () => {
                      if (!window.confirm('Mover a pergunta para a lixeira?')) return;
                      await api.del(`/api/vote-questions/${q.id}`);
                      await reload(true);
                    }}
                  >
                    Excluir
                  </ActionButton>
                )}
              </div>
            </div>
            <p>{q.prompt}</p>
            <p className="small muted">
              Opções: {q.options.map((o) => o.label + (o.isAbstain ? ' (abstenção)' : '')).join(' / ')} · {q.required ? 'obrigatória' : 'opcional'} · {VOTE_RULE_LABEL[q.rule]}
              {q.rule === 'quorum' ? ` (mín. ${q.quorumMin})` : ''} · {q.votes} voto(s) registrado(s)
            </p>
          </section>
        ))
      )}
      {editing && <QuestionDialog eventId={event!.id} initial={editing} onClose={() => setEditing(null)} onSaved={async () => (await reload(true), setEditing(null))} />}
    </div>
  );
}

function QuestionDialog({ eventId, initial, onClose, onSaved }: { eventId: number; initial: Q; onClose: () => void; onSaved: () => Promise<void> }) {
  const [q, setQ] = useState<Q>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Q>) => setQ((x) => ({ ...x, ...p }));
  const locked = (initial.votes ?? 0) > 0;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial.id ? 'Editar pergunta' : 'Nova pergunta de votação'} wide>
      <Field label="Título da decisão" required>
        {(p) => <input {...p} value={q.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label="Pergunta" required>
        {(p) => <input {...p} value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} />}
      </Field>
      <div className="row gap wrap">
        <Checkbox label="Habilitada" checked={q.enabled} onChange={(v) => set({ enabled: v })} />
        <Checkbox label="Voto obrigatório para enviar a ficha" checked={q.required} onChange={(v) => set({ required: v })} />
        <Checkbox
          label="Permitir abstenção"
          checked={q.allowAbstain}
          onChange={(v) =>
            set({
              allowAbstain: v,
              options: v ? q.options : q.options.filter((o) => !o.isAbstain),
            })
          }
        />
      </div>
      <div className="grid2">
        <Field label="Regra de apuração">
          {(p) => (
            <select {...p} value={q.rule} onChange={(e) => set({ rule: e.target.value as VoteRule })}>
              {Object.entries(VOTE_RULE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        {q.rule === 'quorum' && (
          <Field label="Quórum mínimo (votos válidos)" required>
            {(p) => (
              <input
                {...p}
                type="number"
                min={1}
                value={q.quorumMin ?? ''}
                onChange={(e) =>
                  set({
                    quorumMin: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            )}
          </Field>
        )}
      </div>
      <h4>Opções {locked && <span className="muted small">(bloqueadas: já há votos)</span>}</h4>
      {!locked && (
        <div className="row gap wrap">
          <span className="muted small">Modelos:</span>
          {Object.entries(PRESETS).map(([name, opts]) => (
            <Button
              key={name}
              variant="ghost"
              onClick={() =>
                set({
                  options: opts,
                  allowAbstain: opts.some((o) => o.isAbstain) || q.allowAbstain,
                })
              }
            >
              {name}
            </Button>
          ))}
        </div>
      )}
      {q.options.map((o, i) => (
        <div key={i} className="row gap wrap">
          <input
            aria-label={`Opção ${i + 1}`}
            value={o.label}
            disabled={locked}
            onChange={(e) =>
              set({
                options: q.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
              })
            }
          />
          {q.allowAbstain && (
            <Checkbox
              label="É abstenção"
              checked={o.isAbstain}
              onChange={(v) =>
                !locked &&
                set({
                  options: q.options.map((x, j) => (j === i ? { ...x, isAbstain: v } : x)),
                })
              }
            />
          )}
          {!locked && (
            <Button variant="delete" className="btn-sm" aria-label={`Remover opção ${i + 1}`} onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}>
              ✕
            </Button>
          )}
        </div>
      ))}
      {!locked && <Button variant="create" onClick={() => set({ options: [...q.options, { label: '', isAbstain: false }] })}>+ Opção</Button>}
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!q.title.trim() || !q.prompt.trim() || q.options.filter((o) => !o.isAbstain && o.label.trim()).length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              const body = {
                ...q,
                options: q.options.filter((o) => o.label.trim()),
              };
              if (initial.id) await api.put(`/api/vote-questions/${initial.id}`, body);
              else await api.post(`/api/events/${eventId}/vote-questions`, body);
              await onSaved();
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar
        </Button>
      </div>
    </Modal>
  );
}
