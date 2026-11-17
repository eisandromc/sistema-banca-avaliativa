/**
 * Som de palmas do telão: o arquivo `assets/som-palmas.mp4` (só áudio, ~5,7 s), repetido em laço
 * por APPLAUSE_SECONDS e esmaecido no fim (Web Audio API).
 * Navegadores só liberam áudio depois de um clique/tecla na página — veja `unlockAudio`.
 */
import palmasUrl from '../assets/som-palmas.mp4';

/** Duração total das palmas, em segundos. */
export const APPLAUSE_SECONDS = 30;
/** Esmaecimento no fim, em segundos. */
const FADE_SECONDS = 3;

let ctx: AudioContext | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;
let playing: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

/** Carrega e decodifica o arquivo uma única vez (null se falhar). */
function loadBuffer(c: AudioContext): Promise<AudioBuffer | null> {
  buffer ??= fetch(palmasUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => c.decodeAudioData(data))
    .catch((err) => {
      console.warn('Não foi possível carregar o som de palmas:', err);
      buffer = null; // tenta de novo na próxima vez
      return null;
    });
  return buffer;
}

/** O áudio está liberado pelo navegador? */
export function audioReady(): boolean {
  return context()?.state === 'running';
}

/** Chamar em resposta a um clique/tecla: libera o áudio (política de reprodução automática) e já carrega o arquivo. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  void loadBuffer(c);
  return c.state === 'running';
}

/** Interrompe as palmas em andamento (ex.: ao desligar "Palmas no fim"). */
export function stopApplause() {
  if (!playing) return;
  try {
    playing.src.stop();
  } catch {
    /* já parou */
  }
  playing = null;
}

/** Toca as palmas por `seconds` (padrão 30 s). Retorna false se o áudio ainda não foi liberado. */
export function playApplause(seconds = APPLAUSE_SECONDS): boolean {
  (window as any).__bancaApplausePlays = ((window as any).__bancaApplausePlays ?? 0) + 1;
  const c = context();
  if (!c || c.state !== 'running') return false;
  void loadBuffer(c).then((buf) => {
    if (!buf) return;
    stopApplause();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = c.createGain();
    const t0 = c.currentTime;
    const fade = Math.min(FADE_SECONDS, seconds / 2);
    gain.gain.setValueAtTime(1, t0);
    gain.gain.setValueAtTime(1, t0 + seconds - fade);
    gain.gain.linearRampToValueAtTime(0, t0 + seconds);
    src.connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + seconds);
    const current = { src, gain };
    playing = current;
    src.onended = () => {
      if (playing === current) playing = null;
    };
  });
  return true;
}
