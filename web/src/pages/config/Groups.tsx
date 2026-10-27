import { useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { ActionButton, Alert, Button, Empty, ErrorBox, Field, Modal, Spinner, Struck, useLoad } from '../../components/ui.tsx';
import { NeedEvent, useConfig } from '../Configuracao.tsx';
import { dayLabel, fmtBytes } from '../../lib/format.ts';
import { GROUP_COLORS, GROUP_FILE_MAX_BYTES, GROUP_FILE_TYPES, fileExtension, isGithubLink, isSafeLink, nextGroupColor, type GroupFileKind } from '@shared/groups.ts';
import { OrderBadge, namesList } from '../../components/ProjectMaterials.tsx';
import { useRubrics } from './rubricOptions.tsx';
import type { GroupFile } from '../../lib/types.ts';

export interface Group {
  id: number;
  code: string;
  className: string;
  title: string;
  description: string | null;
  advisor: string | null;
  advisors: string[];
  projectUrl: string | null;
  pdfUrl: string | null;
  slidesUrl: string | null;
  githubUrl: string | null;
  slidesFile: GroupFile | null;
  articleFile: GroupFile | null;
  color: string;
  rubricTypeId: number | null;
  students: string[];
  entryId: number | null;
  dayId: number | null;
  position: number | null;
  timeProfileId: number | null;
  started: boolean;
}

/** Etapa 5 — cadastro dos grupos. A colocação nos dias é a etapa 6. */
export function GroupsTab() {
  return (
    <NeedEvent>
      <GroupsInner />
    </NeedEvent>
  );
}

function GroupsInner() {
  const { event, goTo } = useConfig();
  const rub = useRubrics();
  const { data, error, loading, reload } = useLoad(() => api.get<{ groups: Group[] }>(`/api/events/${event!.id}/groups`), [event!.id]);
  const [editing, setEditing] = useState<null | 'new' | Group>(null);
  const [filter, setFilter] = useState('');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const all = data!.groups;
  const groups = all.filter((g) => `${g.code} ${g.className} ${g.title} ${g.students.join(' ')} ${g.advisors.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
  const unplaced = all.filter((g) => !g.dayId).length;
  const typeName = (id: number | null) => rub.data?.types.find((t) => t.id === id)?.name ?? null;
  return (
    <div>
      <div className="toolbar">
        <input className="search" aria-label="Filtrar grupos" placeholder="Filtrar por código, título, aluno ou orientador…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button variant="create" onClick={() => setEditing('new')}>
          + Novo grupo
        </Button>
      </div>
      {all.length > 0 && (
        <p className="small muted">
          {all.length} grupo(s)
          {unplaced > 0 && <> · {unplaced} ainda sem dia</>}. Para colocar os grupos nos dias e definir a ordem, use a{' '}
          <button type="button" className="link" onClick={() => goTo('distribuicao')}>
            etapa 6 — Distribuição nos dias
          </button>
          . Use apenas os dados necessários dos alunos.
        </p>
      )}
      {groups.length === 0 ? (
        <Empty>{all.length ? 'Nenhum grupo encontrado com esse filtro.' : 'Nenhum grupo cadastrado. Comece por “+ Novo grupo”.'}</Empty>
      ) : (
        <ul className="group-grid">
          {groups.map((g) => {
            const day = event!.days.find((d) => d.id === g.dayId);
            return (
              <li key={g.id} className="group-card" style={{ ['--group-color' as string]: g.color }}>
                <div className="group-card-head">
                  <span className="color-dot" style={{ background: g.color }} aria-hidden="true" />
                  <strong>{g.code}</strong>
                  {g.className && <span className="muted">{g.className}</span>}
                  <span className="spacer" />
                  {day ? (
                    <span className="pill">
                      {day.label || dayLabel(day)} · <OrderBadge position={g.position} color={g.color} />
                    </span>
                  ) : (
                    <span className="pill pill-warn">sem dia</span>
                  )}
                </div>
                <p className="group-card-title">{g.title}</p>
                <p className="small muted">
                  {g.advisors.length ? `Orientação: ${namesList(g.advisors)}` : 'Sem orientador informado'} · {g.students.length} aluno(s)
                </p>
                <div className="group-card-tags">
                  {g.description && <span className="tag">Resumo</span>}
                  {(g.slidesFile || g.slidesUrl) && <span className="tag">Apresentação</span>}
                  {(g.articleFile || g.pdfUrl) && <span className="tag">Artigo</span>}
                  {g.projectUrl && <span className="tag">Link</span>}
                  {g.githubUrl && <span className="tag">GitHub</span>}
                  {g.rubricTypeId && (
                    <span className="tag tag-info">
                      Rubrica: <Struck deleted={rub.data?.types.find((t) => t.id === g.rubricTypeId)?.deleted}>{typeName(g.rubricTypeId)}</Struck>
                    </span>
                  )}
                  {g.started && <span className="tag tag-ok">já se apresentou</span>}
                </div>
                <div className="row-actions">
                  <Button variant="edit" className="btn-sm" onClick={() => setEditing(g)} aria-label={`Editar ${g.code}`}>
                    Editar
                  </Button>
                  {!g.started && (
                    <ActionButton
                      variant="delete"
                      className="btn-sm"
                      aria-label={`Excluir ${g.code}`}
                      onAction={async () => {
                        if (!window.confirm(`Mover ${g.code} para a lixeira? Ele sai do cronograma e pode ser restaurado depois.`)) return;
                        await api.del(`/api/groups/${g.id}`);
                        await reload(true);
                      }}
                    >
                      Excluir
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <GroupDialog
          eventId={event!.id}
          eventTypeName={typeName(event!.rubricTypeId)}
          types={rub.data?.types ?? []}
          usedColors={all.map((g) => g.color)}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => (await reload(true), setEditing(null))}
        />
      )}
    </div>
  );
}

const linkError = (v: string, allowLocal = true) => (v.trim() && !isSafeLink(v.trim(), allowLocal) ? 'Use um link começando com https://' : null);
const githubError = (v: string) => (v.trim() && !isGithubLink(v.trim()) ? 'Use um link do GitHub (https://github.com/…)' : null);

const FILE_LABEL: Record<GroupFileKind, string> = {
  slides: 'a apresentação',
  article: 'o artigo',
};

/** Arquivo novo escolhido (File), remoção marcada (null) ou sem alteração (undefined). Só vai ao servidor ao salvar. */
type PendingFile = File | null | undefined;

/** Escolha do arquivo de slides ou do artigo, com o arquivo atual, troca e remoção. */
function FileSlot({ kind, label, current, pending, onChange }: { kind: GroupFileKind; label: string; current: GroupFile | null; pending: PendingFile; onChange: (p: PendingFile) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const exts = Object.keys(GROUP_FILE_TYPES[kind]);
  const extList = exts.map((e) => e.toUpperCase()).join(', ');
  const shown = pending === undefined ? current : null;
  return (
    <Field label={label} hint={`${extList}, até ${GROUP_FILE_MAX_BYTES / 1024 / 1024} MB. PDF abre dentro do sistema; os demais ficam para baixar.`} error={err}>
      {(p) => (
        <div className="file-slot">
          {pending ? (
            <p className="file-slot-name">
              <strong>{pending.name}</strong> <span className="muted">· {fmtBytes(pending.size)} · será enviado ao salvar</span>
            </p>
          ) : shown ? (
            <p className="file-slot-name">
              <a href={shown.url} target="_blank" rel="noopener noreferrer">
                {shown.name}
              </a>{' '}
              <span className="muted">· {fmtBytes(shown.size)}</span>
            </p>
          ) : pending === null && current ? (
            <p className="file-slot-name muted">O arquivo atual será removido ao salvar.</p>
          ) : null}
          <div className="row gap wrap">
            <input
              {...p}
              type="file"
              accept={exts.map((e) => `.${e}`).join(',')}
              aria-label={shown || pending ? `Trocar arquivo: ${label}` : `Enviar arquivo: ${label}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (!exts.includes(fileExtension(file.name))) return setErr(`Envie um arquivo ${extList}.`);
                if (file.size > GROUP_FILE_MAX_BYTES) return setErr(`Arquivo muito grande (máx. ${GROUP_FILE_MAX_BYTES / 1024 / 1024} MB).`);
                setErr(null);
                onChange(file);
              }}
            />
            {pending !== undefined ? (
              <Button variant="ghost" onClick={() => onChange(undefined)}>
                Desfazer
              </Button>
            ) : (
              current && (
                <Button variant="delete" className="btn-sm" onClick={() => onChange(null)}>
                  Remover arquivo
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </Field>
  );
}

function GroupDialog({
  eventId,
  eventTypeName,
  types,
  usedColors,
  initial,
  onClose,
  onSaved,
}: {
  eventId: number;
  eventTypeName: string | null;
  types: Array<{ id: number; name: string; deleted?: boolean }>;
  usedColors: string[];
  initial: Group | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState({
    code: initial?.code ?? '',
    className: initial?.className ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    advisors: initial?.advisors.length ? initial.advisors : [''],
    students: (initial?.students ?? []).join('\n'),
    projectUrl: initial?.projectUrl ?? '',
    pdfUrl: initial?.pdfUrl ?? '',
    slidesUrl: initial?.slidesUrl ?? '',
    githubUrl: initial?.githubUrl ?? '',
    // Cor gerada no cadastro: a menos usada da banca. Pode ser trocada.
    color: initial?.color ?? nextGroupColor(usedColors),
    rubricTypeId: initial?.rubricTypeId ?? null,
  });
  // Arquivos já gravados e escolhas ainda não enviadas. `savedId`: o grupo novo já criado, se o envio de um arquivo falhar.
  const [files, setFiles] = useState<Record<GroupFileKind, GroupFile | null>>({
    slides: initial?.slidesFile ?? null,
    article: initial?.articleFile ?? null,
  });
  const [pending, setPending] = useState<Record<GroupFileKind, PendingFile>>({
    slides: undefined,
    article: undefined,
  });
  const [savedId, setSavedId] = useState<number | null>(initial?.id ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const students = f.students
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const advisors = f.advisors.map((a) => a.trim()).filter(Boolean);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const linkErrors = [linkError(f.projectUrl, false), linkError(f.pdfUrl), linkError(f.slidesUrl), githubError(f.githubUrl)];
  const valid = f.code.trim() && f.title.trim() && students.length > 0 && linkErrors.every((e) => !e);
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial ? `Editar ${initial.code}` : 'Novo grupo'} wide>
      <div className="group-preview" style={{ ['--group-color' as string]: f.color }}>
        <OrderBadge position={initial?.position ?? null} color={f.color} large />
        <div>
          <strong>{f.code || 'Código do grupo'}</strong>
          {f.className && <span className="muted"> · {f.className}</span>}
          <div className="group-preview-title">{f.title || 'Título do projeto'}</div>
        </div>
      </div>

      <fieldset className="form-section">
        <legend>Identificação</legend>
        <div className="grid3">
          <Field label="Número/código" required>
            {(p) => <input {...p} value={f.code} placeholder="Grupo 03" onChange={(e) => set({ code: e.target.value })} />}
          </Field>
          <Field label="Turma">{(p) => <input {...p} value={f.className} placeholder="3º A" onChange={(e) => set({ className: e.target.value })} />}</Field>
          <Field label="Tipo de rubrica" hint="Normalmente, o da banca.">
            {(p) => (
              <select
                {...p}
                value={f.rubricTypeId ?? ''}
                onChange={(e) =>
                  set({
                    rubricTypeId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Padrão da banca{eventTypeName ? ` (${eventTypeName})` : ''}</option>
                {types
                  .filter((t) => !t.deleted || t.id === f.rubricTypeId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.deleted ? ' (excluído)' : ''}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </div>
        <div className="field">
          <span className="label" id="cor-label">
            Cor de identificação
          </span>
          <div className="swatches" role="radiogroup" aria-labelledby="cor-label">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={f.color.toLowerCase() === c}
                aria-label={`Cor ${c}`}
                className={`color-swatch ${f.color.toLowerCase() === c ? 'is-on' : ''}`}
                style={{ background: c }}
                onClick={() => set({ color: c })}
              />
            ))}
            <label className="swatch-custom">
              <input type="color" value={f.color} onChange={(e) => set({ color: e.target.value })} aria-label="Outra cor" />
              Outra
            </label>
          </div>
          <div className="hint">Aparece no grupo em destaque e no número de ordem (#) da área do professor e do telão.</div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Projeto</legend>
        <Field label="Título do projeto" required>
          {(p) => <input {...p} value={f.title} onChange={(e) => set({ title: e.target.value })} />}
        </Field>
        <Field label="Resumo do projeto" hint={`${f.description.length}/4000 caracteres. Os avaliadores leem antes e durante a apresentação.`}>
          {(p) => <textarea {...p} rows={5} maxLength={4000} value={f.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
      </fieldset>

      <fieldset className="form-section">
        <legend>Pessoas</legend>
        <div className="grid2">
          <Field label="Alunos (um por linha)" required hint={`${students.length} aluno(s)`}>
            {(p) => <textarea {...p} rows={5} value={f.students} onChange={(e) => set({ students: e.target.value })} />}
          </Field>
          <div className="field">
            <span className="label">Professores orientadores</span>
            {f.advisors.map((a, i) => (
              <div key={i} className="row gap">
                <input
                  aria-label={`Orientador ${i + 1}`}
                  value={a}
                  placeholder={i === 0 ? 'Nome do(a) orientador(a)' : 'Coorientador(a)'}
                  onChange={(e) =>
                    set({
                      advisors: f.advisors.map((x, j) => (j === i ? e.target.value : x)),
                    })
                  }
                />
                {f.advisors.length > 1 && (
                  <Button variant="delete" className="btn-sm" aria-label={`Remover orientador ${i + 1}`} onClick={() => set({ advisors: f.advisors.filter((_, j) => j !== i) })}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
            {f.advisors.length < 6 && (
              <Button variant="create" className="btn-sm" onClick={() => set({ advisors: [...f.advisors, ''] })}>
                + Orientador
              </Button>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Materiais</legend>
        <p className="small muted">
          Envie os arquivos dos slides e do artigo ou, se preferir, cole os links de compartilhamento (Google Drive, Google Apresentações, Canva, OneDrive…) com acesso “qualquer pessoa com o link pode ver”. Os
          professores abrem os PDFs dentro do sistema.
        </p>
        <div className="grid2">
          <div className="material-input">
            <FileSlot kind="slides" label="Arquivo da apresentação (slides)" current={files.slides} pending={pending.slides} onChange={(v) => setPending((x) => ({ ...x, slides: v }))} />
            <Field label="ou link da apresentação" error={linkErrors[2]}>
              {(p) => <input {...p} type="url" inputMode="url" placeholder="https://docs.google.com/presentation/…" value={f.slidesUrl} onChange={(e) => set({ slidesUrl: e.target.value })} />}
            </Field>
          </div>
          <div className="material-input">
            <FileSlot kind="article" label="Arquivo do artigo" current={files.article} pending={pending.article} onChange={(v) => setPending((x) => ({ ...x, article: v }))} />
            <Field label="ou link do artigo (PDF)" error={linkErrors[1]}>
              {(p) => <input {...p} type="url" inputMode="url" placeholder="https://drive.google.com/file/…" value={f.pdfUrl} onChange={(e) => set({ pdfUrl: e.target.value })} />}
            </Field>
          </div>
          <Field label="Link de acesso ao projeto" hint="Site, aplicativo, vídeo ou protótipo." error={linkErrors[0]}>
            {(p) => <input {...p} type="url" inputMode="url" placeholder="https://…" value={f.projectUrl} onChange={(e) => set({ projectUrl: e.target.value })} />}
          </Field>
          <Field label="Repositório no GitHub" hint="Código-fonte do projeto." error={linkErrors[3]}>
            {(p) => <input {...p} type="url" inputMode="url" placeholder="https://github.com/usuario/projeto" value={f.githubUrl} onChange={(e) => set({ githubUrl: e.target.value })} />}
          </Field>
        </div>
      </fieldset>

      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!valid}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const body = {
                code: f.code,
                className: f.className,
                title: f.title,
                description: f.description.trim() || null,
                advisors,
                students,
                projectUrl: f.projectUrl.trim() || null,
                pdfUrl: f.pdfUrl.trim() || null,
                slidesUrl: f.slidesUrl.trim() || null,
                githubUrl: f.githubUrl.trim() || null,
                color: f.color,
                rubricTypeId: f.rubricTypeId,
              };
              let id = savedId;
              if (id) await api.put(`/api/groups/${id}`, body);
              else {
                id = (await api.post<{ id: number }>(`/api/events/${eventId}/groups`, body)).id;
                setSavedId(id);
              }
              for (const kind of ['slides', 'article'] as const) {
                const file = pending[kind];
                if (file === undefined) continue;
                try {
                  if (file) {
                    const r = await api.upload<{ file: GroupFile }>(`/api/groups/${id}/files/${kind}`, file);
                    setFiles((x) => ({ ...x, [kind]: r.file }));
                  } else {
                    await api.del(`/api/groups/${id}/files/${kind}`);
                    setFiles((x) => ({ ...x, [kind]: null }));
                  }
                  setPending((x) => ({ ...x, [kind]: undefined }));
                } catch (e) {
                  throw new Error(`Os dados do grupo foram salvos, mas não foi possível enviar ${FILE_LABEL[kind]}: ${errorMessage(e)}`);
                }
              }
              await onSaved();
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar grupo
        </Button>
      </div>
    </Modal>
  );
}
