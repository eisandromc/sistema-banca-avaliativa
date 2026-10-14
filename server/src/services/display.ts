import type { Queryable } from '../db/database.ts';
import type { RealtimeHub } from '../realtime/hub.ts';
import { audit } from '../audit.ts';

/** Sala do hub que recebe os sinais de troca do dia exibido no telão (os dias usam ids > 0). */
export const DISPLAY_ROOM = 0;

export interface ActiveDisplay {
  dayId: number;
  label: string;
  date: string;
  room: string | null;
  eventId: number;
  eventName: string;
  activatedAt: string;
}

/** Dia atualmente ativo no telão (no máximo um). */
export async function activeDisplay(q: Queryable): Promise<ActiveDisplay | null> {
  const r = await q.one<any>(
    `select d.id, d.label, d.date, d.room, d.display_active_at, e.id as event_id, e.name as event_name
       from event_days d join events e on e.id = d.event_id where d.display_active_at is not null`,
  );
  return r
    ? {
        dayId: r.id,
        label: r.label,
        date: r.date,
        room: r.room,
        eventId: r.event_id,
        eventName: r.event_name,
        activatedAt: new Date(r.display_active_at).toISOString(),
      }
    : null;
}

/** Ativa (substituindo o anterior) ou desativa o dia no telão. Retorna se houve mudança. */
export async function setDisplay(q: Queryable, dayId: number, active: boolean, actorId: number | null, reason: 'manual' | 'auto_start' = 'manual') {
  const current = await activeDisplay(q);
  if (active) {
    if (current?.dayId === dayId) return { changed: false, previousDayId: dayId };
    if (current) await q.query('update event_days set display_active_at = null, display_activated_by = null where id = $1', [current.dayId]);
    await q.query('update event_days set display_active_at = now(), display_activated_by = $2 where id = $1', [dayId, actorId]);
    await audit(q, actorId, 'display.activated', 'event_day', dayId, { previousDayId: current?.dayId ?? null, reason });
    return { changed: true, previousDayId: current?.dayId ?? null };
  }
  if (current?.dayId !== dayId) return { changed: false, previousDayId: current?.dayId ?? null };
  await q.query('update event_days set display_active_at = null, display_activated_by = null where id = $1', [dayId]);
  await audit(q, actorId, 'display.deactivated', 'event_day', dayId, null);
  return { changed: true, previousDayId: dayId };
}

/** Avisa os telões (e as telas dos dias envolvidos) que o dia exibido mudou. */
export function notifyDisplay(hub: RealtimeHub, ...dayIds: Array<number | null | undefined>) {
  hub.broadcast(DISPLAY_ROOM, { type: 'display-changed' });
  for (const id of new Set(dayIds)) if (id) hub.broadcast(id, { type: 'day-changed', dayId: id, reason: 'display' });
}
