import type { Database, Queryable } from '../db/database.ts';
import type { RealtimeHub } from '../realtime/hub.ts';
import { computeTimer, stageStartMs, totalDurationMs, type Stage, type TimerStatus } from '../../../shared/timer.ts';
import { badRequest, conflict, notFound } from '../http.ts';
import { audit } from '../audit.ts';
import { loadProfileStages, getDaySchedule, type EntryStatus } from './schedule.ts';
import { ensureEvaluations } from './evaluations.ts';

interface SessionRow {
  id: number;
  entry_id: number;
  day_id: number;
  status: 'running' | 'paused' | 'ended' | 'stopped';
  stages: Stage[];
  speed: number;
  accumulated_ms: number;
  running_since: Date | string | null;
  started_at: Date | string;
  revision: number;
}

interface Cached {
  sessionId: number;
  dayId: number;
  stages: Stage[];
  speed: number;
  accumulatedMs: number;
  runningSinceMs: number;
  stageIndex: number;
}

export interface LiveTimer {
  sessionId: number;
  entryId: number;
  status: TimerStatus;
  stages: Stage[];
  elapsedMs: number;
  speed: number;
  revision: number;
  startedAt: string;
  /** Contagem regressiva restante (ms) antes de o tempo começar a correr; 0 = já começou. */
  countdownMs: number;
}

export interface LiveState {
  serverNow: number;
  day: { id: number; label: string; date: string; room: string | null };
  event: {
    id: number;
    name: string;
    institution: string | null;
    warnPct: number;
    dangerPct: number;
    stageAlertBeforeSeconds: number;
    stageAlertAfterSeconds: number;
    showStudentNames: boolean;
  };
  current: null | {
    entryId: number;
    groupId: number;
    code: string;
    className: string;
    title: string;
    position: number;
    color: string;
    students: string[] | null;
    status: EntryStatus;
    started: boolean;
  };
  next: null | { entryId: number; code: string; className: string; title: string };
  plannedStages: Stage[] | null;
  timer: LiveTimer | null;
}

const ms = (d: Date | string | null): number | null => (d === null ? null : new Date(d).getTime());

export function elapsedOf(s: Pick<SessionRow, 'status' | 'accumulated_ms' | 'running_since' | 'speed'>, nowMs: number): number {
  const since = ms(s.running_since);
  const live = s.status === 'running' && since !== null ? Math.max(0, nowMs - since) * s.speed : 0;
  return s.accumulated_ms + live;
}

