import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

/** Ambiente único: um só banco e as mesmas regras sempre; só os dados de demonstração são opcionais (DADOS_DEMO). */
const KEYS = ['COOKIE_SECRET', 'TIMER_SPEED', 'COUNTDOWN_SECONDS', 'DATABASE_URL', 'PGLITE_DIR', 'DADOS_DEMO'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
// Valor vazio já definido impede o .env local de preencher a variável.
const env = (vars: Record<string, string>) => {
  for (const k of KEYS) process.env[k] = '';
  Object.assign(process.env, vars);
};
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const SECRET = 'x'.repeat(32);

describe('configuração (ambiente único)', () => {
  it('exige COOKIE_SECRET com ao menos 32 caracteres', () => {
    env({});
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET/);
    env({ COOKIE_SECRET: 'curto' });
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET/);
    env({ COOKIE_SECRET: SECRET });
    expect(loadConfig().cookieSecret).toBe(SECRET);
  });

  it('um só banco: PGlite em .data/pglite ou, se definido, o PostgreSQL de DATABASE_URL', () => {
    env({ COOKIE_SECRET: SECRET });
    expect(loadConfig()).toMatchObject({ databaseUrl: null });
    expect(loadConfig().pgliteDir).toMatch(/\.data\/pglite$/);
    env({ COOKIE_SECRET: SECRET, DATABASE_URL: 'postgres://h/db' });
    expect(loadConfig().databaseUrl).toBe('postgres://h/db');
  });

  it('dados de demonstração só com DADOS_DEMO=true', () => {
    env({ COOKIE_SECRET: SECRET });
    expect(loadConfig().dadosDemo).toBe(false);
    env({ COOKIE_SECRET: SECRET, DADOS_DEMO: 'true' });
    expect(loadConfig().dadosDemo).toBe(true);
  });

  it('TIMER_SPEED e COUNTDOWN_SECONDS seguem o que foi definido', () => {
    env({ COOKIE_SECRET: SECRET });
    expect(loadConfig()).toMatchObject({ timerSpeed: 1, countdownSeconds: 10 });
    env({ COOKIE_SECRET: SECRET, TIMER_SPEED: '60' });
    expect(loadConfig().timerSpeed).toBe(60);
  });
});
