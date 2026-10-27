import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { Alert, Button, Checkbox, Empty, ErrorBox, Field, Modal, Spinner, Struck, useLoad, useToast, ActionButton } from '../../components/ui.tsx';
import { formatScore } from '@shared/scoring.ts';
import { useConfig } from '../Configuracao.tsx';
import type { RubricTypeRow, RubricsData } from './rubricOptions.tsx';

interface CriterionForm {
  title: string;
  description: string;
  weight: number;
  required: boolean;
  commentEnabled: boolean;
  commentRequired: boolean;
}
interface VersionForm {
  title: string;
  instructions: string;
  scaleMin: number;
  scaleMax: number;
  scaleStep: number;
  normalization: 'linear' | null;
  generalCommentRequired: boolean;
  evaluatorRole: string;
  dimension: string;
  dimensionShort: string;
  feedbackLabel: string;
  sortOrder: number;
  /** Rótulos da escala, um por linha no formato "valor = rótulo". */
  scaleLabelsText: string;
  criteria: CriterionForm[];
}

function parseScaleLabels(text: string): Array<{ value: number; label: string }> {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(-?\d+(?:[.,]\d+)?)\s*[=:–-]\s*(.+)$/.exec(l);
      return m ? { value: Number(m[1]!.replace(',', '.')), label: m[2]!.trim() } : null;
    })
    .filter((x): x is { value: number; label: string } => x !== null);
}

const blank = (): VersionForm => ({
  title: '',
  instructions: '',
  scaleMin: 0,
  scaleMax: 10,
  scaleStep: 0.5,
  normalization: null,
  generalCommentRequired: false,
  evaluatorRole: '',
  dimension: '',
  dimensionShort: '',
  feedbackLabel: '',
  sortOrder: 0,
  scaleLabelsText: '',
  criteria: [
    {
      title: '',
      description: '',
      weight: 1,
      required: true,
      commentEnabled: false,
      commentRequired: false,
    },
  ],
});

type Mode =
  | { kind: 'new'; typeId: number | null; typeName: string | null }
  | { kind: 'edit'; versionId: number; templateName: string; data: VersionForm }
  | {
      kind: 'newVersion';
      fromId: number;
      templateName: string;
      data: VersionForm;
    };

const toForm = (v: any): VersionForm => ({
  title: v.title,
  instructions: v.instructions ?? '',
  scaleMin: v.scaleMin,
  scaleMax: v.scaleMax,
  scaleStep: v.scaleStep,
  normalization: v.normalization,
  generalCommentRequired: v.generalCommentRequired,
  evaluatorRole: v.evaluatorRole ?? '',
  dimension: v.dimension ?? '',
  dimensionShort: v.dimensionShort ?? '',
  feedbackLabel: v.feedbackLabel ?? '',
  sortOrder: v.sortOrder ?? 0,
  scaleLabelsText: (v.scaleLabels ?? []).map((l: any) => `${l.value} = ${l.label}`).join('\n'),
  criteria: v.criteria.map((c: any) => ({
    ...c,
    description: c.description ?? '',
  })),
});

