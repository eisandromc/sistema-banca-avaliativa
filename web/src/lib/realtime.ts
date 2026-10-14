import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import type { LiveState } from './types.ts';
import { computeTimer, type TimerView } from '@shared/timer.ts';

export type Connection = 'connecting' | 'online' | 'reconnecting' | 'polling' | 'offline';

export const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: 'Conectando…',
  online: 'Sincronizado em tempo real',
  reconnecting: 'Reconectando…',
  polling: 'Conexão instável — atualizando a cada 3 s',
  offline: 'Sem conexão',
};

export interface Signal {
  type: 'day-changed' | 'evaluations-opened';
  dayId: number;
  reason?: string;
  entryId?: number;
  groupId?: number;
}

/**
 * Canal em tempo real de um dia de banca: WebSocket com reconexão (backoff exponencial)
 * e fallback por polling HTTP enquanto o socket estiver indisponível.
 * `receivedAt` usa relógio monotônico (performance.now) — o horário do navegador nunca é referência.
 */
export function useDayChannel(dayId: number | null, onSignal?: (s: Signal) => void) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;

  useEffect(() => {
    // Ao trocar de dia, descarta o estado do dia anterior (nunca mistura dados/controles de dias diferentes).
    setLive(null);
    setError(null);
    if (!dayId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    let pollStarter: number | undefined;

    const accept = (state: LiveState) => {
      // Respostas atrasadas de outro dia (ou após a troca) são ignoradas.
      if (closed || state.day.id !== dayId) return;
      setLive(state);
      setReceivedAt(performance.now());
      setError(null);
    };

    const poll = async () => {
      try {
        accept(await api.get<LiveState>(`/api/days/${dayId}/live`));
        setConnection((c) => (c === 'online' ? c : 'polling'));
        signalRef.current?.({ type: 'day-changed', dayId, reason: 'poll' });
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) setError(e.message);
        setConnection((c) => (c === 'online' ? c : 'offline'));
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      void poll();
      pollTimer = window.setInterval(poll, 3000);
    };
    const stopPolling = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      if (pollStarter) window.clearTimeout(pollStarter);
      pollTimer = pollStarter = undefined;
    };

    const connect = () => {
      if (closed) return;
      setConnection(attempt === 0 ? 'connecting' : 'reconnecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        attempt = 0;
        ws!.send(JSON.stringify({ type: 'subscribe', dayId }));
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'subscribed') {
          setConnection('online');
          stopPolling();
        } else if (msg.type === 'live' && msg.dayId === dayId) {
          accept(msg.state);
        } else if (msg.type === 'day-changed' || msg.type === 'evaluations-opened') {
          signalRef.current?.(msg);
        } else if (msg.type === 'error') {
          setError(msg.error);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setConnection('reconnecting');
        // Fallback: se não reconectar logo, passa a atualizar por HTTP.
        if (!pollStarter && !pollTimer) pollStarter = window.setTimeout(startPolling, 2500);
        const delay = Math.min(15000, 1000 * 2 ** attempt++);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    // Primeira carga por HTTP (não depende do socket).
    void api
      .get<LiveState>(`/api/days/${dayId}/live`)
      .then(accept)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    const onOnline = () => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        window.clearTimeout(reconnectTimer);
        attempt = 0;
        connect();
      }
    };
    const onOffline = () => setConnection('offline');
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      stopPolling();
      ws?.close();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dayId]);

  return { live, receivedAt, connection, error };
}

/** Contagem regressiva restante (ms) antes do início do tempo, interpolada localmente. */
export function countdownLeft(live: LiveState | null, receivedAt: number): number {
  const t = live?.timer;
  if (!t || t.status !== 'running' || !t.countdownMs) return 0;
  return Math.max(0, t.countdownMs - (performance.now() - receivedAt));
}

/** Atualiza o visor localmente entre mensagens do servidor (interpolação monotônica). */
export function useTimerView(live: LiveState | null, receivedAt: number, intervalMs = 200): TimerView | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  if (!live) return null;
  const thresholds = { warnPct: live.event.warnPct, dangerPct: live.event.dangerPct };
  if (live.timer) {
    const t = live.timer;
    // Durante a contagem regressiva o tempo ainda não corre.
    const delta = t.status === 'running' ? Math.max(0, performance.now() - receivedAt - (t.countdownMs ?? 0)) * t.speed : 0;
    return computeTimer(t.stages, t.elapsedMs + delta, t.status, thresholds);
  }
  if (live.plannedStages) return computeTimer(live.plannedStages, 0, 'idle', thresholds);
  return null;
}

export interface DisplayInfo {
  dayId: number;
  label: string;
  date: string;
  room: string | null;
  eventId: number;
  eventName: string;
  activatedAt: string;
}

/**
 * Telão: qual dia exibir. Não há seleção na tela — segue o dia ativado pelo professor primário.
 * Recebe o sinal "display-changed" por WebSocket e, por segurança, também consulta a cada 5 s.
 */
export function useDisplayDay() {
  const [display, setDisplay] = useState<DisplayInfo | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempt = 0;
    const fetchNow = async () => {
      try {
        const r = await api.get<{ display: DisplayInfo | null; restricted: boolean }>('/api/public/display');
        if (closed) return;
        // Mantém a mesma referência se nada mudou (evita recriar o canal do dia).
        setDisplay((prev) => (prev && r.display && prev.dayId === r.display.dayId && prev.activatedAt === r.display.activatedAt ? prev : r.display));
        setRestricted(r.restricted);
      } catch {
        /* mantém o último estado conhecido */
      } finally {
        if (!closed) setLoaded(true);
      }
    };
    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        attempt = 0;
        ws!.send(JSON.stringify({ type: 'subscribe-display' }));
      };
      ws.onmessage = (ev) => {
        try {
          if (JSON.parse(ev.data).type === 'display-changed') void fetchNow();
        } catch {
          /* ignora */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => ws?.close();
    };
    void fetchNow();
    connect();
    const poll = window.setInterval(fetchNow, 5000);
    return () => {
      closed = true;
      window.clearInterval(poll);
      window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { display, restricted, loaded };
}
