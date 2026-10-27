import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

/** AMBIENTE é a única chave de ambiente: escolhe o banco e as regras; dados de demonstração só em TESTE (index.ts). */
const KEYS = ['AMBIENTE', 'COOKIE_SECRET', 'TIMER_SPEED', 'COUNTDOWN_SECONDS', 'DATABASE_URL_PRODUCAO', 'PGLITE_DIR_TESTE'];
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

describe('AMBIENTE', () => {
  it('é obrigatório e só aceita os três valores', () => {
    env({});
    expect(() => loadConfig()).toThrow(/Defina AMBIENTE/);
    env({ AMBIENTE: 'producao-x' });
    expect(() => loadConfig()).toThrow(/AMBIENTE inválido/);
    env({ AMBIENTE: 'teste' });
    expect(loadConfig().ambiente).toBe('TESTE');
  });

  it('cada ambiente usa o próprio banco', () => {
    env({ AMBIENTE: 'TESTE', PGLITE_DIR_TESTE: '.data/outro' });
    expect(loadConfig().pgliteDir).toMatch(/\.data\/outro$/);
    env({ AMBIENTE: 'PRODUCAO', COOKIE_SECRET: 'x'.repeat(32), DATABASE_URL_PRODUCAO: 'postgres://h/db' });
    expect(loadConfig().databaseUrl).toBe('postgres://h/db');
  });

  it('PRODUCAO exige COOKIE_SECRET e recusa a aceleração; TESTE usa os mesmos padrões de uso real', () => {
    env({ AMBIENTE: 'PRODUCAO' });
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET/);
    env({ AMBIENTE: 'PRODUCAO', COOKIE_SECRET: 'x'.repeat(32), TIMER_SPEED: '60' });
    expect(() => loadConfig()).toThrow(/TIMER_SPEED/);
    env({ AMBIENTE: 'TESTE', TIMER_SPEED: '60' });
    expect(loadConfig()).toMatchObject({ timerSpeed: 60, countdownSeconds: 10 });
  });
});
