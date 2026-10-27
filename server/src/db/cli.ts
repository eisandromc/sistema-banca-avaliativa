import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.ts';
import { createDatabase } from './database.ts';
import { migrate } from './migrate.ts';
import { hashPassword } from '../auth/password.ts';

/**
 * migrate                 aplica as migrações do banco do AMBIENTE;
 * admin <e-mail> <nome>   cria uma conta de administrador (ex.: a primeira, em PRODUCAO); a senha é pedida no terminal.
 * Os dados de demonstração não têm comando próprio: o servidor os cria ao iniciar com AMBIENTE=TESTE.
 */
const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();
const db = await createDatabase(cfg);
try {
  if (cmd === 'migrate') {
    await migrate(db, (m) => console.log(m));
    console.log(`Migrações em dia (${cfg.ambiente}, ${db.kind}).`);
  } else if (cmd === 'admin') {
    const [email, ...nameParts] = args;
    const name = nameParts.join(' ').trim();
    if (!email?.includes('@') || !name) throw new Error('Uso: npm run db:admin -- <e-mail> <nome completo>');
    await migrate(db);
    if (await db.one('select 1 from users where lower(email) = lower($1) and deleted_at is null', [email])) throw new Error(`Já existe uma conta com o e-mail ${email}.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const password = await rl.question('Senha (mínimo de 8 caracteres): ');
    rl.close();
    if (password.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres.');
    await db.query("insert into users (name, email, role, password_hash) values ($1, $2, 'admin', $3)", [name, email, await hashPassword(password)]);
    console.log(`Administrador ${email} criado (${cfg.ambiente}).`);
  } else {
    console.log('Uso: tsx src/db/cli.ts migrate | admin <e-mail> <nome>');
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
