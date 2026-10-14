import { loadConfig } from '../config.ts';
import { createDatabase } from './database.ts';
import { migrate } from './migrate.ts';
import { seedDemo, DEMO_PASSWORD, DEMO_USERS } from './seed.ts';

const cmd = process.argv[2];
const cfg = loadConfig();
const db = await createDatabase(cfg);
try {
  await migrate(db, (m) => console.log(m));
  if (cmd === 'migrate') {
    console.log(`Migrações em dia (${db.kind}).`);
  } else if (cmd === 'seed') {
    if (cfg.env === 'production' && !process.argv.includes('--allow-production')) {
      throw new Error('Seed de demonstração bloqueado em produção (use --allow-production conscientemente).');
    }
    const r = await seedDemo(db);
    if (r.skipped) console.log('Banco já possui usuários; seed de demonstração ignorado.');
    else {
      console.log('Seed de DEMONSTRAÇÃO (dados fictícios) criado. Contas (senha: %s):', DEMO_PASSWORD);
      for (const u of Object.values(DEMO_USERS)) console.log(`  - ${u.email} (${u.role})`);
    }
  } else {
    console.log('Uso: tsx src/db/cli.ts <migrate|seed>');
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
