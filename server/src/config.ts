import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string | null;
  pgliteDir: string | null;
  cookieSecret: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  timerSpeed: number;
  /** Contagem regressiva (s) exibida entre "Iniciar apresentação" e o início do tempo. */
  countdownSeconds: number;
  defaultTimezone: string;
  webDist: string | null;
}

/** Carrega `.env` da raiz do repositório (se existir) sem sobrescrever variáveis já definidas. */
function loadDotEnv(): void {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnv();
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const cookieSecret = process.env.COOKIE_SECRET ?? 'dev-only-insecure-cookie-secret-0123456789';
  const requestedSpeed = Number(process.env.TIMER_SPEED ?? '1') || 1;

  if (env === 'production') {
    if (!process.env.COOKIE_SECRET || cookieSecret.length < 32) {
      throw new Error('COOKIE_SECRET obrigatório (mínimo 32 caracteres) em produção.');
    }
    if (requestedSpeed !== 1) {
      throw new Error('TIMER_SPEED (aceleração do cronômetro) só é permitido fora de produção.');
    }
  }

  const webDist = resolve(import.meta.dirname, '../../web/dist');
  const base: AppConfig = {
    env,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '127.0.0.1',
    databaseUrl: process.env.DATABASE_URL || null,
    // Caminho relativo é resolvido a partir da raiz do repositório (o npm executa em server/).
    pgliteDir: resolve(import.meta.dirname, '../..', process.env.PGLITE_DIR || '.data/pglite'),
    cookieSecret,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
    timerSpeed: env === 'production' ? 1 : Math.max(1, requestedSpeed),
    countdownSeconds: Math.min(30, Math.max(0, Number(process.env.COUNTDOWN_SECONDS ?? (env === 'test' ? 0 : 10)) || 0)),
    defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'America/Sao_Paulo',
    webDist: existsSync(webDist) ? webDist : null,
  };
  const cfg = { ...base, ...overrides };
  if (cfg.env === 'production') cfg.timerSpeed = 1;
  return cfg;
}
