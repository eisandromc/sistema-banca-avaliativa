import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, errorMessage } from '../../lib/api.ts';
import type { DaySchedule } from '../../lib/types.ts';
import { Button, Empty, ErrorBox, Spinner, useLoad, useToast } from '../../components/ui.tsx';
import { NeedEvent, useConfig, type EventData } from '../Configuracao.tsx';
import { dayLabel } from '../../lib/format.ts';
import { OrderBadge } from '../../components/ProjectMaterials.tsx';
import { ScheduleTab } from './Schedule.tsx';
import type { Group } from './Groups.tsx';

/** Etapa 6 — distribuição dos grupos nos dias (arrastar e soltar) e horários de cada dia. */
export function DistributionTab() {
  const [view, setView] = useState<'quadro' | 'horarios'>('quadro');
  return (
    <NeedEvent>
      <div className="seg" role="group" aria-label="Visualização">
        <button type="button" className={`seg-btn ${view === 'quadro' ? 'is-on' : ''}`} aria-pressed={view === 'quadro'} onClick={() => setView('quadro')}>
          Quadro dos dias
        </button>
        <button type="button" className={`seg-btn ${view === 'horarios' ? 'is-on' : ''}`} aria-pressed={view === 'horarios'} onClick={() => setView('horarios')}>
          Horários e perfis do dia
        </button>
      </div>
      {view === 'quadro' ? <Board /> : <ScheduleTab />}
    </NeedEvent>
  );
}

type ColKey = number | 'none';
const colId = (k: ColKey) => `col-${k}`;
const cardId = (groupId: number) => `g-${groupId}`;

function Board() {
  const { event } = useConfig();
  const toast = useToast();
  const ev = event!;
  const groups = useLoad(() => api.get<{ groups: Group[] }>(`/api/events/${ev.id}/groups`), [ev.id]);
  const schedules = useLoad(
    () => Promise.all(ev.days.map((d) => api.get<DaySchedule>(`/api/days/${d.id}/schedule`))),
    [ev.id, ev.days.map((d) => d.id).join(',')],
  );
  // Ordem local (otimista) de cada coluna: lista de ids de grupo.
  const [cols, setCols] = useState<Map<ColKey, number[]>>(new Map());
  const [dragging, setDragging] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<ColKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!groups.data) return;
    const m = new Map<ColKey, number[]>([['none', []]]);
    for (const d of ev.days) m.set(d.id, []);
    const sorted = [...groups.data.groups].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
    for (const g of sorted) (m.get(g.dayId ?? 'none') ?? m.get('none')!).push(g.id);
    setCols(m);
  }, [groups.data, ev.days]);

  const byId = useMemo(() => new Map((groups.data?.groups ?? []).map((g) => [g.id, g])), [groups.data]);
  const predicted = useMemo(() => {
    const m = new Map<number, { start: string | null; overflow: boolean }>();
    for (const s of schedules.data ?? []) for (const e of s.entries) m.set(e.groupId, { start: e.predictedStart, overflow: e.overflow });
    return m;
  }, [schedules.data]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if ((groups.loading && !groups.data) || cols.size === 0) return groups.error ? <ErrorBox error={groups.error} onRetry={groups.reload} /> : <Spinner />;
  if (groups.error) return <ErrorBox error={groups.error} onRetry={groups.reload} />;

  const columnOf = (id: string | number): ColKey | null => {
    const s = String(id);
    if (s.startsWith('col-')) {
      const k = s.slice(4);
      return k === 'none' ? 'none' : Number(k);
    }
    const gid = Number(s.slice(2));
    for (const [k, list] of cols) if (list.includes(gid)) return k;
    return null;
  };

  const place = async (groupId: number, to: ColKey, index: number) => {
    const from = columnOf(cardId(groupId));
    if (from === null) return;
    const g = byId.get(groupId)!;
    if (g.started && from !== to) {
      toast.push({ kind: 'error', text: `${g.code} já se apresentou: não pode mudar de dia.` });
      return;
    }
    // Atualização otimista; o servidor confirma e o quadro recarrega.
    const next = new Map(cols);
    const src = [...(next.get(from) ?? [])].filter((x) => x !== groupId);
    next.set(from, src);
    const dst = from === to ? src : [...(next.get(to) ?? [])];
    dst.splice(Math.min(index, dst.length), 0, groupId);
    next.set(to, dst);
    setCols(next);
    setBusy(true);
    try {
      await api.post(`/api/groups/${groupId}/place`, to === 'none' ? { dayId: null } : { dayId: to, position: dst.indexOf(groupId) + 1 });
    } catch (e) {
      toast.push({ kind: 'error', text: errorMessage(e) });
    } finally {
      await Promise.all([groups.reload(true), schedules.reload(true)]);
      setBusy(false);
    }
  };

  const onDragStart = (e: DragStartEvent) => setDragging(Number(String(e.active.id).slice(2)));
  const onDragOver = (e: DragOverEvent) => setOverCol(e.over ? columnOf(e.over.id) : null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    setOverCol(null);
    if (!e.over) return;
    const gid = Number(String(e.active.id).slice(2));
    const to = columnOf(e.over.id);
    if (to === null) return;
    const list = cols.get(to) ?? [];
    const overId = String(e.over.id);
    const index = overId.startsWith('col-') ? list.length : list.indexOf(Number(overId.slice(2)));
    const from = columnOf(e.active.id);
    if (from === to && list.indexOf(gid) === index) return;
    void place(gid, to, index < 0 ? list.length : index);
  };

  const columns: Array<{ key: ColKey; day: EventData['days'][number] | null }> = [{ key: 'none', day: null }, ...ev.days.map((d) => ({ key: d.id as ColKey, day: d }))];
  const dragged = dragging ? byId.get(dragging) : null;

  return (
    <div>
      <p className="small muted">
        Arraste cada grupo para o dia em que se apresenta e solte na posição desejada; a ordem (#) e a hora prevista são atualizadas na hora. Sem mouse: use “Mover para” e as
        setas de cada cartão. {busy && <strong>Salvando…</strong>}
      </p>
      {ev.days.length === 0 && <Empty>Cadastre os dias da banca na etapa 4 antes de distribuir os grupos.</Empty>}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setDragging(null), setOverCol(null))}>
        <div className="board">
          {columns.map(({ key, day }) => {
            const ids = cols.get(key) ?? [];
            const sched = day ? schedules.data?.find((s) => s.day.id === day.id) : null;
            return (
              <Column key={String(key)} id={colId(key)} highlight={overCol === key && dragging !== null} empty={ids.length === 0} unplaced={key === 'none'}>
                <header className="board-col-head">
                  {day ? (
                    <>
                      <strong>{dayLabel(day)}</strong>
                      <span className="small muted">
                        {day.startTime}–{day.endTime}
                        {day.room ? ` · ${day.room}` : ''} · {ids.length} grupo(s)
                        {sched?.predictedEnd ? ` · término ${sched.predictedEnd}` : ''}
                      </span>
                      {sched?.warnings.filter((w) => !/perfil/i.test(w)).map((w, i) => (
                        <span key={i} className="small warn-text">
                          {w}
                        </span>
                      ))}
                    </>
                  ) : (
                    <>
                      <strong>Sem dia</strong>
                      <span className="small muted">{ids.length ? `${ids.length} grupo(s) aguardando um dia` : 'Todos os grupos já estão em um dia.'}</span>
                    </>
                  )}
                </header>
                <SortableContext items={ids.map(cardId)} strategy={verticalListSortingStrategy}>
                  <ol className="board-list">
                    {ids.map((gid, i) => {
                      const g = byId.get(gid);
                      if (!g) return null;
                      return (
                        <Card
                          key={gid}
                          g={g}
                          position={key === 'none' ? null : i + 1}
                          time={key === 'none' ? null : (predicted.get(gid)?.start ?? null)}
                          overflow={!!predicted.get(gid)?.overflow}
                          days={ev.days}
                          colKey={key}
                          onMoveTo={(to) => void place(gid, to, (cols.get(to) ?? []).length)}
                          onUp={i > 0 && key !== 'none' ? () => void place(gid, key, i - 1) : undefined}
                          onDown={i < ids.length - 1 && key !== 'none' ? () => void place(gid, key, i + 1) : undefined}
                        />
                      );
                    })}
                  </ol>
                </SortableContext>
              </Column>
            );
          })}
        </div>
        <DragOverlay>{dragged ? <CardFace g={dragged} position={null} time={null} overflow={false} lifted /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ id, highlight, empty, unplaced, children }: { id: string; highlight: boolean; empty: boolean; unplaced: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`board-col ${highlight || isOver ? 'is-over' : ''} ${unplaced ? 'is-unplaced' : ''} ${empty ? 'is-empty' : ''}`}>
      {children}
      {empty && <p className="board-drop small muted">Solte um grupo aqui</p>}
    </section>
  );
}

