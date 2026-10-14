import type { WebSocket } from 'ws';

/**
 * Hub de tempo real: cada dia de banca é uma "sala". As mensagens transmitidas
 * NUNCA contêm notas, comentários ou votos — apenas estado público e sinais de
 * "algo mudou", para que cada cliente recarregue pelo REST com sua própria autorização.
 */
export type HubMessage =
  | { type: 'live'; dayId: number; state: unknown }
  | { type: 'day-changed'; dayId: number; reason: string; entryId?: number }
  | { type: 'evaluations-opened'; dayId: number; entryId: number; groupId: number }
  | { type: 'display-changed' }
  | { type: 'hello'; serverNow: number }
  | { type: 'subscribed'; dayId: number }
  | { type: 'error'; error: string };

export class RealtimeHub {
  private rooms = new Map<number, Set<WebSocket>>();
  private socketRooms = new Map<WebSocket, Set<number>>();

  join(dayId: number, ws: WebSocket) {
    let room = this.rooms.get(dayId);
    if (!room) this.rooms.set(dayId, (room = new Set()));
    room.add(ws);
    let mine = this.socketRooms.get(ws);
    if (!mine) this.socketRooms.set(ws, (mine = new Set()));
    mine.add(dayId);
  }

  leave(dayId: number, ws: WebSocket) {
    this.rooms.get(dayId)?.delete(ws);
    this.socketRooms.get(ws)?.delete(dayId);
  }

  drop(ws: WebSocket) {
    for (const dayId of this.socketRooms.get(ws) ?? []) this.rooms.get(dayId)?.delete(ws);
    this.socketRooms.delete(ws);
  }

  send(ws: WebSocket, msg: HubMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(dayId: number, msg: HubMessage) {
    const payload = JSON.stringify(msg);
    for (const ws of this.rooms.get(dayId) ?? []) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  roomSize(dayId: number): number {
    return this.rooms.get(dayId)?.size ?? 0;
  }

  activeDays(): number[] {
    return [...this.rooms.entries()].filter(([, s]) => s.size > 0).map(([d]) => d);
  }
}
