import { useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, errorMessage } from '../../lib/api.ts';
import type { DaySchedule, ScheduleRow } from '../../lib/types.ts';
import { ActionButton, Alert, Button, Empty, ErrorBox, Spinner, StartedCheck, StatusBadge, useLoad, useToast } from '../../components/ui.tsx';
import { NeedDay, useConfig } from '../Configuracao.tsx';
import { dayLabel, fmtTime, minutes } from '../../lib/format.ts';

export function ScheduleTab() {
  return (
    <NeedDay>
      <ScheduleInner />
    </NeedDay>
  );
}

function ScheduleInner() {
  const { dayId, event, profiles } = useConfig();
  const toast = useToast();
  const sch = useLoad(() => api.get<DaySchedule>(`/api/days/${dayId}/schedule`), [dayId]);
  const groups = useLoad(() => api.get<{ groups: any[] }>(`/api/events/${event!.id}/groups`), [event!.id, dayId]);
  const [order, setOrder] = useState<ScheduleRow[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setOrder(sch.data?.entries ?? []), [sch.data]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (sch.loading && !sch.data) return <Spinner />;
  if (sch.error) return <ErrorBox error={sch.error} onRetry={sch.reload} />;
  const s = sch.data!;

  const saveOrder = async (rows: ScheduleRow[]) => {
    setOrder(rows);
    setSaving(true);
    try {
      const r = await api.put<DaySchedule>(`/api/days/${dayId}/schedule/order`, { entryIds: rows.map((x) => x.entryId) });
      sch.setData(r);
    } catch (e) {
      toast.push({ kind: 'error', text: errorMessage(e) });
      await sch.reload(true);
    } finally {
      setSaving(false);
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    void saveOrder(arrayMove(order, from, to));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((x) => x.entryId === e.active.id);
    const to = order.findIndex((x) => x.entryId === e.over!.id);
    move(from, to);
  };
  const unscheduled = (groups.data?.groups ?? []).filter((g) => !g.entryId);

  return (
    <div>
      <div className="toolbar">
        <h3 className="toolbar-text">
          {dayLabel(s.day)}
          {event!.days.length > 1 && <span className="small muted"> · troque o dia no seletor “Dia”, no alto do menu</span>}
        </h3>
        <div className="row gap wrap" role="group" aria-label="Ordenar por">
          <span className="muted">Ordenar por:</span>
          {(
            [
              ['code', 'Número'],
              ['class', 'Turma'],
              ['title', 'Título'],
            ] as const
          ).map(([by, label]) => (
            <ActionButton
              key={by}
              onAction={async () => {
                sch.setData(await api.post<DaySchedule>(`/api/days/${dayId}/schedule/sort`, { by }));
              }}
            >
              {label}
            </ActionButton>
          ))}
        </div>
      </div>
      <p className="muted">
        Dia {s.day.startTime}–{s.day.endTime} · intervalos: {s.day.breaks.map((b) => `${b.label} ${b.start}–${b.end}`).join('; ') || 'nenhum'} · troca entre grupos{' '}
        {s.day.gapMinutes} min · término previsto: <strong>{s.predictedEnd ?? '—'}</strong> {saving && <span className="muted">· salvando ordem…</span>}
      </p>
      {s.warnings.map((w, i) => (
        <Alert key={i} kind="warn">
          {w}
        </Alert>
      ))}
      <p className="small muted">Arraste pela alça ⠿ (ou foque a alça e use Espaço + setas), use os botões ↑ ↓ ou digite a posição.</p>
      {order.length === 0 ? (
        <Empty>Nenhum grupo neste dia. Inclua grupos abaixo.</Empty>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((o) => o.entryId)} strategy={verticalListSortingStrategy}>
            <ol className="sortable-list">
              {order.map((row, i) => (
                <SortableRow key={row.entryId} row={row} index={i} count={order.length} onMove={move} profiles={profiles} reload={() => sch.reload(true)} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <h3>Grupos sem dia</h3>
      {unscheduled.length === 0 ? (
        <p className="muted">Todos os grupos da banca já estão em algum dia.</p>
      ) : (
        <ul className="chip-list">
          {unscheduled.map((g) => (
            <li key={g.id}>
              <ActionButton
                onAction={async () => {
                  await api.post(`/api/days/${dayId}/schedule`, { groupId: g.id });
                  await Promise.all([sch.reload(true), groups.reload(true)]);
                }}
              >
                + {g.code} — {g.title}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SortableRow({
  row,
  index,
  count,
  onMove,
  profiles,
  reload,
}: {
  row: ScheduleRow;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  profiles: Array<{ id: number; name: string; active: boolean }>;
  reload: () => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.entryId });
  const { event, dayId } = useConfig();
  const toast = useToast();
  const [pos, setPos] = useState(String(index + 1));
  useEffect(() => setPos(String(index + 1)), [index]);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`sortable-row ${isDragging ? 'dragging' : ''} ${row.overflow ? 'overflow' : ''}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label={`Mover ${row.code} (posição ${index + 1} de ${count})`}>
        ⠿
      </button>
      <input
        className="pos-input"
        aria-label={`Posição de ${row.code}`}
        type="number"
        min={1}
        max={count}
        value={pos}
        onChange={(e) => setPos(e.target.value)}
        onBlur={() => {
          const n = Number(pos);
          if (Number.isInteger(n) && n >= 1 && n <= count && n !== index + 1) onMove(index, n - 1);
          else setPos(String(index + 1));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="sortable-main">
        <div>
          <strong>{row.code}</strong> · {row.className} — {row.title}
        </div>
        <div className="small muted">
          Previsto {row.predictedStart}–{row.predictedEnd} ({minutes(row.durationSeconds)})
          {row.movedAfterBreak && ` · após ${row.movedAfterBreak}`}
          {row.overflow && <strong className="warn-text"> · ultrapassa o horário do dia</strong>}
          {row.startedAt && ` · real ${fmtTime(row.startedAt, event?.timezone)}${row.endedAt ? `–${fmtTime(row.endedAt, event?.timezone)}` : ''}`}
        </div>
      </div>
      <StatusBadge status={row.status} label={row.statusLabel} />
      <StartedCheck started={row.started} at={row.startedAt} />
      <select
        aria-label={`Perfil de tempo de ${row.code}`}
        value={row.timeProfileId ?? ''}
        disabled={row.started}
        onChange={async (e) => {
          try {
            await api.patch(`/api/schedule-entries/${row.entryId}`, { timeProfileId: e.target.value ? Number(e.target.value) : null });
            await reload();
          } catch (err) {
            toast.push({ kind: 'error', text: errorMessage(err) });
          }
        }}
      >
        <option value="">Perfil do dia</option>
        {profiles
          .filter((p) => p.active || p.id === row.timeProfileId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      {!row.started && event && event.days.length > 1 && (
        <select
          aria-label={`Mover ${row.code} para outro dia`}
          value=""
          onChange={async (e) => {
            try {
              await api.patch(`/api/schedule-entries/${row.entryId}`, { dayId: Number(e.target.value) });
              await reload();
            } catch (err) {
              toast.push({ kind: 'error', text: errorMessage(err) });
            }
          }}
        >
          <option value="">Mover para…</option>
          {event.days
            .filter((d) => d.id !== dayId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.label || d.date}
              </option>
            ))}
        </select>
      )}
      <div className="row-actions">
        <Button variant="ghost" aria-label={`Subir ${row.code}`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
          ↑
        </Button>
        <Button variant="ghost" aria-label={`Descer ${row.code}`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
          ↓
        </Button>
        {!row.started && (
          <ActionButton
            variant="ghost"
            aria-label={`Remover ${row.code} do cronograma`}
            onAction={async () => {
              await api.del(`/api/schedule-entries/${row.entryId}`);
              await reload();
            }}
          >
            ✕
          </ActionButton>
        )}
      </div>
    </li>
  );
}
