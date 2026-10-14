import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api.ts';
import { ActionButton, Alert, Button, Empty, ErrorBox, Field, Modal, Spinner, useLoad, useToast } from '../../components/ui.tsx';
import { NeedDay, useConfig, type EventData } from '../Configuracao.tsx';
import { ROLE_LABEL } from '../../lib/auth.tsx';
import { dayLabel } from '../../lib/format.ts';
import { RubricSelect, rubricGroups, rubricLabel, useRubrics, type RubricGroup } from './rubricOptions.tsx';

/** Etapa 1 — contas de acesso. A participação em cada dia é feita na etapa 7 (ou aqui, opcionalmente). */
export function AccountsTab() {
  const { users, reloadUsers, goTo } = useConfig();
  const [editing, setEditing] = useState<null | 'new' | (typeof users)[number]>(null);
  const [filter, setFilter] = useState<'all' | 'teacher' | 'admin' | 'viewer'>('all');
  const shown = users.filter((u) => filter === 'all' || u.role === filter);
  const count = (r: string) => users.filter((u) => u.role === r).length;
  return (
    <div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filtrar por perfil">
          {(
            [
              ['all', `Todos (${users.length})`],
              ['teacher', `Professores (${count('teacher')})`],
              ['admin', `Administradores (${count('admin')})`],
              ['viewer', `Telão (${count('viewer')})`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`seg-btn ${filter === k ? 'is-on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Nova conta
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">E-mail</th>
              <th scope="col">Perfil</th>
              <th scope="col">Dias em que atua</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>
                  {u.name}
                  {!u.active && <span className="pill pill-warn">desativada</span>}
                </td>
                <td>{u.email}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td className="small">{u.role === 'teacher' ? (u.days?.length ? u.days.map((d: any) => dayLabel(d)).join('; ') : <span className="muted">nenhum ainda</span>) : '—'}</td>
                <td className="row-actions">
                  <Button variant="ghost" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`}>
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        O <strong>professor primário</strong> e os <strong>avaliadores</strong> são definidos por dia, depois de montar a banca:{' '}
        <button type="button" className="link" onClick={() => goTo('avaliadores')}>
          etapa 7 — Primário e avaliadores
        </button>
        . Contas de telão só veem o cronômetro.
      </p>
      {editing && <UserDialog initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => (await reloadUsers(), setEditing(null))} />}
    </div>
  );
}

/** Etapa 7 — em cada dia: quem conduz (primário) e quem avalia, com qual rubrica. */
export function EvaluatorsTab() {
  return (
    <NeedDay>
      <EvaluatorsInner />
    </NeedDay>
  );
}

function EvaluatorsInner() {
  const { event, dayId, setDayId, users, goTo } = useConfig();
  const rub = useRubrics();
  const day = event!.days.find((d) => d.id === dayId)!;
  const groups = rubricGroups(rub.data, event!.rubricTypeId);
  const type = rub.data?.types.find((t) => t.id === event!.rubricTypeId) ?? null;
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const { reloadEvents } = useConfig();
  const primary = users.find((u) => u.id === day.primaryUserId) ?? null;
  return (
    <div>
      {event!.days.length > 1 && (
        <div className="seg day-seg" role="group" aria-label="Dia">
          {event!.days.map((d) => (
            <button key={d.id} type="button" className={`seg-btn ${d.id === dayId ? 'is-on' : ''}`} aria-pressed={d.id === dayId} onClick={() => setDayId(d.id)}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
      )}
      <p className="small muted">
        Tipo de rubrica da banca: {type ? <strong>{type.name}</strong> : <span className="warn-text">não definido</span>}{' '}
        <button type="button" className="link" onClick={() => goTo(type ? 'rubricas' : 'bancas')}>
          {type ? 'ver rubricas' : 'definir em Banca e dias'}
        </button>
      </p>

      <section className="card step-card">
        <div className="card-title">
          <h3>Professor primário — {dayLabel(day)}</h3>
          <Button variant={primary ? 'secondary' : 'primary'} onClick={() => setPrimaryOpen(true)}>
            {primary ? 'Alterar primário' : 'Designar primário'}
          </Button>
        </div>
        {primary ? (
          <p>
            <strong>{primary.name}</strong> conduz o tempo, ativa o telão e fecha as avaliações deste dia. Também avalia com:{' '}
            {rubricLabel(groups, day.primaryRubricVersionId) ?? <span className="warn-text">sem rubrica</span>}.
          </p>
        ) : (
          <Alert kind="warn">Nenhum primário designado: sem ele ninguém conduz o cronômetro deste dia.</Alert>
        )}
      </section>

      <Assignments key={`${day.id}-${version}`} day={day} groups={groups} onChanged={() => setVersion((v) => v + 1)} />

      {primaryOpen && (
        <PrimaryDialog
          day={day}
          groups={groups}
          onClose={() => setPrimaryOpen(false)}
          onSaved={async () => {
            await reloadEvents();
            setPrimaryOpen(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function Assignments({ day, groups, onChanged }: { day: EventData['days'][number]; groups: RubricGroup[]; onChanged: () => void }) {
  const { users, event, reloadEvents } = useConfig();
  const dayId = day.id;
  const [copyFrom, setCopyFrom] = useState('');
  const [copyPrimary, setCopyPrimary] = useState(true);
  const toast = useToast();
  const a = useLoad(() => api.get(`/api/days/${dayId}/assignments`), [dayId]);
  const sch = useLoad(() => api.get(`/api/days/${dayId}/schedule`), [dayId]);
  const [userId, setUserId] = useState('');
  const [versionId, setVersionId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState('');
  const otherDays = (event?.days ?? []).filter((d) => d.id !== dayId);
  if (a.loading && !a.data) return <Spinner />;
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  const teachers = users.filter((u) => u.role === 'teacher' && u.active);
  const rows: any[] = a.data.assignments;
  return (
    <section className="card step-card">
      <h3>Avaliadores — {dayLabel(day)}</h3>
      <p className="muted small">
        Cada avaliador recebe as fichas dos grupos do dia com a rubrica escolhida. Para um grupo de <strong>outro tipo de rubrica</strong>, ele recebe a rubrica da mesma
        posição dentro do tipo do grupo (1ª ↔ 1ª, 2ª ↔ 2ª). Uma atribuição “somente um grupo” vale só para aquele grupo.
      </p>
      {rows.length === 0 ? (
        <Empty>Nenhum avaliador neste dia ainda.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Docente</th>
                <th scope="col">Avalia</th>
                <th scope="col">Rubrica</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.userName}
                    {x.userId === day.primaryUserId && x.groupId === null && <span className="pill pill-info">primário</span>}
                  </td>
                  <td>{x.groupCode ? `Somente ${x.groupCode}` : 'Todos os grupos do dia'}</td>
                  <td>
                    <RubricSelect
                      groups={groups}
                      ariaLabel={`Rubrica de ${x.userName}`}
                      value={x.rubricVersionId}
                      onChange={async (v) => {
                        if (!v) return;
                        try {
                          await api.patch(`/api/assignments/${x.id}`, { rubricVersionId: v });
                          await a.reload(true);
                        } catch (err) {
                          toast.push({ kind: 'error', text: errorMessage(err) });
                        }
                      }}
                    />
                  </td>
                  <td className="row-actions">
                    <ActionButton
                      variant="ghost"
                      aria-label={`Remover ${x.userName}`}
                      onAction={async () => {
                        await api.del(`/api/assignments/${x.id}`);
                        await a.reload(true);
                      }}
                    >
                      Remover
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <fieldset className="inline-form">
        <legend>Adicionar avaliador</legend>
        <div className="row gap wrap align-end">
          <Field label="Docente">
            {(p) => (
              <select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Selecione…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Rubrica">{(p) => <RubricSelect id={p.id} groups={groups} value={versionId} onChange={setVersionId} />}</Field>
          <Field label="Avalia">
            {(p) => (
              <select {...p} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Todos os grupos do dia</option>
                {(sch.data?.entries ?? []).map((e: any) => (
                  <option key={e.groupId} value={e.groupId}>
                    Somente #{e.position} {e.code}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <ActionButton
            variant="primary"
            disabled={!userId || !versionId}
            onAction={async () => {
              await api.post(`/api/days/${dayId}/assignments`, { userId: Number(userId), rubricVersionId: versionId, groupId: groupId ? Number(groupId) : null });
              setUserId('');
              setGroupId('');
              await a.reload(true);
            }}
          >
            Adicionar
          </ActionButton>
        </div>
      </fieldset>
      {otherDays.length > 0 && (
        <details className="more">
          <summary>Copiar a escala de outro dia</summary>
          <div className="row gap wrap align-end">
            <Field label="Dia de origem" hint="Copia as atribuições gerais (e, se marcado, o primário). Depois ajuste livremente este dia.">
              {(p) => (
                <select {...p} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">Selecione…</option>
                  {otherDays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {dayLabel(d)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={copyPrimary} onChange={(e) => setCopyPrimary(e.target.checked)} /> Copiar também o professor primário
            </label>
            <ActionButton
              disabled={!copyFrom}
              onAction={async () => {
                const r = await api.post(`/api/days/${dayId}/assignments/copy`, { fromDayId: Number(copyFrom), includePrimary: copyPrimary });
                toast.push({ kind: 'success', text: `Escala copiada: ${r.copied} nova(s), ${r.updated} atualizada(s).` });
                setCopyFrom('');
                await reloadEvents();
                onChanged();
              }}
            >
              Copiar escala
            </ActionButton>
          </div>
        </details>
      )}
    </section>
  );
}

/** Designa o professor primário do dia: conduz o tempo e também avalia, com a rubrica escolhida. */
function PrimaryDialog({ day, groups, onClose, onSaved }: { day: EventData['days'][number]; groups: RubricGroup[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { users } = useConfig();
  const toast = useToast();
  const teachers = users.filter((u) => u.role === 'teacher' && u.active);
  const firstOption = groups[0]?.options.find((o) => o.latest)?.id ?? null;
  const [userId, setUserId] = useState<string>(day.primaryUserId ? String(day.primaryUserId) : '');
  const [versionId, setVersionId] = useState<number | null>(day.primaryRubricVersionId ?? firstOption);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (remove: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/api/days/${day.id}/primary`, {
        userId: remove ? null : Number(userId),
        rubricVersionId: remove ? null : versionId,
        reason: reason.trim() || null,
      });
      toast.push({ kind: 'success', text: remove ? 'Professor primário removido.' : 'Professor primário designado; ele também receberá as fichas de avaliação.' });
      await onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Professor primário — ${dayLabel(day)}`}
      description="O primário avalia os grupos como os demais professores e, além disso, conduz a sessão: ativa o telão, seleciona o grupo, controla o cronômetro e confere/fecha as avaliações. A troca fica registrada na auditoria."
    >
      <Field label="Docente" required>
        {(p) => (
          <select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Selecione…</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Rubrica com que ele vai avaliar" required hint="Vale para todos os grupos do dia (cria ou atualiza a atribuição dele).">
        {(p) => <RubricSelect id={p.id} groups={groups} value={versionId} onChange={setVersionId} />}
      </Field>
      <Field label="Motivo (opcional)">{(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        {day.primaryUserId && (
          <Button variant="danger" disabled={busy} onClick={() => void save(true)}>
            Remover primário
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="primary" loading={busy} disabled={!userId || !versionId} onClick={() => void save(false)}>
          Salvar
        </Button>
      </div>
    </Modal>
  );
}

interface DayChoice {
  dayId: number;
  label: string;
  date: string;
  room: string | null;
  eventName: string;
  eventTypeId: number | null;
  checked: boolean;
  rubricVersionId: number | null;
  isPrimary: boolean;
  locked: string | null;
}

function UserDialog({ initial, onClose, onSaved }: { initial: { id: number; name: string; email: string; role: string; active: boolean } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { events } = useConfig();
  const [f, setF] = useState({ name: initial?.name ?? '', email: initial?.email ?? '', role: initial?.role ?? 'teacher', active: initial?.active ?? true, password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const rub = useRubrics();
  const current = useLoad(() => (initial ? api.get(`/api/users/${initial.id}/days`) : Promise.resolve({ days: [] })), [initial?.id]);
  const [days, setDays] = useState<DayChoice[] | null>(null);

  // Lista de todos os dias de todas as bancas, marcando os que o professor já participa.
  useEffect(() => {
    if (current.loading || current.error || days) return;
    const mine = new Map<number, any>((current.data?.days ?? []).map((d: any) => [d.dayId, d]));
    setDays(
      events.flatMap((e) =>
        e.days.map((d) => {
          const m = mine.get(d.id);
          return {
            dayId: d.id,
            label: d.label,
            date: d.date,
            room: d.room,
            eventName: e.name,
            eventTypeId: e.rubricTypeId,
            checked: !!m?.assigned,
            rubricVersionId: m?.rubricVersionId ?? null,
            isPrimary: !!m?.isPrimary,
            locked: m?.isPrimary ? 'professor primário deste dia' : m?.hasEvaluations ? 'já possui fichas neste dia' : null,
          };
        }),
      ),
    );
  }, [current.loading, current.data, events, days]);

  const [daysDirty, setDaysDirty] = useState(false);
  const setDay = (id: number, p: Partial<DayChoice>) => {
    setDaysDirty(true);
    setDays((all) => (all ?? []).map((d) => (d.dayId === id ? { ...d, ...p } : d)));
  };
  const isTeacher = f.role === 'teacher';
  const missingRubric = isTeacher && (days ?? []).some((d) => d.checked && !d.rubricVersionId);
  const checkedCount = (days ?? []).filter((d) => d.checked).length;

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial ? 'Editar conta' : 'Nova conta'} wide>
      <div className="grid2">
        <Field label="Nome" required>
          {(p) => <input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label="E-mail" required>
          {(p) => <input {...p} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />}
        </Field>
        <Field label="Perfil">
          {(p) => (
            <select {...p} value={f.role} onChange={(e) => set({ role: e.target.value })}>
              <option value="teacher">Professor</option>
              <option value="admin">Administrador</option>
              <option value="viewer">Telão (só visualiza o cronômetro)</option>
            </select>
          )}
        </Field>
        <Field label={initial ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial'} required={!initial} hint="Mínimo de 8 caracteres.">
          {(p) => <input {...p} type="password" autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} />}
        </Field>
      </div>
      {initial && (
        <label className="checkbox">
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Conta ativa
        </label>
      )}

      {isTeacher && (
        <details className="more" open={checkedCount > 0 || undefined}>
          <summary>Dias em que avalia ({checkedCount}) — opcional, também pode ser feito na etapa 7</summary>
          {current.error ? (
            <Alert kind="error">
              Não foi possível carregar os dias deste professor: {errorMessage(current.error)}. A escala não será alterada ao salvar.{' '}
              <Button variant="ghost" onClick={() => void current.reload()}>
                Tentar novamente
              </Button>
            </Alert>
          ) : !days || current.loading ? (
            <Spinner />
          ) : days.length === 0 ? (
            <p className="muted">Nenhum dia de banca cadastrado ainda.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Avalia</th>
                    <th scope="col">Banca / dia</th>
                    <th scope="col">Rubrica neste dia</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.dayId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Participa em ${dayLabel(d)}`}
                          checked={d.checked}
                          disabled={!!d.locked && d.checked}
                          onChange={(e) => setDay(d.dayId, { checked: e.target.checked })}
                        />
                      </td>
                      <td>
                        {dayLabel(d)}
                        {d.locked && d.checked && <div className="small muted">Não pode ser desmarcado: {d.locked}.</div>}
                      </td>
                      <td>
                        <RubricSelect
                          groups={rubricGroups(rub.data, d.eventTypeId)}
                          ariaLabel={`Rubrica em ${dayLabel(d)}`}
                          value={d.rubricVersionId}
                          disabled={!d.checked}
                          onChange={(v) => setDay(d.dayId, { rubricVersionId: v })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {missingRubric && <p className="error-text">Escolha a rubrica de cada dia marcado.</p>}
        </details>
      )}

      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!f.name.trim() || !f.email.trim() || (!initial && f.password.length < 8) || (!!f.password && f.password.length < 8) || missingRubric}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              let id = initial?.id;
              if (initial) await api.patch(`/api/users/${initial.id}`, { name: f.name, email: f.email, role: f.role, active: f.active, password: f.password || undefined });
              else id = (await api.post('/api/users', { name: f.name, email: f.email, role: f.role, password: f.password })).id;
              // A escala só é gravada se foi lida com sucesso e alterada (nunca envia lista vazia por falha de leitura).
              if (isTeacher && days && !current.error && daysDirty) {
                await api.put(`/api/users/${id}/days`, {
                  days: days.filter((d) => d.checked && d.rubricVersionId).map((d) => ({ dayId: d.dayId, rubricVersionId: d.rubricVersionId })),
                });
              }
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