/** Etapa 3 — tipos de rubrica: cada tipo reúne as fichas usadas juntas numa banca. */
export function RubricsTab() {
  const { event, events, goTo } = useConfig();
  const { data, error, loading, reload } = useLoad(() => api.get<RubricsData>('/api/rubrics'), []);
  const [mode, setMode] = useState<Mode | null>(null);
  const [typeEdit, setTypeEdit] = useState<null | 'new' | RubricTypeRow>(null);
  const toast = useToast();
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data!;
  const untyped = d.templates.filter((t) => t.typeId === null);
  // Tipos excluídos ficam só na Lixeira (a lista ainda os traz para exibir vínculos taxados).
  const listedTypes = d.types.filter((t) => !t.deleted);
  const eventsOf = (typeId: number) => events.filter((e) => e.rubricTypeId === typeId).map((e) => e.name);

  const moveTemplate = async (templateId: number, typeId: number | null) => {
    try {
      await api.patch(`/api/rubric-templates/${templateId}`, { typeId });
      await reload(true);
    } catch (e) {
      toast.push({ kind: 'error', text: errorMessage(e) });
    }
  };
  const swap = async (a: { id: number; typePosition: number }, b: { id: number; typePosition: number }) => {
    // Posições iguais (dados antigos) também são desfeitas: usa o índice como posição.
    const pa = a.typePosition === b.typePosition ? b.typePosition + 1 : b.typePosition;
    await api.patch(`/api/rubric-templates/${a.id}`, { typePosition: pa });
    await api.patch(`/api/rubric-templates/${b.id}`, {
      typePosition: a.typePosition,
    });
    await reload(true);
  };

  return (
    <div>
      <div className="toolbar">
        <p className="muted small toolbar-text">
          {event ? (
            <>
              A banca <strong>{event.name}</strong> usa:{' '}
              {event.rubricTypeId ? (
                <strong>
                  <Struck deleted={d.types.find((t) => t.id === event.rubricTypeId)?.deleted}>{d.types.find((t) => t.id === event.rubricTypeId)?.name}</Struck>
                </strong>
              ) : (
                <span className="warn-text">nenhum tipo ainda</span>
              )}{' '}
              <button type="button" className="link" onClick={() => goTo('bancas')}>
                (alterar em Banca e dias)
              </button>
            </>
          ) : (
            'Crie os tipos aqui e vincule um deles à banca na etapa 4.'
          )}
        </p>
        <div className="row gap wrap">
          <ActionButton
            onAction={async () => {
              await api.post('/api/templates/projeto-integrador', {
                eventId: null,
              });
              await reload(true);
              toast.push({
                kind: 'success',
                text: 'Tipo "Projeto Integrador" com as 4 rubricas disponível.',
              });
            }}
          >
            Instalar modelo Projeto Integrador
          </ActionButton>
          <Button variant="create" onClick={() => setTypeEdit('new')}>
            + Novo tipo de rubrica
          </Button>
        </div>
      </div>

      {listedTypes.length === 0 && <Empty>Nenhum tipo de rubrica ainda. Crie um tipo e adicione as rubricas (fichas) dele.</Empty>}

      {listedTypes.map((type) => {
        const list = d.templates.filter((t) => t.typeId === type.id).sort((a, b) => a.typePosition - b.typePosition || a.id - b.id);
        const used = eventsOf(type.id);
        return (
          <section key={type.id} className={`card type-card ${event?.rubricTypeId === type.id ? 'is-linked' : ''}`} aria-labelledby={`tipo-${type.id}`}>
            <div className="card-title">
              <div>
                <h3 id={`tipo-${type.id}`}>
                  {type.name}{' '}
                  {event?.rubricTypeId === type.id && <span className="pill pill-ok">usado por esta banca</span>}
                </h3>
                {type.description && <p className="muted small">{type.description}</p>}
                <p className="small muted">
                  {list.length} rubrica(s) · {used.length ? `bancas: ${used.join('; ')}` : 'nenhuma banca usa este tipo'}
                  {type.groupsUsing > 0 && ` · ${type.groupsUsing} grupo(s) com este tipo próprio`}
                </p>
              </div>
              <div className="row gap wrap">
                <Button variant="edit" onClick={() => setTypeEdit(type)}>Editar tipo</Button>
                <ActionButton
                  variant="delete"
                  onAction={async () => {
                    const inUse = type.eventsUsing + type.groupsUsing > 0;
                    if (!window.confirm(`Mover o tipo "${type.name}" para a lixeira?${inUse ? ' Ele ainda está vinculado a bancas/grupos, que o exibirão taxado.' : ''} As rubricas continuam cadastradas.`)) return;
                    await api.del(`/api/rubric-types/${type.id}`);
                    await reload(true);
                  }}
                >
                  Excluir tipo
                </ActionButton>
              </div>
            </div>
            {list.length === 0 ? (
              <Empty>Este tipo ainda não tem rubricas.</Empty>
            ) : (
              <ol className="rubric-list">
                {list.map((t, i) => (
                  <TemplateItem
                    key={t.id}
                    t={t}
                    index={i + 1}
                    types={listedTypes}
                    onEdit={setMode}
                    onMove={(typeId) => void moveTemplate(t.id, typeId)}
                    onUp={i > 0 ? () => void swap(t, list[i - 1]!) : undefined}
                    onDown={i < list.length - 1 ? () => void swap(t, list[i + 1]!) : undefined}
                    reload={() => reload(true)}
                  />
                ))}
              </ol>
            )}
            <Button variant="create" onClick={() => setMode({ kind: 'new', typeId: type.id, typeName: type.name })}>+ Nova rubrica em “{type.name}”</Button>
          </section>
        );
      })}

      {untyped.length > 0 && (
        <section className="card type-card is-untyped" aria-labelledby="sem-tipo">
          <h3 id="sem-tipo">Rubricas sem tipo</h3>
          <p className="muted small">Coloque cada rubrica em um tipo para usá-la numa banca de forma organizada.</p>
          <ol className="rubric-list">
            {untyped.map((t, i) => (
              <TemplateItem key={t.id} t={t} index={i + 1} types={listedTypes} onEdit={setMode} onMove={(typeId) => void moveTemplate(t.id, typeId)} reload={() => reload(true)} />
            ))}
          </ol>
        </section>
      )}

      {mode && <RubricDialog mode={mode} onClose={() => setMode(null)} onSaved={async () => (await reload(true), setMode(null))} />}
      {typeEdit && <TypeDialog initial={typeEdit === 'new' ? null : typeEdit} onClose={() => setTypeEdit(null)} onSaved={async () => (await reload(true), setTypeEdit(null))} />}
    </div>
  );
}

