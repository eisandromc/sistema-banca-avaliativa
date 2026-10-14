import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { createDatabase } from './db/database.ts';
import { migrate } from './db/migrate.ts';
import { seedDemo, seedPiDemo, DEMO_PASSWORD } from './db/seed.ts';
import { installPiRubrics } from './templates/projetoIntegrador.ts';
import { seedScenarios } from './db/scenarios.ts';
import { enrichDemoData } from './db/demoMaterials.ts';

const config = loadConfig();
const db = await createDatabase(config);
await migrate(db, (m) => console.log(m));
if (config.env !== 'production') {
  const r = await seedDemo(db);
  if (!r.skipped) console.log(`Seed de DEMONSTRAÇÃO criado (dados fictícios). Senha das contas demo: ${DEMO_PASSWORD}`);
  const pi = await seedPiDemo(db);
  if (!pi.skipped) console.log('Demonstração da banca do Projeto Integrador criada (dados fictícios, 2 dias com escalas diferentes).');
  if (process.env.SEED_SCENARIOS !== '0') {
    const sc = await seedScenarios(db);
    if (!sc.skipped) console.log('Banca de cenários de teste criada (dados fictícios: um grupo em cada situação do processo).');
  }
}
// Rubricas do Projeto Integrador sempre disponíveis (instalação idempotente).
await db.tx((q) => installPiRubrics(q));
// Demonstração: tipos de rubrica, resumo, orientadores e materiais fictícios (só preenche o que está vazio).
if (config.env !== 'production') await enrichDemoData(db);

const app = await buildApp(config, { db });
app.addHook('onClose', async () => db.close());

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
console.log(
  `Servidor em http://${config.host}:${config.port} — banco: ${db.kind}${config.timerSpeed !== 1 ? ` — MODO DE TESTE: cronômetro acelerado ${config.timerSpeed}x` : ''}`,
);
