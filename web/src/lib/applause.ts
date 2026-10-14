/**
 * Som de palmas sintetizado no navegador (Web Audio API): sem arquivo externo nem direitos autorais.
 * Cada palma é um estalo curto de ruído filtrado; centenas delas, em momentos aleatórios, formam o aplauso.
 * Navegadores só liberam áudio depois de um clique/tecla na página — veja `unlockAudio`.
 */
let ctx: AudioContext | null = null;
let cached: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

/** O áudio está liberado pelo navegador? */
export function audioReady(): boolean {
  return context()?.state === 'running';
}

/** Chamar em resposta a um clique/tecla: libera o áudio (política de reprodução automática). */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

function applauseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const rate = c.sampleRate;
  const buf = c.createBuffer(2, Math.floor(rate * seconds), rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // Intensidade: cresce rápido, sustenta e vai diminuindo no fim.
    const claps = Math.floor(seconds * 38);
    for (let k = 0; k < claps; k++) {
      const t = Math.random() * seconds;
      const env = Math.min(1, t / 0.4) * Math.min(1, (seconds - t) / (seconds * 0.45));
      if (Math.random() > env) continue;
      const start = Math.floor(t * rate);
      const len = Math.floor(rate * (0.012 + Math.random() * 0.02));
      const amp = 0.25 + Math.random() * 0.5;
      const decay = 4 + Math.random() * 5;
      for (let i = 0; i < len && start + i < data.length; i++) {
        data[start + i]! += (Math.random() * 2 - 1) * amp * Math.exp((-decay * i) / len);
      }
    }
    for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i]!));
  }
  return buf;
}

/** Toca o aplauso (cerca de 6 s). Retorna false se o áudio ainda não foi liberado. */
export function playApplause(seconds = 6): boolean {
  (window as any).__bancaApplausePlays = ((window as any).__bancaApplausePlays ?? 0) + 1;
  const c = context();
  if (!c || c.state !== 'running') return false;
  if (!cached || cached.duration < seconds) cached = applauseBuffer(c, seconds);
  const src = c.createBufferSource();
  src.buffer = cached;
  // Faixa típica do som de palmas e um leve corte de graves.
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1700;
  band.Q.value = 0.7;
  const high = c.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 400;
  const gain = c.createGain();
  gain.gain.value = 1.6;
  src.connect(band).connect(high).connect(gain).connect(c.destination);
  src.start();
  return true;
}
