import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  /** Única chave de ambiente: define o banco, as regras de produção e os dados de demonstração (só em TESTE). */
  ambiente: Ambiente;
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

/**
 * DESENVOLVIMENTO: banco local de trabalho, sem dados de demonstração.
 * TESTE: banco próprio com os dados de demonstração (contas, bancas e cenários fictícios).
 * PRODUCAO: só os dados cadastrados; exige COOKIE_SECRET e recusa a aceleração do cronômetro.
 */
export const AMBIENTES = ['DESENVOLVIMENTO', 'TESTE', 'PRODUCAO'] as const;
export type Ambiente = (typeof AMBIENTES)[number];

/** Pasta padrão do banco embutido por ambiente. */
const PGLITE_PADRAO: Record<Ambiente, string> = {
  DESENVOLVIMENTO: '.data/pglite',
  TESTE: '.data/pglite-teste',
  PRODUCAO: '.data/pglite-producao',
};

/** Lê AMBIENTE (DESENVOLVIMENTO | TESTE | PRODUCAO), obrigatório. */
function resolveAmbiente(): Ambiente {
  const raw = (process.env.AMBIENTE ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!raw) throw new Error(`Defina AMBIENTE no .env: ${AMBIENTES.join(', ')}.`);
  if (!(AMBIENTES as readonly string[]).includes(raw)) {
    throw new Error(`AMBIENTE inválido: "${process.env.AMBIENTE}". Use ${AMBIENTES.join(', ')}.`);
  }
  return raw as Ambiente;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnv();
  const ambiente = overrides.ambiente ?? resolveAmbiente();
  const production = ambiente === 'PRODUCAO';
  // Cada ambiente usa o seu próprio banco (DATABASE_URL_<AMBIENTE> ou, vazio, PGlite em PGLITE_DIR_<AMBIENTE>).
  const databaseUrl = process.env[`DATABASE_URL_${ambiente}`];
  const pgliteDir = process.env[`PGLITE_DIR_${ambiente}`] || PGLITE_PADRAO[ambiente];
  const cookieSecret = process.env.COOKIE_SECRET ?? 'dev-only-insecure-cookie-secret-0123456789';
  const requestedSpeed = Number(process.env.TIMER_SPEED ?? '1') || 1;

  if (production) {
    if (!process.env.COOKIE_SECRET || cookieSecret.length < 32) {
      throw new Error('COOKIE_SECRET obrigatório (mínimo 32 caracteres) em produção.');
    }
    if (requestedSpeed !== 1) {
      throw new Error('TIMER_SPEED (aceleração do cronômetro) só é permitido fora de produção.');
    }
  }

  const webDist = resolve(import.meta.dirname, '../../web/dist');
  const base: AppConfig = {
    ambiente,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '127.0.0.1',
    databaseUrl: databaseUrl || null,
    // Caminho relativo é resolvido a partir da raiz do repositório (o npm executa em server/).
    pgliteDir: resolve(import.meta.dirname, '../..', pgliteDir),
    cookieSecret,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
    timerSpeed: production ? 1 : Math.max(1, requestedSpeed),
    countdownSeconds: Math.min(30, Math.max(0, Number(process.env.COUNTDOWN_SECONDS || 10) || 0)),
    defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'America/Sao_Paulo',
    webDist: existsSync(webDist) ? webDist : null,
  };
  const cfg = { ...base, ...overrides };
  if (cfg.ambiente === 'PRODUCAO') cfg.timerSpeed = 1;
  return cfg;
}
