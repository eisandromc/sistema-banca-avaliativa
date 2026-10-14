import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { api } from '../../lib/api.ts';
import { ActionButton, Alert, Button, Checkbox, ConfirmDialog, Empty, Field, Modal, useToast } from '../../components/ui.tsx';
import { useConfig, type EventData } from '../Configuracao.tsx';
import { validateDayTimes } from '@shared/schedule.ts';
import { dayLabel } from '../../lib/format.ts';
import { errorMessage } from '../../lib/api.ts';
import { DEFAULT_LOCATION_FORMAT, formatLocation } from '@shared/location.ts';
import { useRubrics } from './rubricOptions.tsx';

const emptyEvent = (): Omit<EventData, 'id' | 'days'> => ({
  name: '',
  institution: '',
  period: '',
  timezone: 'America/Sao_Paulo',
  reportHeader: '',
  reportSubtitle: '',
  reportFooter: '',
  reportColor: '#1f3a5f',
  showStudentNames: false,
  publicDisplay: true,
  warnPct: 50,
  dangerPct: 20,
  editAfterSubmit: 'locked',
  votePrivacy: 'nominal',
  institutionDetail: '',
  reportPurpose: '',
  reportGuidance: '',
  schoolLocation: '',
  locationFormat: DEFAULT_LOCATION_FORMAT,
  aggregation: 'mean',
  verdictOptions: [],
  rubricTypeId: null,
  hasLogo: false,
});

