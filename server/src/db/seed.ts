import { GROUP_COLORS } from '../../../shared/groups.ts';
import type { Database } from './database.ts';
import { hashPassword } from '../auth/password.ts';

/**
 * Seed de DEMONSTRAÇÃO. Todos os nomes, e-mails e projetos são FICTÍCIOS.
 * Senha de todas as contas de demonstração: "demo1234" (troque/desative em uso real).
 */
export const DEMO_PASSWORD = 'demo1234';

export const DEMO_USERS = {
  admin: { name: 'Administração (Demonstração)', email: 'admin@demo.banca', role: 'admin' },
  ana: { name: 'Profa. Ana Exemplo (Demo)', email: 'ana@demo.banca', role: 'teacher' },
  bruno: { name: 'Prof. Bruno Modelo (Demo)', email: 'bruno@demo.banca', role: 'teacher' },
  carla: { name: 'Profa. Carla Fictícia (Demo)', email: 'carla@demo.banca', role: 'teacher' },
  telao: { name: 'Telão da Sala (Demo)', email: 'telao@demo.banca', role: 'viewer' },
} as const;

function todayIn(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // AAAA-MM-DD
}

export async function seedDemo(db: Database, opts: { force?: boolean; date?: string } = {}) {
  const existing = await db.one<{ n: number }>('select count(*)::int as n from users');
  if (existing!.n > 0 && !opts.force) return { skipped: true as const };

  return db.tx(async (q) => {
    const pw = await hashPassword(DEMO_PASSWORD);
    const ids: Record<string, number> = {};
    for (const [key, u] of Object.entries(DEMO_USERS)) {
      const r = await q.one<{ id: number }>('insert into users (name, email, role, password_hash) values ($1,$2,$3,$4) returning id', [u.name, u.email, u.role, pw]);
      ids[key] = r!.id;
    }

    const profile = await q.one<{ id: number }>("insert into time_profiles (name) values ('Padrão 10 + 5 + 5 (20 min)') returning id");
    const stages = [
      ['Apresentação', 600, '#2563eb'],
      ['Demonstração', 300, '#7c3aed'],
      ['Perguntas e considerações', 300, '#0f766e'],
    ] as const;
    for (let i = 0; i < stages.length; i++) {
      await q.query('insert into time_stages (profile_id, position, name, duration_seconds, color) values ($1,$2,$3,$4,$5)', [profile!.id, i, ...stages[i]!]);
    }

    const ev = await q.one<{ id: number }>(
      `insert into events (name, institution, period, report_header, report_subtitle, report_footer, show_student_names)
       values ($1, $2, $3, $4, $5, $6, false) returning id`,
      [
        'Banca de Projetos — DEMONSTRAÇÃO',
        'Instituição Fictícia de Demonstração',
        '2026/2',
        'Instituição Fictícia de Demonstração',
        'Banca de Projetos — DEMONSTRAÇÃO (dados fictícios)',
        'Documento de demonstração — dados fictícios',
      ],
    );
    const date = opts.date ?? todayIn('America/Sao_Paulo');
    const day = await q.one<{ id: number }>(
      `insert into event_days (event_id, label, date, start_time, end_time, room, gap_minutes, default_profile_id, primary_user_id)
       values ($1, 'Dia 1', $2, '07:30', '12:30', 'Sala Demo 101', 5, $3, $4) returning id`,
      [ev!.id, date, profile!.id, ids.ana],
    );
    await q.query("insert into breaks (day_id, label, start_time, end_time) values ($1, 'Intervalo', '10:00', '10:20')", [day!.id]);

    const groups = [
      { code: 'Grupo 01', className: '3º A (demo)', title: 'Horta Inteligente com Sensores (projeto fictício)', students: ['Estudante Fictício A1', 'Estudante Fictícia A2', 'Estudante Fictício A3'], advisor: 'Orientador Fictício' },
      { code: 'Grupo 02', className: '3º B (demo)', title: 'Aplicativo de Coleta Seletiva (projeto fictício)', students: ['Estudante Fictícia B1', 'Estudante Fictício B2'], advisor: null },
    ];
    let pos = 1;
    for (const g of groups) {
      const r = await q.one<{ id: number }>(
        'insert into groups (event_id, code, class_name, title, description, advisor, color) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [ev!.id, g.code, g.className, g.title, 'Descrição fictícia para demonstração do sistema.', g.advisor, GROUP_COLORS[pos - 1]],
      );
      let sp = 0;
      for (const name of g.students) {
        const s = await q.one<{ id: number }>('insert into students (name) values ($1) returning id', [name]);
        await q.query('insert into group_students (group_id, student_id, position) values ($1,$2,$3)', [r!.id, s!.id, sp++]);
      }
      await q.query('insert into schedule_entries (day_id, group_id, position) values ($1,$2,$3)', [day!.id, r!.id, pos++]);
    }

    const rubric = async (name: string, title: string, criteria: Array<[string, string, number, boolean, boolean]>) => {
      const t = await q.one<{ id: number }>('insert into rubric_templates (name, description) values ($1, $2) returning id', [name, 'Rubrica exemplificativa de demonstração.']);
      const v = await q.one<{ id: number }>(
        `insert into rubric_versions (template_id, version, title, instructions, scale_min, scale_max, scale_step)
         values ($1, 1, $2, 'Atribua notas de 0 a 10 (incrementos de 0,5). Zero é uma nota válida; deixe em branco apenas o que não avaliou.', 0, 10, 0.5) returning id`,
        [t!.id, title],
      );
      let i = 0;
      for (const [ct, cd, w, req, comment] of criteria) {
        await q.query(
          'insert into rubric_criteria (version_id, position, title, description, weight, required, comment_enabled) values ($1,$2,$3,$4,$5,$6,$7)',
          [v!.id, i++, ct, cd, w, req, comment],
        );
      }
      return v!.id;
    };
    const tecnica = await rubric('Rubrica Técnica (exemplo)', 'Avaliação técnica', [
      ['Domínio técnico', 'Conhecimento dos conceitos e das escolhas técnicas.', 3, true, true],
      ['Funcionamento da demonstração', 'O protótipo funciona como descrito.', 3, true, true],
      ['Organização do projeto', 'Planejamento, documentação e divisão de tarefas.', 2, true, false],
      ['Respostas às perguntas', 'Clareza e segurança nas respostas à banca.', 2, true, false],
    ]);
    const comunicacao = await rubric('Rubrica de Comunicação (exemplo)', 'Avaliação de comunicação', [
      ['Clareza da apresentação', 'Sequência lógica e linguagem adequada.', 2, true, true],
      ['Uso do tempo', 'Respeito às etapas e ao tempo total.', 1, true, false],
      ['Material visual', 'Slides/cartazes legíveis e pertinentes (opcional).', 1, false, false],
    ]);
    await q.query('insert into evaluator_assignments (day_id, user_id, rubric_version_id) values ($1,$2,$3),($1,$4,$3),($1,$5,$6)', [
      day!.id,
      ids.ana,
      tecnica,
      ids.bruno,
      ids.carla,
      comunicacao,
    ]);

    const vq = await q.one<{ id: number }>(
      `insert into vote_questions (event_id, title, prompt, enabled, required, allow_abstain, rule)
       values ($1, 'Indicação para a feira', 'Você indica este projeto para a feira de ciências?', true, true, true, 'simple_majority') returning id`,
      [ev!.id],
    );
    await q.query("insert into vote_options (question_id, position, label, is_abstain) values ($1,0,'Indicar',false),($1,1,'Não indicar',false),($1,2,'Abster-se',true)", [vq!.id]);

    await q.query("insert into audit_logs (action, entity, details) values ('seed.demo', 'system', $1)", [{ note: 'Dados fictícios de demonstração', date }]);
    return { skipped: false as const, eventId: ev!.id, dayId: day!.id, users: ids, profileId: profile!.id, rubrics: { tecnica, comunicacao } };
  });
}

