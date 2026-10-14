import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { CONNECTION_LABEL, countdownLeft, useDayChannel, useDisplayDay, useTimerView } from '../lib/realtime.ts';
import { audioReady, playApplause, unlockAudio } from '../lib/applause.ts';
import { TimerDisplay, WaitingScreen } from '../components/TimerDisplay.tsx';
import { TimerControls } from '../components/TimerControls.tsx';
import { Alert, Button, Spinner } from '../components/ui.tsx';
import { IconArrowLeft, IconExpand } from '../components/icons.tsx';
import { dayLabel } from '../lib/format.ts';

export function ConnectionBadge({ connection }: { connection: keyof typeof CONNECTION_LABEL }) {
  return (
    <span className={`conn conn-${connection}`} role="status">
      <span aria-hidden="true">{connection === 'online' ? '●' : connection === 'offline' ? '✕' : '◌'} </span>
      {CONNECTION_LABEL[connection]}
    </span>
  );
}

function MotionToggle() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('banca.reduceMotion') === '1';
    } catch {
      return false;
    }
  });
  return (
    <label className="motion-toggle">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          try {
            localStorage.setItem('banca.reduceMotion', e.target.checked ? '1' : '0');
          } catch {
            /* sem armazenamento */
          }
          window.dispatchEvent(new Event('banca-motion'));
        }}
      />
      Sem piscar
    </label>
  );
}

function readPref(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

/**
 * Palmas quando o tempo total estoura (TEMPO ENCERRADO). Toca só na transição, com a página aberta;
 * encerrar antes do tempo não toca. O navegador exige um clique/tecla para liberar o áudio.
 */
function useApplause(timeUp: boolean) {
  const [enabled, setEnabled] = useState(() => readPref('banca.applause', true));
  const [ready, setReady] = useState(() => audioReady());
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    const unlock = () => void unlockAudio().then(setReady);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  useEffect(() => {
    if (prev.current === false && timeUp && enabled) playApplause();
    prev.current = timeUp;
  }, [timeUp, enabled]);
  const toggle = (v: boolean) => {
    setEnabled(v);
    try {
      localStorage.setItem('banca.applause', v ? '1' : '0');
    } catch {
      /* sem armazenamento */
    }
    if (v) void unlockAudio().then(setReady);
  };
  return { enabled, ready, toggle };
}

/** Esconde a barra do telão depois de alguns segundos sem mexer o mouse/teclado. */
function useIdle(ms = 3000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), ms);
    };
    const evs = ['mousemove', 'mousedown', 'keydown', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      for (const e of evs) window.removeEventListener(e, wake);
    };
  }, [ms]);
  return idle;
}

/**
 * Área 1 — Cronômetro para projeção (sem notas ou comentários).
 * Não há seleção de dia ou de grupo: o telão segue sozinho o dia ativado pelo professor primário
 * e mostra o grupo somente quando a apresentação é iniciada; antes disso, "Aguardando".
 */
export function CronometroPage() {
  const { display, restricted, loaded } = useDisplayDay();
  if (!loaded) return <Spinner />;
  return (
    <Projection key={display?.dayId ?? 0} dayId={display?.dayId ?? null} restricted={restricted} />
  );
}

function Projection({ dayId, restricted }: { dayId: number | null; restricted: boolean }) {
  const { user, primaryDayIds } = useAuth();
  const { live, receivedAt, connection, error } = useDayChannel(dayId);
  const view = useTimerView(live, receivedAt);
  const [showControls, setShowControls] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const idle = useIdle();
  const canControl = !!user && !!dayId && (user.role === 'admin' || primaryDayIds.includes(dayId));
  const applause = useApplause(!!view?.timeUp && !!live?.timer);
  const countdown = countdownLeft(live, receivedAt);

  return (
    <div className={`projection-page ${idle && !showControls ? 'is-idle' : ''}`} ref={stageRef}>
      <div className="projection-toolbar">
        <Link className="btn btn-ghost" to="/">
          <IconArrowLeft size={16} /> Início
        </Link>
        <span className="toolbar-title">{live ? `${live.event.name} · ${dayLabel(live.day)}` : ''}</span>
        {dayId && <ConnectionBadge connection={connection} />}
        <MotionToggle />
        <label className="motion-toggle">
          <input type="checkbox" checked={applause.enabled} onChange={(e) => applause.toggle(e.target.checked)} />
          Palmas no fim
        </label>
        {canControl && (
          <Button variant="ghost" aria-pressed={showControls} onClick={() => setShowControls((v) => !v)}>
            {showControls ? 'Ocultar controles' : 'Mostrar controles'}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            const el = stageRef.current;
            if (!document.fullscreenElement) void el?.requestFullscreen?.();
            else void document.exitFullscreen();
          }}
        >
          <IconExpand size={16} /> Tela cheia
        </Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {applause.enabled && !applause.ready && (
        <button className="btn btn-ghost sound-hint" onClick={() => void unlockAudio()}>
          🔇 Clique na tela para ativar o som das palmas
        </button>
      )}
      {!dayId ? (
        <WaitingScreen
          note={
            restricted
              ? 'A banca em andamento não tem exibição pública. Entre com a conta do telão.'
              : 'Nenhuma banca ativa no telão. A exibição começa quando o professor primário ativar o dia.'
          }
        />
      ) : !live ? (
        !error && (
          <div className="timer-waiting">
            <Spinner label="Sincronizando com o servidor…" />
          </div>
        )
      ) : (
        <>
          <TimerDisplay live={live} view={view} countdownMs={countdown} />
          {canControl && showControls && (
            <div className="projection-controls">
              <TimerControls dayId={dayId} live={live} view={view} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