function CardFace({ g, position, time, overflow, lifted }: { g: Group; position: number | null; time: string | null; overflow: boolean; lifted?: boolean }) {
  return (
    <div className={`board-card-face ${lifted ? 'is-lifted' : ''}`} style={{ ['--group-color' as string]: g.color }}>
      {position !== null ? <OrderBadge position={position} color={g.color} /> : <span className="color-dot" style={{ background: g.color }} aria-hidden="true" />}
      <span className="board-card-text">
        <strong>{g.code}</strong> <span className="muted small">{g.className}</span>
        <span className="board-card-title">{g.title}</span>
        {time && (
          <span className={`small ${overflow ? 'warn-text' : 'muted'}`}>
            Previsto {time}
            {overflow && ' · após o término do dia'}
          </span>
        )}
        {g.started && <span className="small muted">Já se apresentou (fixo neste dia)</span>}
      </span>
    </div>
  );
}

function Card({
  g,
  position,
  time,
  overflow,
  days,
  colKey,
  onMoveTo,
  onUp,
  onDown,
}: {
  g: Group;
  position: number | null;
  time: string | null;
  overflow: boolean;
  days: EventData['days'];
  colKey: ColKey;
  onMoveTo: (to: ColKey) => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardId(g.id) });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`board-card ${isDragging ? 'is-dragging' : ''}`}>
      <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Arrastar ${g.code}${position ? ` (posição ${position})` : ''}`}>
        ⠿
      </button>
      <CardFace g={g} position={position} time={time} overflow={overflow} />
      <div className="board-card-actions">
        {(onUp || onDown) && (
          <>
            <Button variant="ghost" disabled={!onUp} onClick={onUp} aria-label={`Subir ${g.code}`}>
              ↑
            </Button>
            <Button variant="ghost" disabled={!onDown} onClick={onDown} aria-label={`Descer ${g.code}`}>
              ↓
            </Button>
          </>
        )}
        <select
          aria-label={`Mover ${g.code} para`}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onMoveTo(v === 'none' ? 'none' : Number(v));
          }}
        >
          <option value="">Mover para…</option>
          {days
            .filter((d) => d.id !== colKey)
            .map((d) => (
              <option key={d.id} value={d.id} disabled={g.started}>
                {dayLabel(d)}
              </option>
            ))}
          {colKey !== 'none' && (
            <option value="none" disabled={g.started}>
              Sem dia (tirar do cronograma)
            </option>
          )}
        </select>
      </div>
    </li>
  );
}