/**
 * Demonstração da banca do Projeto Integrador (dados FICTÍCIOS): dois dias com escalas diferentes,
 * mostrando que os professores podem se repetir ou não entre os dias e mudar de rubrica/papel.
 */
export const PI_DEMO_EVENT = 'Banca do Projeto Integrador — DEMONSTRAÇÃO';

export async function seedPiDemo(db: Database, opts: { date?: string } = {}) {
  if (await db.one('select 1 from events where name = $1', [PI_DEMO_EVENT])) return { skipped: true as const };
  const { installPiRubrics, applyPiEventConfig } = await import('../templates/projetoIntegrador.ts');
  return db.tx(async (q) => {
    const [tecnico, artigo, pi, apresentacao] = await installPiRubrics(q);
    const pw = await hashPassword(DEMO_PASSWORD);
    const user = async (name: string, email: string) => {
      const u = await q.one<{ id: number }>('select id from users where lower(email) = $1', [email]);
      if (u) return u.id;
      return (await q.one<{ id: number }>("insert into users (name, email, role, password_hash) values ($1, $2, 'teacher', $3) returning id", [name, email, pw]))!.id;
    };
    const ana = await user(DEMO_USERS.ana.name, DEMO_USERS.ana.email);
    const bruno = await user(DEMO_USERS.bruno.name, DEMO_USERS.bruno.email);
    const carla = await user(DEMO_USERS.carla.name, DEMO_USERS.carla.email);
    const daniel = await user('Prof. Daniel Exemplo (Demo)', 'daniel@demo.banca');
    const elisa = await user('Profa. Elisa Modelo (Demo)', 'elisa@demo.banca');

    const profile =
      (await q.one<{ id: number }>("select id from time_profiles where name like 'Padrão 10 + 5 + 5%' order by id limit 1"))?.id ??
      (await (async () => {
        const p = await q.one<{ id: number }>("insert into time_profiles (name) values ('Padrão 10 + 5 + 5 (20 min)') returning id");
        await q.query(
          "insert into time_stages (profile_id, position, name, duration_seconds, color) values ($1,0,'Apresentação',600,'#2563eb'),($1,1,'Demonstração',300,'#7c3aed'),($1,2,'Perguntas e considerações',300,'#0f766e')",
          [p!.id],
        );
        return p!.id;
      })());

    const ev = await q.one<{ id: number }>("insert into events (name, period, school_location) values ($1, '2026/2', $2) returning id", [
      PI_DEMO_EVENT,
      'Escola Fictícia de Demonstração — Rua Exemplo, 100',
    ]);
    await applyPiEventConfig(q, ev!.id);

    const base = opts.date ?? todayIn('America/Sao_Paulo');
    const next = new Date(`${base}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const date2 = next.toISOString().slice(0, 10);

    const day = async (label: string, date: string, room: string, primary: number) =>
      (await q.one<{ id: number }>(
        `insert into event_days (event_id, label, date, start_time, end_time, room, gap_minutes, default_profile_id, primary_user_id)
         values ($1, $2, $3, '13:30', '17:30', $4, 5, $5, $6) returning id`,
        [ev!.id, label, date, room, profile, primary],
      ))!.id;
    const d1 = await day('Dia 1', base, 'Sala 201', ana);
    const d2 = await day('Dia 2', date2, 'Laboratório 3', bruno);
    await q.query("insert into breaks (day_id, label, start_time, end_time) values ($1, 'Intervalo', '15:20', '15:40'), ($2, 'Intervalo', '15:20', '15:40')", [d1, d2]);

    // Escala do Dia 1 (Ana conduz e avalia o conteúdo técnico).
    const assign = async (d: number, u: number, v: number) =>
      q.query('insert into evaluator_assignments (day_id, user_id, rubric_version_id) values ($1, $2, $3)', [d, u, v]);
    await assign(d1, ana, tecnico!);
    await assign(d1, bruno, artigo!);
    await assign(d1, carla, pi!);
    await assign(d1, daniel, apresentacao!);
    // Escala do Dia 2: outra configuração (Bruno conduz; Ana muda de dimensão; Carla não participa; Elisa entra).
    await assign(d2, bruno, tecnico!);
    await assign(d2, elisa, artigo!);
    await assign(d2, ana, pi!);
    await assign(d2, daniel, apresentacao!);

    const groups: Array<[number, string, string, string, string[]]> = [
      [d1, 'PI-01', '2º A (demo)', 'Plataforma de Monitoramento de Hortas Escolares (fictício)', ['Estudante Fictício C1', 'Estudante Fictícia C2', 'Estudante Fictício C3']],
      [d1, 'PI-02', '2º B (demo)', 'Aplicativo de Carona Solidária Escolar (fictício)', ['Estudante Fictícia D1', 'Estudante Fictício D2']],
      [d2, 'PI-03', '3º A (demo)', 'Sistema de Agendamento da Biblioteca (fictício)', ['Estudante Fictício E1', 'Estudante Fictícia E2', 'Estudante Fictício E3']],
    ];
    const pos: Record<number, number> = {};
    for (const [d, code, cls, title, students] of groups) {
      const g = await q.one<{ id: number }>('insert into groups (event_id, code, class_name, title, description, color) values ($1,$2,$3,$4,$5,$6) returning id', [
        ev!.id,
        code,
        cls,
        title,
        'Projeto Integrador fictício para demonstração.',
        GROUP_COLORS[groups.findIndex((x) => x[1] === code) % GROUP_COLORS.length],
      ]);
      let i = 0;
      for (const n of students) {
        const s = await q.one<{ id: number }>('insert into students (name) values ($1) returning id', [n]);
        await q.query('insert into group_students (group_id, student_id, position) values ($1,$2,$3)', [g!.id, s!.id, i++]);
      }
      pos[d] = (pos[d] ?? 0) + 1;
      await q.query('insert into schedule_entries (day_id, group_id, position) values ($1,$2,$3)', [d, g!.id, pos[d]]);
    }
    await q.query("insert into audit_logs (action, entity, details) values ('seed.pi_demo', 'system', $1)", [{ note: 'Banca PI fictícia de demonstração' }]);
    return { skipped: false as const, eventId: ev!.id, days: [d1, d2] };
  });
}
