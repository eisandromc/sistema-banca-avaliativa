import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  /** Cria os dados de demonstração (fictícios) ao iniciar. Opt-in (`DADOS_DEMO=true`); desligado por padrão. */
  dadosDemo: boolean;
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

/** Ambiente único: um só banco e as mesmas regras sempre. Só os dados de demonstração são opcionais. */
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnv();
  const cookieSecret = overrides.cookieSecret ?? process.env.COOKIE_SECRET ?? '';
  if (cookieSecret.length < 32) {
    throw new Error('COOKIE_SECRET obrigatório (mínimo 32 caracteres). Copie .env.example para .env ou defina a variável.');
  }
  const requestedSpeed = Number(process.env.TIMER_SPEED ?? '1') || 1;

  const webDist = resolve(import.meta.dirname, '../../web/dist');
  const base: AppConfig = {
    dadosDemo: process.env.DADOS_DEMO === 'true',
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '127.0.0.1',
    databaseUrl: process.env.DATABASE_URL || null,
    // Banco único em .data/pglite (PGLITE_DIR existe só para o banco descartável dos testes E2E).
    pgliteDir: resolve(import.meta.dirname, '../..', process.env.PGLITE_DIR || '.data/pglite'),
    cookieSecret,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
    timerSpeed: Math.max(1, requestedSpeed),
    countdownSeconds: Math.min(30, Math.max(0, Number(process.env.COUNTDOWN_SECONDS || 10) || 0)),
    defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'America/Sao_Paulo',
    webDist: existsSync(webDist) ? webDist : null,
  };
  return { ...base, ...overrides };
}