export class TimerService {
  private cache = new Map<number, Cached>();
  private ticker: NodeJS.Timeout | null = null;
  private resync: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private db: Database,
    private hub: RealtimeHub,
    private speed: number,
    private now: () => number = Date.now,
    private countdownMs = 0,
  ) {}

  async init() {
    const rows = await this.db.query<SessionRow>("select * from timer_sessions where status = 'running'");
    for (const r of rows) this.cacheRow(r);
  }

  startTicker(intervalMs = 250) {
    this.ticker = setInterval(() => void this.tick().catch(() => undefined), intervalMs);
    this.resync = setInterval(() => {
      for (const dayId of new Set([...this.cache.values()].map((c) => c.dayId))) void this.broadcastLive(dayId).catch(() => undefined);
    }, 10_000);
  }

  stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    if (this.resync) clearInterval(this.resync);
    this.ticker = this.resync = null;
  }

  private cacheRow(r: SessionRow) {
    if (r.status !== 'running') {
      this.cache.delete(r.id);
      return;
    }
    const elapsed = elapsedOf(r, this.now());
    this.cache.set(r.id, {
      sessionId: r.id,
      dayId: r.day_id,
      stages: r.stages,
      speed: r.speed,
      accumulatedMs: r.accumulated_ms,
      runningSinceMs: ms(r.running_since)!,
      stageIndex: computeTimer(r.stages, elapsed, 'running').stageIndex,
    });
  }

  private async refreshDay(dayId: number) {
    for (const [id, c] of this.cache) if (c.dayId === dayId) this.cache.delete(id);
    const rows = await this.db.query<SessionRow>("select * from timer_sessions where day_id = $1 and status = 'running'", [dayId]);
    for (const r of rows) this.cacheRow(r);
  }

  /** Verifica trocas de etapa e término do tempo das sessões em execução. */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const nowMs = this.now();
      for (const c of [...this.cache.values()]) {
        // Durante a contagem regressiva, running_since está no futuro: o decorrido fica em zero.
        const elapsed = c.accumulatedMs + Math.max(0, nowMs - c.runningSinceMs) * c.speed;
        const total = totalDurationMs(c.stages);
        if (elapsed >= total) {
          await this.markTimeUp(c.sessionId);
          continue;
        }
        const view = computeTimer(c.stages, elapsed, 'running');
        if (view.stageIndex !== c.stageIndex) {
          const from = c.stageIndex;
          c.stageIndex = view.stageIndex;
          await this.db.query(
            "insert into timer_events (session_id, type, elapsed_ms, details) values ($1, 'stage_changed', $2, $3)",
            [c.sessionId, elapsed, { from, to: view.stageIndex, stage: view.stage?.name }],
          );
          await this.broadcastLive(c.dayId);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async markTimeUp(sessionId: number) {
    const dayId = await this.db.tx(async (q) => {
      const s = await q.one<SessionRow>('select * from timer_sessions where id = $1 for update', [sessionId]);
      if (!s || s.status !== 'running') return s?.day_id ?? null;
      const nowMs = this.now();
      const total = totalDurationMs(s.stages);
      if (elapsedOf(s, nowMs) < total) return s.day_id;
      // Tempo esgotado: congela em 00:00 (sem tempo negativo) e NÃO finaliza avaliações.
      await q.query(
        "update timer_sessions set status = 'ended', accumulated_ms = $2, running_since = null, ended_at = $3, revision = revision + 1 where id = $1",
        [s.id, total, new Date(nowMs)],
      );
      await q.query('update schedule_entries set ended_at = coalesce(ended_at, $2) where id = $1', [s.entry_id, new Date(nowMs)]);
      await q.query("insert into timer_events (session_id, type, elapsed_ms) values ($1, 'time_up', $2)", [s.id, total]);
      return s.day_id;
    });
    this.cache.delete(sessionId);
    if (dayId) {
      await this.broadcastLive(dayId);
      this.hub.broadcast(dayId, { type: 'day-changed', dayId, reason: 'time_up' });
    }
  }

  async liveState(dayId: number, q: Queryable = this.db): Promise<LiveState> {
    const d = await q.one<any>(
      `select d.*, e.name as event_name, e.institution, e.warn_pct, e.danger_pct, e.show_student_names,
              e.stage_alert_before_seconds, e.stage_alert_after_seconds
         from event_days d join events e on e.id = d.event_id where d.id = $1`,
      [dayId],
    );
    if (!d) throw notFound('Dia de banca não encontrado.');
    const schedule = await getDaySchedule(q, dayId);
    const cur = schedule.entries.find((e) => e.entryId === d.current_entry_id) ?? null;
    let students: string[] | null = null;
    if (cur && d.show_student_names) {
      students = (
        await q.query<{ name: string }>(
          'select s.name from group_students gs join students s on s.id = gs.student_id where gs.group_id = $1 order by gs.position, s.name',
          [cur.groupId],
        )
      ).map((r) => r.name);
    }
    let timer: LiveTimer | null = null;
    let plannedStages: Stage[] | null = null;
    if (cur) {
      const s = await q.one<SessionRow>('select * from timer_sessions where entry_id = $1 and not superseded', [cur.entryId]);
      if (s) {
        timer = {
          sessionId: s.id,
          entryId: s.entry_id,
          status: s.status,
          stages: s.stages,
          elapsedMs: Math.min(elapsedOf(s, this.now()), totalDurationMs(s.stages)),
          speed: s.speed,
          revision: s.revision,
          startedAt: new Date(s.started_at).toISOString(),
          countdownMs: s.status === 'running' && s.running_since ? Math.max(0, new Date(s.running_since).getTime() - this.now()) : 0,
        };
      } else if (cur.effectiveProfileId) {
        plannedStages = await loadProfileStages(q, cur.effectiveProfileId);
      }
    }
    const curPos = cur ? cur.position : -Infinity;
    const nextEntry = schedule.entries.find((e) => e.position > curPos && !e.started) ?? null;
    return {
      serverNow: this.now(),
      day: { id: d.id, label: d.label, date: d.date, room: d.room },
      event: {
        id: d.event_id,
        name: d.event_name,
        institution: d.institution,
        warnPct: d.warn_pct,
        dangerPct: d.danger_pct,
        stageAlertBeforeSeconds: d.stage_alert_before_seconds,
        stageAlertAfterSeconds: d.stage_alert_after_seconds,
        showStudentNames: d.show_student_names,
      },
      current: cur
        ? {
            entryId: cur.entryId,
            groupId: cur.groupId,
            code: cur.code,
            className: cur.className,
            title: cur.title,
            position: cur.position,
            color: cur.color,
            students,
            status: cur.status,
            started: cur.started,
          }
        : null,
      next: nextEntry ? { entryId: nextEntry.entryId, code: nextEntry.code, className: nextEntry.className, title: nextEntry.title } : null,
      plannedStages,
      timer,
    };
  }

  async broadcastLive(dayId: number) {
    if (this.hub.roomSize(dayId) === 0) return;
    const state = await this.liveState(dayId);
    this.hub.broadcast(dayId, { type: 'live', dayId, state });
  }

  /** Executa uma ação de controle de forma atômica (trava a linha do dia) e notifica os clientes. */
  private async control<R>(dayId: number, reason: string, fn: (q: Queryable, nowMs: number) => Promise<R>): Promise<R> {
    const result = await this.db.tx(async (q) => {
      const day = await q.one('select id from event_days where id = $1 for update', [dayId]);
      if (!day) throw notFound('Dia de banca não encontrado.');
      return fn(q, this.now());
    });
    await this.refreshDay(dayId);
    await this.broadcastLive(dayId);
    this.hub.broadcast(dayId, { type: 'day-changed', dayId, reason });
    return result;
  }

  private async activeSession(q: Queryable, dayId: number): Promise<SessionRow | null> {
    return q.one<SessionRow>("select * from timer_sessions where day_id = $1 and status in ('running', 'paused') for update", [dayId]);
  }

  private async requireActive(q: Queryable, dayId: number): Promise<SessionRow> {
    const s = await this.activeSession(q, dayId);
    if (!s) throw conflict('Não há apresentação em andamento neste dia.', 'NO_ACTIVE_TIMER');
    return s;
  }

  private async event(q: Queryable, sessionId: number, type: string, actorId: number | null, elapsed: number, details: object | null = null) {
    await q.query('insert into timer_events (session_id, type, actor_id, elapsed_ms, details) values ($1, $2, $3, $4, $5)', [
      sessionId,
      type,
      actorId,
      elapsed,
      details,
    ]);
  }

  /** Aplica novo decorrido/estado; se esgotar o total, encerra (TEMPO ENCERRADO). */
  private async writeState(q: Queryable, s: SessionRow, elapsed: number, status: SessionRow['status'], nowMs: number, stages = s.stages) {
    const total = totalDurationMs(stages);
    let finalStatus = status;
    let acc = Math.min(elapsed, total);
    if ((status === 'running' || status === 'paused') && acc >= total) {
      finalStatus = 'ended';
      acc = total;
      await this.event(q, s.id, 'time_up', null, total);
    }
    const endedNow = finalStatus === 'ended' || finalStatus === 'stopped';
    await q.query(
      `update timer_sessions set status = $2, accumulated_ms = $3, running_since = $4, stages = $5,
              ended_at = case when $6::boolean then coalesce(ended_at, $7) else null end, revision = revision + 1
        where id = $1`,
      [s.id, finalStatus, acc, finalStatus === 'running' ? new Date(nowMs) : null, stages, endedNow, new Date(nowMs)],
    );
    if (endedNow) await q.query('update schedule_entries set ended_at = $2 where id = $1', [s.entry_id, new Date(nowMs)]);
    else await q.query('update schedule_entries set ended_at = null where id = $1', [s.entry_id]);
    return finalStatus;
  }

  /** Seleciona o grupo atual. Enquanto houver apresentação em andamento (inclusive pausada), a troca é bloqueada. */
  async select(actorId: number, dayId: number, entryId: number) {
    return this.control(dayId, 'group_selected', async (q, nowMs) => {
      const entry = await q.one<{ id: number; group_id: number }>('select id, group_id from schedule_entries where id = $1 and day_id = $2', [entryId, dayId]);
      if (!entry) throw notFound('Grupo não pertence a este dia.');
      const day = await q.one<{ current_entry_id: number | null }>('select current_entry_id from event_days where id = $1', [dayId]);
      if (day?.current_entry_id === entryId) return { changed: false };
      const active = await this.activeSession(q, dayId);
      if (active && active.entry_id !== entryId) {
        throw conflict('Há uma apresentação em andamento. Encerre-a antes de selecionar outro grupo.', 'PRESENTATION_ACTIVE');
      }
      await q.query('update event_days set current_entry_id = $2 where id = $1', [dayId, entryId]);
      await audit(q, actorId, 'group.selected', 'event_day', dayId, { from: day?.current_entry_id ?? null, to: entryId });
      return { changed: true };
    });
  }

  async start(actorId: number, dayId: number, entryId: number) {
    let opened: { entryId: number; groupId: number } | null = null;
    const result = await this.control(dayId, 'timer_started', async (q, nowMs) => {
      const entry = await q.one<any>('select * from schedule_entries where id = $1 and day_id = $2', [entryId, dayId]);
      if (!entry) throw notFound('Grupo não pertence a este dia.');
      const existing = await q.one<SessionRow>('select * from timer_sessions where entry_id = $1 and not superseded', [entryId]);
      if (existing) {
        if (existing.status === 'running' || existing.status === 'paused') return { sessionId: existing.id, alreadyStarted: true };
        throw conflict('Esta apresentação já foi realizada. Para repetir, use "Reiniciar" com justificativa.', 'ALREADY_PRESENTED');
      }
      const closed = await q.one("select 1 from evaluation_closures where group_id = $1 and reopened_at is null", [entry.group_id]);
      if (closed) throw conflict('A avaliação deste grupo já foi fechada.', 'CLOSED');
      const active = await this.activeSession(q, dayId);
      if (active) throw conflict('Já existe outra apresentação em andamento neste dia. Encerre-a ou troque o grupo com justificativa.', 'ANOTHER_ACTIVE');
      const day = await q.one<any>('select default_profile_id, current_entry_id from event_days where id = $1', [dayId]);
      const profileId = entry.time_profile_id ?? day.default_profile_id;
      if (!profileId) throw badRequest('Defina um perfil de tempo para o grupo ou para o dia antes de iniciar.');
      const stages = await loadProfileStages(q, profileId);
      if (stages.length === 0) throw badRequest('O perfil de tempo não possui etapas.');
      const now = new Date(nowMs);
      // O tempo começa a correr depois da contagem regressiva (10, 9, … 0) exibida em todas as telas.
      const runningSince = new Date(nowMs + this.countdownMs);
      const s = await q.one<{ id: number }>(
        `insert into timer_sessions (entry_id, day_id, status, stages, speed, accumulated_ms, running_since, started_at, started_by)
         values ($1, $2, 'running', $3, $4, 0, $5, $6, $7) returning id`,
        [entryId, dayId, stages, this.speed, runningSince, now, actorId],
      );
      await this.event(q, s!.id, 'started', actorId, 0, { profileId, stages, speed: this.speed, countdownMs: this.countdownMs });
      await q.query('update schedule_entries set started_at = coalesce(started_at, $2), ended_at = null where id = $1', [entryId, now]);
      await q.query('update event_days set current_entry_id = $2 where id = $1', [dayId, entryId]);
      // Abertura automática das fichas (rubricas + votação) para os docentes designados.
      const created = await ensureEvaluations(q, entryId);
      await audit(q, actorId, 'timer.started', 'schedule_entry', entryId, { sessionId: s!.id, evaluationsOpened: created });
      opened = { entryId, groupId: entry.group_id };
      return { sessionId: s!.id, alreadyStarted: false };
    });
    if (opened) this.hub.broadcast(dayId, { type: 'evaluations-opened', dayId, ...(opened as { entryId: number; groupId: number }) });
    return result;
  }

  async pause(actorId: number, dayId: number) {
    return this.control(dayId, 'timer_paused', async (q, nowMs) => {
      const s = await this.requireActive(q, dayId);
      if (s.status === 'paused') return { status: 'paused' as const, noop: true };
      const elapsed = elapsedOf(s, nowMs);
      await this.event(q, s.id, 'paused', actorId, elapsed);
      return { status: await this.writeState(q, s, elapsed, 'paused', nowMs), noop: false };
    });
  }

  async resume(actorId: number, dayId: number) {
    return this.control(dayId, 'timer_resumed', async (q, nowMs) => {
      const s = await this.requireActive(q, dayId);
      if (s.status === 'running') return { status: 'running' as const, noop: true };
      const elapsed = elapsedOf(s, nowMs);
      await this.event(q, s.id, 'resumed', actorId, elapsed);
      return { status: await this.writeState(q, s, elapsed, 'running', nowMs), noop: false };
    });
  }

  async advance(actorId: number, dayId: number) {
    return this.control(dayId, 'timer_advanced', async (q, nowMs) => {
      const s = await this.requireActive(q, dayId);
      const elapsed = elapsedOf(s, nowMs);
      const view = computeTimer(s.stages, elapsed, s.status);
      const target = view.stageIndex + 1 < s.stages.length ? stageStartMs(s.stages, view.stageIndex + 1) : totalDurationMs(s.stages);
      await this.event(q, s.id, 'advanced', actorId, elapsed, { fromStage: view.stageIndex, toElapsedMs: target });
      return { status: await this.writeState(q, s, target, s.status, nowMs) };
    });
  }

  async finish(actorId: number, dayId: number, reason: string | undefined) {
    return this.control(dayId, 'timer_finished', async (q, nowMs) => {
      const s = await this.requireActive(q, dayId);
      const elapsed = elapsedOf(s, nowMs);
      await this.event(q, s.id, 'finished_early', actorId, elapsed, { reason: reason ?? null });
      await audit(q, actorId, 'timer.finished_early', 'timer_session', s.id, { elapsedMs: elapsed, reason: reason ?? null });
      return { status: await this.writeState(q, s, elapsed, 'ended', nowMs) };
    });
  }

  /** Ajusta as etapas da sessão em curso (não altera o perfil global). Exige justificativa e é auditado. */
  async adjust(actorId: number, dayId: number, stages: Stage[], reason: string) {
    if (!reason || reason.trim().length < 5) throw badRequest('Informe uma justificativa (mín. 5 caracteres).');
    return this.control(dayId, 'timer_adjusted', async (q, nowMs) => {
      const d = await q.one<{ current_entry_id: number | null }>('select current_entry_id from event_days where id = $1', [dayId]);
      const s =
        (await this.activeSession(q, dayId)) ??
        (d?.current_entry_id
          ? await q.one<SessionRow>("select * from timer_sessions where entry_id = $1 and not superseded and status = 'ended' for update", [d.current_entry_id])
          : null);
      if (!s) throw conflict('Não há cronômetro do grupo atual para ajustar. Para mudar o tempo antes do início, edite o perfil de tempo.', 'NO_ACTIVE_TIMER');
      const elapsed = elapsedOf(s, nowMs);
      const newTotal = totalDurationMs(stages);
      // Se o tempo havia esgotado e o ajuste ampliou o total, a sessão volta a "Pausado".
      const nextStatus: SessionRow['status'] = s.status === 'ended' ? (newTotal > elapsed ? 'paused' : 'ended') : s.status;
      await this.event(q, s.id, 'adjusted', actorId, elapsed, { before: s.stages, after: stages, reason });
      await audit(q, actorId, 'timer.adjusted', 'timer_session', s.id, {
        beforeTotalSeconds: totalDurationMs(s.stages) / 1000,
        afterTotalSeconds: newTotal / 1000,
        before: s.stages,
        after: stages,
        reason,
      });
      return { status: await this.writeState(q, s, elapsed, nextStatus, nowMs, stages) };
    });
  }

  /** Reinicia a apresentação do grupo atual: a sessão anterior fica no histórico (superseded). */
  async restart(actorId: number, dayId: number, reason: string) {
    if (!reason || reason.trim().length < 5) throw badRequest('Informe uma justificativa (mín. 5 caracteres).');
    return this.control(dayId, 'timer_restarted', async (q, nowMs) => {
      const d = await q.one<{ current_entry_id: number | null }>('select current_entry_id from event_days where id = $1', [dayId]);
      if (!d?.current_entry_id) throw conflict('Nenhum grupo selecionado.', 'NO_GROUP');
      const s = await q.one<SessionRow>('select * from timer_sessions where entry_id = $1 and not superseded for update', [d.current_entry_id]);
      if (!s) throw conflict('Este grupo ainda não iniciou a apresentação.', 'NOT_STARTED');
      const entry = await q.one<{ group_id: number }>('select group_id from schedule_entries where id = $1', [d.current_entry_id]);
      if (entry && (await q.one('select 1 from evaluation_closures where group_id = $1 and reopened_at is null', [entry.group_id]))) {
        throw conflict('A avaliação deste grupo está fechada: reabra-a antes de reiniciar a apresentação.', 'CLOSED');
      }
      const elapsed = elapsedOf(s, nowMs);
      if (s.status === 'running' || s.status === 'paused') await this.writeState(q, s, elapsed, 'stopped', nowMs);
      await q.query('update timer_sessions set superseded = true where id = $1', [s.id]);
      await this.event(q, s.id, 'restarted', actorId, elapsed, { reason });
      await audit(q, actorId, 'timer.restarted', 'timer_session', s.id, { reason, elapsedMs: elapsed });
      return { previousSessionId: s.id };
    });
  }
}