function TemplateItem({
  t,
  index,
  types,
  onEdit,
  onMove,
  onUp,
  onDown,
  reload,
}: {
  t: RubricsData['templates'][number];
  index: number;
  types: RubricTypeRow[];
  onEdit: (m: Mode) => void;
  onMove: (typeId: number | null) => void;
  onUp?: () => void;
  onDown?: () => void;
  reload: () => Promise<void>;
}) {
  const latest = t.versions[t.versions.length - 1];
  return (
    <li className="rubric-item">
      <div className="rubric-item-head">
        {t.typeId !== null && (
          <span className="rubric-pos" aria-hidden="true">
            {index}
          </span>
        )}
        <div className="rubric-item-main">
          <strong>{t.name}</strong>
          <div className="small muted">
            {latest ? `${latest.title} · v${latest.version} · ${latest.criteria.length} critério(s) · escala ${latest.scaleMin}–${latest.scaleMax}` : 'sem versões'}
            {latest?.evaluatorRole ? ` · ${latest.evaluatorRole}` : ''}
          </div>
        </div>
        <div className="row gap wrap">
          {onUp !== undefined || onDown !== undefined ? (
            <>
              <Button variant="ghost" disabled={!onUp} onClick={onUp} aria-label={`Subir ${t.name}`}>
                ↑
              </Button>
              <Button variant="ghost" disabled={!onDown} onClick={onDown} aria-label={`Descer ${t.name}`}>
                ↓
              </Button>
            </>
          ) : null}
          <select aria-label={`Tipo de ${t.name}`} value={t.typeId ?? ''} onChange={(e) => onMove(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Sem tipo</option>
            {types.map((ty) => (
              <option key={ty.id} value={ty.id}>
                Tipo: {ty.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <details className="version-list">
        <summary>Critérios e versões ({t.versions.length})</summary>
        {t.versions.map((v: any) => {
          const totalW = v.criteria.reduce((a: number, c: any) => a + c.weight, 0);
          return (
            <div key={v.id} className="version">
              <p className="version-title">
                v{v.version} — {v.title} · usada em {v.used} ficha(s){v.assigned > 0 && ` · versão vigente de ${v.assigned} atribuição(ões)`}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Critério</th>
                      <th scope="col" className="num">
                        Peso
                      </th>
                      <th scope="col" className="num">
                        Peso relativo
                      </th>
                      <th scope="col">Obrigatório</th>
                      <th scope="col">Justificativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.criteria.map((c: any) => (
                      <tr key={c.id}>
                        <td>
                          {c.title}
                          {c.description && <div className="small muted">{c.description}</div>}
                        </td>
                        <td className="num">{formatScore(c.weight)}</td>
                        <td className="num">{formatScore((c.weight / totalW) * 100)}%</td>
                        <td>{c.required ? 'Sim' : 'Não'}</td>
                        <td>{c.commentEnabled ? (c.commentRequired ? 'Obrigatória' : 'Opcional') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row gap wrap">
                {v.used === 0 && (
                  <Button
                    variant="edit"
                    onClick={() =>
                      onEdit({
                        kind: 'edit',
                        versionId: v.id,
                        templateName: t.name,
                        data: toForm(v),
                      })
                    }
                  >
                    Editar esta versão
                  </Button>
                )}
                <Button
                  variant="create"
                  onClick={() =>
                    onEdit({
                      kind: 'newVersion',
                      fromId: v.id,
                      templateName: t.name,
                      data: toForm(v),
                    })
                  }
                >
                  Criar nova versão a partir desta
                </Button>
                {/* Sem fichas abertas; atribuída, só se houver outra versão para assumir a ficha. */}
                {v.used === 0 && (v.assigned === 0 || t.versions.length > 1) && (
                  <ActionButton
                    variant="delete"
                    onAction={async () => {
                      if (!window.confirm('Mover esta versão para a lixeira?')) return;
                      await api.del(`/api/rubric-versions/${v.id}`);
                      await reload();
                    }}
                  >
                    Excluir versão
                  </ActionButton>
                )}
              </div>
            </div>
          );
        })}
      </details>
    </li>
  );
}

function TypeDialog({ initial, onClose, onSaved }: { initial: RubricTypeRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={initial ? 'Editar tipo de rubrica' : 'Novo tipo de rubrica'}
      description="O tipo reúne as rubricas (fichas) usadas juntas. Ex.: “Projeto Integrador” com as fichas Técnica, Artigo, Projeto e Apresentação."
    >
      <Field label="Nome do tipo" required>
        {(p) => <input {...p} value={name} placeholder="Ex.: Projeto Integrador — 2º ano" onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Descrição">{(p) => <textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!name.trim()}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const body = { name, description: description || null };
              if (initial) await api.put(`/api/rubric-types/${initial.id}`, body);
              else await api.post('/api/rubric-types', body);
              await onSaved();
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar tipo
        </Button>
      </div>
    </Modal>
  );
}

function RubricDialog({ mode, onClose, onSaved }: { mode: Mode; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [f, setF] = useState<VersionForm>(mode.kind === 'new' ? blank() : mode.data);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<VersionForm>) => setF((x) => ({ ...x, ...p }));
  const setC = (i: number, p: Partial<CriterionForm>) => set({ criteria: f.criteria.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const isDefault = f.scaleMin === 0 && f.scaleMax === 10;
  const totalW = f.criteria.reduce((a, c) => a + (c.weight || 0), 0);
  const valid = (mode.kind !== 'new' || name.trim()) && f.title.trim() && f.criteria.length > 0 && f.criteria.every((c) => c.title.trim() && c.weight > 0) && f.scaleMax > f.scaleMin && (isDefault || f.normalization);
  const title = mode.kind === 'new' ? (mode.typeName ? `Nova rubrica em “${mode.typeName}”` : 'Nova rubrica') : mode.kind === 'edit' ? `Editar — ${mode.templateName}` : `Nova versão — ${mode.templateName}`;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={title} wide>
      {mode.kind === 'new' && (
        <Field label="Nome da rubrica" required hint="Ex.: Avaliação técnica. Aparece na lista do tipo e na escolha do avaliador.">
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      )}
      <Field label="Título da versão" required>
        {(p) => <input {...p} value={f.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label="Responsabilidade / instruções aos avaliadores">{(p) => <textarea {...p} rows={2} value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} />}</Field>
      <div className="grid3">
        <Field label="Nota mínima">{(p) => <input {...p} type="number" step="any" value={f.scaleMin} onChange={(e) => set({ scaleMin: Number(e.target.value) })} />}</Field>
        <Field label="Nota máxima">{(p) => <input {...p} type="number" step="any" value={f.scaleMax} onChange={(e) => set({ scaleMax: Number(e.target.value) })} />}</Field>
        <Field label="Incremento">{(p) => <input {...p} type="number" step="any" min={0.01} value={f.scaleStep} onChange={(e) => set({ scaleStep: Number(e.target.value) })} />}</Field>
      </div>
      {!isDefault && (
        <Field label="Normalização (obrigatória fora da escala 0–10)" error={!f.normalization ? 'Configure a normalização explicitamente.' : null}>
          {(p) => (
            <select {...p} value={f.normalization ?? ''} onChange={(e) => set({ normalization: (e.target.value || null) as any })}>
              <option value="">(não configurada)</option>
              <option value="linear">Linear: (nota − mín) ÷ (máx − mín)</option>
            </select>
          )}
        </Field>
      )}
      <Field label="Rótulos da escala (opcional, um por linha: valor = rótulo)" hint="Com rótulos, a ficha mostra botões por nível (ex.: 0 = Não evidenciado … 5 = Plenamente desenvolvido).">
        {(p) => <textarea {...p} rows={4} value={f.scaleLabelsText} onChange={(e) => set({ scaleLabelsText: e.target.value })} />}
      </Field>
      <h4>Papel do avaliador no documento</h4>
      <div className="grid2">
        <Field label="Papel do avaliador" hint="Ex.: Professor técnico">
          {(p) => <input {...p} value={f.evaluatorRole} onChange={(e) => set({ evaluatorRole: e.target.value })} />}
        </Field>
        <Field label="Ordem no documento" hint="Avaliador 1, 2, 3…">
          {(p) => <input {...p} type="number" min={0} value={f.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) })} />}
        </Field>
        <Field label="Dimensão avaliada (capa)" hint="Ex.: Solução tecnológica">
          {(p) => <input {...p} value={f.dimension} onChange={(e) => set({ dimension: e.target.value })} />}
        </Field>
        <Field label="Dimensão (registro consolidado)" hint="Nome curto">
          {(p) => <input {...p} value={f.dimensionShort} onChange={(e) => set({ dimensionShort: e.target.value })} />}
        </Field>
        <Field label="Título da devolutiva" hint="Ex.: Devolutiva técnica">
          {(p) => <input {...p} value={f.feedbackLabel} onChange={(e) => set({ feedbackLabel: e.target.value })} />}
        </Field>
      </div>
      <Checkbox label="Devolutiva/observação geral obrigatória" checked={f.generalCommentRequired} onChange={(v) => set({ generalCommentRequired: v })} />
      <h4>Critérios (soma dos pesos: {formatScore(totalW)})</h4>
      <p className="small muted">Os pesos são normalizados no cálculo: cada critério vale peso ÷ soma dos pesos avaliados.</p>
      {f.criteria.map((c, i) => (
        <fieldset key={i} className="criterion-edit">
          <legend>Critério {i + 1}</legend>
          <div className="grid3">
            <Field label="Título" required>
              {(p) => <input {...p} value={c.title} onChange={(e) => setC(i, { title: e.target.value })} />}
            </Field>
            <Field label="Peso" required>
              {(p) => <input {...p} type="number" step="any" min={0.001} value={c.weight} onChange={(e) => setC(i, { weight: Number(e.target.value) })} />}
            </Field>
            <Field label="Peso relativo">{(p) => <output {...p}>{totalW ? formatScore((c.weight / totalW) * 100) : '—'}%</output>}</Field>
          </div>
          <Field label="Descrição">{(p) => <input {...p} value={c.description} onChange={(e) => setC(i, { description: e.target.value })} />}</Field>
          <div className="row gap wrap">
            <Checkbox label="Obrigatório" checked={c.required} onChange={(v) => setC(i, { required: v })} />
            <Checkbox
              label="Campo de justificativa"
              checked={c.commentEnabled}
              onChange={(v) =>
                setC(i, {
                  commentEnabled: v,
                  commentRequired: v && c.commentRequired,
                })
              }
            />
            {c.commentEnabled && <Checkbox label="Justificativa obrigatória" checked={c.commentRequired} onChange={(v) => setC(i, { commentRequired: v })} />}
            <Button variant="ghost" disabled={i === 0} onClick={() => set({ criteria: swap(f.criteria, i, i - 1) })} aria-label={`Subir critério ${i + 1}`}>
              ↑
            </Button>
            <Button variant="ghost" disabled={i === f.criteria.length - 1} onClick={() => set({ criteria: swap(f.criteria, i, i + 1) })} aria-label={`Descer critério ${i + 1}`}>
              ↓
            </Button>
            <Button variant="delete" className="btn-sm" disabled={f.criteria.length <= 1} onClick={() => set({ criteria: f.criteria.filter((_, j) => j !== i) })}>
              Remover
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        variant="create"
        onClick={() =>
          set({
            criteria: [
              ...f.criteria,
              {
                title: '',
                description: '',
                weight: 1,
                required: true,
                commentEnabled: false,
                commentRequired: false,
              },
            ],
          })
        }
      >
        + Critério
      </Button>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!valid}
          onClick={async () => {
            setBusy(true);
            try {
              const { scaleLabelsText, ...rest } = f;
              const body = {
                ...rest,
                instructions: f.instructions || null,
                evaluatorRole: f.evaluatorRole || null,
                dimension: f.dimension || null,
                dimensionShort: f.dimensionShort || null,
                feedbackLabel: f.feedbackLabel || null,
                scaleLabels: parseScaleLabels(scaleLabelsText),
                criteria: f.criteria.map((c) => ({
                  ...c,
                  description: c.description || null,
                })),
              };
              if (mode.kind === 'new')
                await api.post('/api/rubrics', {
                  name,
                  typeId: mode.typeId,
                  version: body,
                });
              else if (mode.kind === 'edit') await api.put(`/api/rubric-versions/${mode.versionId}`, body);
              else await api.post(`/api/rubric-versions/${mode.fromId}/new-version`, body);
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

function swap<T>(arr: T[], i: number, j: number): T[] {
  const c = [...arr];
  [c[i], c[j]] = [c[j]!, c[i]!];
  return c;
}