/** Etapa 4 — a banca (dados, tipo de rubrica, regras, documento) e seus dias. */
export function EventsTab() {
  const { events, event, setEventId, reloadEvents, goTo } = useConfig();
  const [editing, setEditing] = useState<null | 'new' | EventData>(null);
  const [delOpen, setDelOpen] = useState(false);
  const rub = useRubrics();
  const toast = useToast();
  const typeName = event?.rubricTypeId ? rub.data?.types.find((t) => t.id === event.rubricTypeId)?.name : null;
  return (
    <div>
      <div className="toolbar">
        <p className="muted small toolbar-text">
          {events.length > 1 ? 'Troque a banca em edição no seletor “Banca”, no alto do menu.' : 'Uma banca pode acontecer em vários dias.'}
        </p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Nova banca
        </Button>
      </div>
      {events.length === 0 && <Empty>Nenhuma banca cadastrada. Comece por “+ Nova banca”.</Empty>}
      {event && (
        <>
          <section className="card step-card" aria-labelledby="banca-atual">
            <div className="card-title">
              <h3 id="banca-atual">{event.name}</h3>
              <div className="row gap wrap">
                <Button variant="primary" onClick={() => setEditing(event)}>
                  Editar banca
                </Button>
                <Button variant="danger" onClick={() => setDelOpen(true)}>
                  Excluir
                </Button>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>Tipo de rubrica</dt>
                <dd>
                  {typeName ? (
                    <button type="button" className="link" onClick={() => goTo('rubricas')}>
                      {typeName}
                    </button>
                  ) : (
                    <span className="warn-text">não definido — escolha em Editar banca</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Instituição</dt>
                <dd>{event.institution || '—'}</dd>
              </div>
              <div>
                <dt>Período</dt>
                <dd>{event.period || '—'}</dd>
              </div>
              <div>
                <dt>Resultado</dt>
                <dd>{event.aggregation === 'sum' ? 'Soma dos subtotais' : 'Média (0–100)'}</dd>
              </div>
              <div>
                <dt>Edição após envio</dt>
                <dd>{event.editAfterSubmit === 'locked' ? 'Bloqueada' : 'Até o fechamento'}</dd>
              </div>
              <div>
                <dt>Telão</dt>
                <dd>
                  {event.publicDisplay ? 'Público' : 'Só com login'} · nomes dos alunos {event.showStudentNames ? 'visíveis' : 'ocultos'}
                </dd>
              </div>
              <div>
                <dt>Local no PDF</dt>
                <dd>{formatLocation(event.locationFormat, event.days[0]?.room, event.schoolLocation) || <span className="warn-text">não definido</span>}</dd>
              </div>
              {event.verdictOptions.length > 0 && (
                <div>
                  <dt>Parecer</dt>
                  <dd>{event.verdictOptions.join(' / ')}</dd>
                </div>
              )}
            </dl>
            <details className="more">
              <summary>Modelos prontos</summary>
              <p className="small muted">
                O modelo “Projeto Integrador” instala o tipo de rubrica com as 4 fichas, vincula-o a esta banca, define o total pela soma (0–100), o parecer e os textos do
                documento. Os demais dados da banca são mantidos.
              </p>
              <ActionButton
                onAction={async () => {
                  if (!window.confirm('Aplicar o modelo "Projeto Integrador" a esta banca?')) return;
                  await api.post('/api/templates/projeto-integrador', { eventId: event.id });
                  await Promise.all([reloadEvents(), rub.reload(true)]);
                  toast.push({ kind: 'success', text: 'Modelo Projeto Integrador aplicado. Defina os avaliadores de cada dia na etapa 7.' });
                }}
              >
                Aplicar modelo Projeto Integrador
              </ActionButton>
            </details>
          </section>
          <DaysSection event={event} />
        </>
      )}
      {editing && (
        <EventDialog
          initial={editing === 'new' ? null : editing}
          types={rub.data?.types ?? []}
          onClose={() => setEditing(null)}
          onSaved={async (id) => {
            await reloadEvents();
            setEventId(id);
            setEditing(null);
          }}
        />
      )}
      {event && (
        <ConfirmDialog
          open={delOpen}
          onOpenChange={setDelOpen}
          title={`Excluir "${event.name}"?`}
          description="Remove dias, grupos e configurações da banca. Bancas com apresentações iniciadas não podem ser excluídas."
          variant="danger"
          confirmLabel="Excluir banca"
          onConfirm={async () => {
            await api.del(`/api/events/${event.id}`);
            setEventId(null);
            await reloadEvents();
          }}
        />
      )}
    </div>
  );
}

function EventDialog({
  initial,
  types,
  onClose,
  onSaved,
}: {
  initial: EventData | null;
  types: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSaved: (id: number) => Promise<void>;
}) {
  const [f, setF] = useState(() => (initial ? { ...initial } : emptyEvent()));
  const [verdictText, setVerdictText] = useState(() => (initial?.verdictOptions ?? []).join('\n'));
  const [logo, setLogo] = useState<string | null | undefined>(undefined); // undefined = sem alteração
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState('geral');
  const sampleRoom = initial?.days[0]?.room || 'Sala 201';
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial ? 'Editar banca' : 'Nova banca'} wide>
      <Tabs.Root value={tab} onValueChange={setTab} className="dialog-tabs">
        <Tabs.List className="seg" aria-label="Partes do cadastro da banca">
          <Tabs.Trigger value="geral" className="seg-btn">
            Dados gerais
          </Tabs.Trigger>
          <Tabs.Trigger value="regras" className="seg-btn">
            Regras da avaliação
          </Tabs.Trigger>
          <Tabs.Trigger value="pdf" className="seg-btn">
            Documento PDF
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="geral" className="dialog-tab">
          <div className="grid2">
            <Field label="Nome da banca" required>
              {(p) => <input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}
            </Field>
            <Field label="Tipo de rubrica" hint="O conjunto de fichas usado nesta banca. Cada grupo pode usar outro tipo, se precisar.">
              {(p) => (
                <select {...p} value={f.rubricTypeId ?? ''} onChange={(e) => set({ rubricTypeId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">(nenhum)</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Instituição">
              {(p) => <input {...p} value={f.institution ?? ''} onChange={(e) => set({ institution: e.target.value })} />}
            </Field>
            <Field label="Ano/período">
              {(p) => <input {...p} value={f.period ?? ''} onChange={(e) => set({ period: e.target.value })} />}
            </Field>
            <Field label="Fuso horário" hint="Padrão: America/Sao_Paulo">
              {(p) => <input {...p} value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} />}
            </Field>
          </div>
          <Checkbox label="Exibição pública do cronômetro (sem login, sem dados privados)" checked={f.publicDisplay} onChange={(v) => set({ publicDisplay: v })} />
          <Checkbox label="Mostrar nomes dos alunos no telão" checked={f.showStudentNames} onChange={(v) => set({ showStudentNames: v })} />
        </Tabs.Content>

        <Tabs.Content value="regras" className="dialog-tab">
          <div className="grid2">
            <Field label="Resultado da banca">
              {(p) => (
                <select {...p} value={f.aggregation} onChange={(e) => set({ aggregation: e.target.value as any })}>
                  <option value="mean">Média das avaliações normalizadas (0–100)</option>
                  <option value="sum">Soma dos subtotais dos avaliadores (ex.: 4 × 25 = 100)</option>
                </select>
              )}
            </Field>
            <Field label="Edição após envio da ficha">
              {(p) => (
                <select {...p} value={f.editAfterSubmit} onChange={(e) => set({ editAfterSubmit: e.target.value as any })}>
                  <option value="locked">Bloqueada após o envio (padrão seguro)</option>
                  <option value="until_closure">Permitida até o fechamento (exige reenvio)</option>
                </select>
              )}
            </Field>
            <Field label="Privacidade dos votos no fechamento/PDF">
              {(p) => (
                <select {...p} value={f.votePrivacy} onChange={(e) => set({ votePrivacy: e.target.value as any })}>
                  <option value="nominal">Exibir votos nominais</option>
                  <option value="anonymous">Exibir apenas contagens</option>
                </select>
              )}
            </Field>
            <Field label="Opções de parecer da banca (uma por linha)" hint="Deixe vazio para não usar parecer. Com opções, o parecer é obrigatório para fechar.">
              {(p) => <textarea {...p} rows={4} value={verdictText} onChange={(e) => setVerdictText(e.target.value)} />}
            </Field>
            <Field label="Faixa amarela a partir de (% restante da etapa)">
              {(p) => <input {...p} type="number" min={2} max={99} value={f.warnPct} onChange={(e) => set({ warnPct: Number(e.target.value) })} />}
            </Field>
            <Field label="Faixa laranja a partir de (% restante da etapa)" error={f.dangerPct >= f.warnPct ? 'Deve ser menor que o limiar amarelo.' : null}>
              {(p) => <input {...p} type="number" min={1} max={98} value={f.dangerPct} onChange={(e) => set({ dangerPct: Number(e.target.value) })} />}
            </Field>
          </div>
        </Tabs.Content>

        <Tabs.Content value="pdf" className="dialog-tab">
          <h4>Local impresso</h4>
          <div className="grid2">
            <Field label="Local da escola" hint="Ex.: Escola — Av. ..., Cidade. A sala vem do cadastro de cada dia.">
              {(p) => <input {...p} value={f.schoolLocation ?? ''} onChange={(e) => set({ schoolLocation: e.target.value })} />}
            </Field>
            <Field label="Modelo de escrita do Local" hint="Use {sala} e {escola}. Ex.: {sala} — {escola} ou {escola}, {sala}.">
              {(p) => <input {...p} value={f.locationFormat} onChange={(e) => set({ locationFormat: e.target.value })} />}
            </Field>
          </div>
          <p className="small">
            Pré-visualização: <strong>{formatLocation(f.locationFormat, sampleRoom, f.schoolLocation) || '—'}</strong>
          </p>
          <h4>Identidade institucional</h4>
          <div className="grid2">
            <Field label="Detalhe da instituição (abaixo do nome, no topo das páginas)">
              {(p) => <input {...p} placeholder="Cidade - UF" value={f.institutionDetail ?? ''} onChange={(e) => set({ institutionDetail: e.target.value })} />}
            </Field>
            <Field label="Logotipo (PNG ou JPEG, até 1,5 MB)">
              {(p) => (
                <div className="row gap wrap">
                  <input
                    {...p}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 1_500_000) {
                        setErr('Logotipo muito grande (máx. 1,5 MB).');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => setLogo(String(reader.result));
                      reader.readAsDataURL(file);
                    }}
                  />
                  {(logo || (logo === undefined && initial?.hasLogo)) && (
                    <>
                      <img className="logo-preview" alt="Logotipo atual" src={logo ?? `/api/events/${initial!.id}/logo`} />
                      <Button variant="ghost" onClick={() => setLogo(null)}>
                        Remover logotipo
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Field>
            <Field label="Título do documento">
              {(p) => <input {...p} value={f.reportHeader ?? ''} onChange={(e) => set({ reportHeader: e.target.value })} />}
            </Field>
            <Field label="Subtítulo">
              {(p) => <input {...p} value={f.reportSubtitle ?? ''} onChange={(e) => set({ reportSubtitle: e.target.value })} />}
            </Field>
            <Field label="Rodapé">
              {(p) => <input {...p} value={f.reportFooter ?? ''} onChange={(e) => set({ reportFooter: e.target.value })} />}
            </Field>
            <Field label="Cor institucional">
              {(p) => <input {...p} type="color" value={f.reportColor} onChange={(e) => set({ reportColor: e.target.value })} />}
            </Field>
          </div>
          <Field label="Finalidade da banca (capa do PDF)">
            {(p) => <textarea {...p} rows={3} value={f.reportPurpose ?? ''} onChange={(e) => set({ reportPurpose: e.target.value })} />}
          </Field>
          <Field label="Orientação aos avaliadores (capa do PDF)">
            {(p) => <textarea {...p} rows={2} value={f.reportGuidance ?? ''} onChange={(e) => set({ reportGuidance: e.target.value })} />}
          </Field>
        </Tabs.Content>
      </Tabs.Root>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!f.name.trim() || f.dangerPct >= f.warnPct}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const { days: _d, id: _i, hasLogo: _h, ...rest } = f as any;
              const body = {
                ...rest,
                verdictOptions: verdictText
                  .split('\n')
                  .map((x: string) => x.trim())
                  .filter(Boolean),
              };
              let id = initial?.id;
              if (initial) await api.put(`/api/events/${initial.id}`, body);
              else id = (await api.post('/api/events', body)).id;
              if (logo !== undefined) await api.put(`/api/events/${id}/logo`, { dataUrl: logo });
              await onSaved(id!);
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar banca
        </Button>
      </div>
    </Modal>
  );
}

type DayForm = {
  label: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  gapMinutes: number;
  defaultProfileId: number | null;
  breaks: Array<{ label: string; start: string; end: string }>;
};

function DaysSection({ event }: { event: EventData }) {
  const { profiles, users, reloadEvents, setDayId, goTo } = useConfig();
  const [editing, setEditing] = useState<null | 'new' | EventData['days'][number]>(null);
  return (
    <section className="card step-card" aria-labelledby="dias-banca">
      <div className="card-title">
        <h3 id="dias-banca">Dias da banca ({event.days.length})</h3>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Novo dia
        </Button>
      </div>
      {event.days.length === 0 ? (
        <Empty>Nenhum dia cadastrado. A banca pode acontecer em um ou mais dias.</Empty>
      ) : (
        <ul className="day-list">
          {event.days.map((d) => (
            <li key={d.id} className="day-item">
              <div className="day-item-main">
                <strong>{dayLabel(d)}</strong>
                <span className="small muted">
                  {d.startTime}–{d.endTime} · troca {d.gapMinutes} min
                  {d.breaks.length > 0 && ` · ${d.breaks.map((b) => `${b.label} ${b.start}–${b.end}`).join('; ')}`}
                </span>
                <span className="small">
                  Perfil de tempo: {profiles.find((p) => p.id === d.defaultProfileId)?.name ?? <span className="warn-text">não definido</span>} · Primário:{' '}
                  {d.primaryUserId ? (
                    users.find((u) => u.id === d.primaryUserId)?.name ?? '—'
                  ) : (
                    <button type="button" className="link warn-text" onClick={() => (setDayId(d.id), goTo('avaliadores'))}>
                      designar na etapa 7
                    </button>
                  )}
                </span>
              </div>
              <div className="row-actions">
                <Button variant="ghost" onClick={() => (setDayId(d.id), setEditing(d))} aria-label={`Editar ${dayLabel(d)}`}>
                  Editar
                </Button>
                <ActionButton
                  variant="ghost"
                  aria-label={`Excluir ${dayLabel(d)}`}
                  onAction={async () => {
                    if (!window.confirm(`Excluir o dia ${dayLabel(d)}?`)) return;
                    await api.del(`/api/days/${d.id}`);
                    await reloadEvents();
                  }}
                >
                  Excluir
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <DayDialog
          eventId={event.id}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (id) => {
            await reloadEvents();
            setDayId(id);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function DayDialog({ eventId, initial, onClose, onSaved }: { eventId: number; initial: EventData['days'][number] | null; onClose: () => void; onSaved: (id: number) => Promise<void> }) {
  const { profiles } = useConfig();
  const [f, setF] = useState<DayForm>(() =>
    initial
      ? { ...initial, room: initial.room ?? '', breaks: initial.breaks.map(({ label, start, end }) => ({ label, start, end })) }
      : { label: '', date: new Date().toISOString().slice(0, 10), startTime: '07:30', endTime: '12:30', room: '', gapMinutes: 5, defaultProfileId: profiles[0]?.id ?? null, breaks: [{ label: 'Intervalo', start: '10:00', end: '10:20' }] },
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = validateDayTimes(f.startTime, f.endTime, f.breaks);
  const set = (p: Partial<DayForm>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => setErr(null), [f]);
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={initial ? 'Editar dia' : 'Novo dia'} wide>
      <div className="grid3">
        <Field label="Identificação">
          {(p) => <input {...p} placeholder="Dia 1" value={f.label} onChange={(e) => set({ label: e.target.value })} />}
        </Field>
        <Field label="Data" required>
          {(p) => <input {...p} type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />}
        </Field>
        <Field label="Sala/local">
          {(p) => <input {...p} value={f.room} onChange={(e) => set({ room: e.target.value })} />}
        </Field>
        <Field label="Início" required>
          {(p) => <input {...p} type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />}
        </Field>
        <Field label="Encerramento" required>
          {(p) => <input {...p} type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} />}
        </Field>
        <Field label="Troca entre grupos (min)">
          {(p) => <input {...p} type="number" min={0} max={120} value={f.gapMinutes} onChange={(e) => set({ gapMinutes: Number(e.target.value) })} />}
        </Field>
        <Field label="Perfil de tempo padrão">
          {(p) => (
            <select {...p} value={f.defaultProfileId ?? ''} onChange={(e) => set({ defaultProfileId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">(nenhum)</option>
              {profiles
                .filter((x) => x.active || x.id === f.defaultProfileId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
      </div>
      <h4>Intervalos</h4>
      {f.breaks.map((b, i) => (
        <div key={i} className="row gap wrap break-row">
          <input aria-label={`Nome do intervalo ${i + 1}`} value={b.label} onChange={(e) => set({ breaks: f.breaks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <input aria-label={`Início do intervalo ${i + 1}`} type="time" value={b.start} onChange={(e) => set({ breaks: f.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
          <input aria-label={`Fim do intervalo ${i + 1}`} type="time" value={b.end} onChange={(e) => set({ breaks: f.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
          <Button variant="ghost" aria-label={`Remover intervalo ${i + 1}`} onClick={() => set({ breaks: f.breaks.filter((_, j) => j !== i) })}>
            ✕
          </Button>
        </div>
      ))}
      <Button onClick={() => set({ breaks: [...f.breaks, { label: 'Intervalo', start: '10:00', end: '10:15' }] })}>+ Intervalo</Button>
      {errors.length > 0 && (
        <Alert kind="warn">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </Alert>
      )}
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={errors.length > 0}
          onClick={async () => {
            setBusy(true);
            try {
              const body = { ...f, room: f.room || null };
              if (initial) {
                await api.put(`/api/days/${initial.id}`, body);
                await onSaved(initial.id);
              } else {
                const r = await api.post(`/api/events/${eventId}/days`, body);
                await onSaved(r.id);
              }
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar dia
        </Button>
      </div>
    </Modal>
  );
}
