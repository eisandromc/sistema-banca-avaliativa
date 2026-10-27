import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: sobe o servidor com banco PGlite descartável, servindo o build do frontend (web/dist)
 * e com o cronômetro acelerado 60x (TIMER_SPEED — só permitido fora de produção).
 * Pré-requisito: `npm run build -w web`.
 */
const PORT = 3200;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), TIMER_SPEED: '60' },
  },
});
