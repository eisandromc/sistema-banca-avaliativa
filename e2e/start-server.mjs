// Inicia o servidor para os testes E2E com um banco PGlite novo (descartável) a cada execução.
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(root, '.data/e2e');
rmSync(dataDir, { recursive: true, force: true });

const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs');
const child = spawn(process.execPath, [tsx, 'src/index.ts'], {
  cwd: resolve(root, 'server'),
  stdio: 'inherit',
  env: { ...process.env, PGLITE_DIR: dataDir, HOST: '127.0.0.1' },
});
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
