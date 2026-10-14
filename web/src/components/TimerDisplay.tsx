import { useEffect, useRef, useState } from 'react';
import { formatClock, LEVEL_LABEL, STATUS_LABEL, stageStartMs, type TimerView } from '@shared/timer.ts';
import type { LiveState } from '../lib/types.ts';

const LEVEL_ICON = { normal: '●', warn: '▲', danger: '◆', over: '⛔' } as const;

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [sys, setSys] = useState(() => window.matchMedia?.(query).matches ?? false);
  const [pref, setPref] = useState(() => {
    try {
      return localStorage.getItem('banca.reduceMotion') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    const h = () => setSys(mq.matches);
    mq?.addEventListener('change', h);
    const onPref = () => {
      try {
        setPref(localStorage.getItem('banca.reduceMotion') === '1');
      } catch {
        /* sem armazenamento */
      }
    };
    window.addEventListener('banca-motion', onPref);
    return () => {
      mq?.removeEventListener('change', h);
      window.removeEventListener('banca-motion', onPref);
    };
  }, []);
  return sys || pref;
}

export function StageSegments({ stages, view }: { stages: { name: string; durationSeconds: number; color: string }[]; view: TimerView }) {
  const total = stages.reduce((a, s) => a + s.durationSeconds, 0) || 1;
  return (
    <div className="segments" role="img" aria-label={`Progresso: etapa ${view.stageIndex + 1} de ${stages.length}, ${Math.floor(view.progressPct)}% do tempo total`}>
      <div className="segments-bar">
        {stages.map((s, i) => {
          const start = stageStartMs(stages, i);
          const dur = s.durationSeconds * 1000;
          const fill = Math.max(0, Math.min(1, (view.elapsedMs - start) / dur));
          const state = i < view.stageIndex || view.timeUp ? 'done' : i === view.stageIndex ? 'current' : 'next';
          return (
            <div key={i} className={`segment segment-${state}`} style={{ flexGrow: s.durationSeconds / total, ['--seg-color' as any]: s.color }}>
              <div className="segment-fill" style={{ width: `${fill * 100}%` }} />
            </div>
          );
        })}
      </div>
      <div className="segments-labels" aria-hidden="true">
        {stages.map((s, i) => {
          const state = i < view.stageIndex || view.timeUp ? 'done' : i === view.stageIndex ? 'current' : 'next';
          return (
            <div key={i} className={`segment-label segment-label-${state}`} style={{ flexGrow: s.durationSeconds / total }}>
              <span className="seg-mark">{state === 'done' ? '✓' : state === 'current' ? '▶' : '○'}</span> {s.name} · {formatClock(s.durationSeconds * 1000)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Anúncios para leitores de tela: troca de etapa e fim do tempo (não anuncia cada segundo). */
function Announcer({ view, groupCode }: { view: TimerView | null; groupCode?: string }) {
  const [msg, setMsg] = useState('');
  const [urgent, setUrgent] = useState('');
  const prev = useRef<{ stage: number; timeUp: boolean; status: string } | null>(null);
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    if (p) {
      if (!p.timeUp && view.timeUp) setUrgent(`Tempo encerrado${groupCode ? ` para ${groupCode}` : ''}.`);
      else if (p.stage !== view.stageIndex && view.stage) setMsg(`Nova etapa: ${view.stage.name}.`);
      else if (p.status !== view.status) setMsg(`Cronômetro: ${STATUS_LABEL[view.status]}.`);
    }
    prev.current = { stage: view.stageIndex, timeUp: view.timeUp, status: view.status };
  }, [view?.stageIndex, view?.timeUp, view?.status, view, groupCode]);
  return (
    <>
      <div className="sr-only" aria-live="polite">
        {msg}
      </div>
      <div className="sr-only" aria-live="assertive">
        {urgent}
      </div>
    </>
  );
}

/** Tela de espera do telão (sem dados de grupo). */
export function WaitingScreen({ subtitle, note }: { subtitle?: string; note?: string }) {
  return (
    <section className="timer timer-projection timer-waiting" aria-label="Cronômetro da apresentação">
      <div>
        <p className="timer-wait-kicker" aria-hidden="true">
          ●
        </p>
        <h2 className="timer-title">Aguardando</h2>
        <p className="muted timer-wait-text">{note ?? 'A próxima apresentação começará em instantes.'}</p>
        {subtitle && <p className="muted timer-wait-sub">{subtitle}</p>}
      </div>
    </section>
  );
}

/** Contagem regressiva do início: número grande que diminui até sumir; o próximo surge em seguida. */
export function Countdown({ ms }: { ms: number }) {
  const n = Math.floor(ms / 1000);
  return (
    <div className="countdown" role="timer" aria-label={`A apresentação começa em ${n}`}>
      <span key={n} className="countdown-num">
        {n}
      </span>
    </div>
  );
}

export function TimerDisplay({
  live,
  view,
  compact = false,
  countdownMs = 0,
}: {
  live: LiveState;
  view: TimerView | null;
  compact?: boolean;
  /** Contagem regressiva restante antes de o tempo começar (0 = já começou). */
  countdownMs?: number;
}) {
  const reduced = useReducedMotion();
  const stages = live.timer?.stages ?? live.plannedStages ?? [];
  const cur = live.current;
  const level = view?.level ?? 'normal';
  const finishedEarly = view && view.status === 'ended' && !view.timeUp;
  const stopped = view?.status === 'stopped';
  const over = level === 'over';

  let statusText = view ? STATUS_LABEL[view.status] : 'Sem grupo selecionado';
  if (finishedEarly) statusText = 'Apresentação encerrada';
  if (view?.status === 'idle') statusText = 'Pronto para iniciar';

  const cls = `timer timer-${compact ? 'compact' : 'projection'} lvl-${level} ${over ? (reduced ? 'over-static' : 'over-blink') : ''} ${reduced ? 'no-motion' : ''}`;

  // Telão: o grupo só aparece depois de "Iniciar apresentação". Antes disso (inclusive na troca
  // de grupo, quando o próximo foi selecionado mas não aberto), mostra apenas a tela de espera.
  if (!compact && (!cur || !live.timer || !view || stages.length === 0)) {
    return <WaitingScreen subtitle={`${live.event.name} · ${live.day.label}${live.day.room ? ` · ${live.day.room}` : ''}`} />;
  }
  if (!compact && countdownMs > 0) {
    return (
      <section className={`${cls} timer-countdown`} aria-label="Cronômetro da apresentação">
        <header className="timer-head" style={{ ['--group-color' as any]: cur!.color }}>
          <div className="timer-group">
            <span className="timer-order" style={{ background: cur!.color }}>
              <span className="sr-only">Ordem </span>#{cur!.position}
            </span>
            <span className="timer-code">{cur!.code}</span>
            <span className="timer-class">{cur!.className}</span>
          </div>
          <h2 className="timer-title">{cur!.title}</h2>
        </header>
        <div className="timer-body">
          <p className="countdown-label">A apresentação começa em</p>
          <Countdown ms={countdownMs} />
        </div>
        <div />
      </section>
    );
  }

  const levelChip =
    view && (level === 'warn' || level === 'danger') ? (
      <span className="timer-level">
        <span aria-hidden="true">{LEVEL_ICON[level]} </span>
        {LEVEL_LABEL[level]}
      </span>
    ) : null;

  const stageClock = view && (
    <div className="clock clock-stage" style={{ ['--stage-color' as any]: view.stage?.color }}>
      <div className="clock-label">
        <span>
          Etapa {view.stageIndex + 1}/{stages.length}: <strong>{view.stage?.name}</strong>
        </span>
      </div>
      <div className="clock-digits" role="timer" aria-live="off" aria-label={`Tempo restante da etapa ${formatClock(view.stageRemainingMs)}`}>
        {formatClock(view.stageRemainingMs)}
      </div>
    </div>
  );

  const totalClock = view && (
    <div className="clock clock-total">
      <div className="clock-label">Tempo total restante</div>
      <div className="clock-digits" role="timer" aria-live="off" aria-label={`Tempo total restante ${formatClock(view.totalRemainingMs)}`}>
        {formatClock(view.totalRemainingMs)}
      </div>
      <div className="clock-sub">{Math.floor(view.progressPct)}% concluído</div>
    </div>
  );

  const timeUp = (
    <div className="time-up" role="alert">
      <div className="time-up-text">TEMPO ENCERRADO</div>
      <div className="time-up-clock" aria-label="Tempo total restante: zero">
        00:00
      </div>
    </div>
  );

  const nextStage =
    view && view.nextStage && !finishedEarly && !stopped ? (
      <span>
        Próxima etapa: <strong>{view.nextStage.name}</strong> ({formatClock(view.nextStage.durationSeconds * 1000)})
      </span>
    ) : (
      <span>{view?.timeUp || finishedEarly ? 'Aguardando o responsável pela banca.' : 'Última etapa.'}</span>
    );
  const nextGroup = live.next && (
    <span>
      Próximo grupo: <strong>{live.next.code}</strong>
      {compact ? ` — ${live.next.title}` : ''}
    </span>
  );

  if (compact) {
    if (!view || stages.length === 0) {
      return (
        <section className={cls} aria-label="Cronômetro da apresentação">
          <p className="muted small">{cur ? 'Grupo sem perfil de tempo configurado.' : 'Nenhum grupo selecionado.'}</p>
        </section>
      );
    }
    if (countdownMs > 0) {
      return (
        <section className={`${cls} timer-countdown`} aria-label="Cronômetro da apresentação">
          <div className="timer-status-line">
            <span className="timer-status status-running">Começando</span>
          </div>
          <p className="countdown-label">A apresentação começa em</p>
          <Countdown ms={countdownMs} />
        </section>
      );
    }
    return (
      <section className={cls} aria-label="Cronômetro da apresentação">
        <Announcer view={view} groupCode={cur?.code} />
        <div className="timer-status-line">
          <span className={`timer-status status-${view.status}`}>{statusText}</span>
          {levelChip}
        </div>
        {over ? (
          timeUp
        ) : (
          <div className="clocks">
            {stageClock}
            {totalClock}
          </div>
        )}
        <StageSegments stages={stages} view={view} />
        <div className="timer-foot">
          {nextStage}
          {nextGroup}
        </div>
      </section>
    );
  }

  return (
    <section className={cls} aria-label="Cronômetro da apresentação">
      <Announcer view={view} groupCode={cur?.code} />
      <header className="timer-head" style={{ ['--group-color' as any]: cur!.color }}>
        <div className="timer-group">
          <span className="timer-order" style={{ background: cur!.color }}>
            <span className="sr-only">Ordem </span>#{cur!.position}
          </span>
          <span className="timer-code">{cur!.code}</span>
          <span className="timer-class">{cur!.className}</span>
        </div>
        <h2 className="timer-title">{cur!.title}</h2>
        {cur!.students && cur!.students.length > 0 && <p className="timer-students">{cur!.students.join(' · ')}</p>}
      </header>

      <div className="timer-body">{over ? timeUp : stageClock}</div>

      <div>
        <StageSegments stages={stages} view={view!} />
        <footer className="timer-foot" style={{ marginTop: '2vh' }}>
          <div className="foot-left">
            <span className={`timer-status status-${view!.status}`}>{statusText}</span>
            {levelChip}
          </div>
          {over ? <span /> : totalClock}
          <div className="foot-right">
            {nextStage}
            {nextGroup && <div>{nextGroup}</div>}
          </div>
        </footer>
      </div>
    </section>
  );
}
