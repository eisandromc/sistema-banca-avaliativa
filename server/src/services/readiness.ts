import type { Queryable } from '../db/database.ts';
import { notFound } from '../http.ts';
import { getDaySchedule, resolveAssignments } from './schedule.ts';

/** Situação de um item do roteiro: pronto, atenção (funciona, mas convém revisar) ou pendente (impede a banca). */
export type CheckStatus = 'ok' | 'warn' | 'todo';

export interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Aba da Configuração onde o item é resolvido. */
  tab: string;
}

export interface DayReadiness {
  dayId: number;
  label: string;
  date: string;
  room: string | null;
  checks: ReadinessCheck[];
  progress: { total: number; started: number; finalized: number; running: boolean };
  /** Dia em exibição no telão. */
  displayActive: boolean;
}

export interface EventReadiness {
  eventId: number;
  checks: ReadinessCheck[];
  days: DayReadiness[];
  summary: { ok: number; warn: number; todo: number; ready: boolean };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Roteiro de preparação de uma banca: o que já está pronto e o que falta, dia a dia. */
export async function eventReadiness(q: Queryable, eventId: number): Promise<EventReadiness> {
  const ev = await q.one<any>('select id, aggregation, verdict_options, school_location, rubric_type_id from events where id = $1', [eventId]);
  if (!ev) throw notFound('Banca não encontrada.');
  const days = await q.query<any>('select id, label, date, room, default_profile_id, primary_user_id, display_active_at from event_days where event_id = $1 and deleted_at is null order by date, id', [eventId]);
  const groups = await q.query<any>(
    `select g.id, g.code, (select count(*)::int from group_students s where s.group_id = g.id) as students,
            exists(select 1 from schedule_entries e where e.group_id = g.id) as scheduled
       from groups g where g.event_id = $1 and g.deleted_at is null order by g.code`,
    [eventId],
  );
  // Rubricas de um tipo que está na lixeira também contam como excluídas.
  const rubricCount = (await q.one<{ n: number }>(
    `select count(*)::int as n from rubric_versions v
      where v.deleted_at is null
        and not exists (select 1 from rubric_templates t join rubric_types ty on ty.id = t.type_id where t.id = v.template_id and ty.deleted_at is not null)`,
  ))!.n;
  const type = ev.rubric_type_id
    ? await q.one<{ name: string; n: number; deleted: boolean }>(
        'select t.name, (select count(*)::int from rubric_templates r where r.type_id = t.id) as n, (t.deleted_at is not null) as deleted from rubric_types t where t.id = $1',
        [ev.rubric_type_id],
      )
    : null;

  const checks: ReadinessCheck[] = [];
  checks.push(
    days.length
      ? { key: 'days', label: 'Dias da banca', status: 'ok', detail: plural(days.length, 'dia cadastrado', 'dias cadastrados'), tab: 'bancas' }
      : { key: 'days', label: 'Dias da banca', status: 'todo', detail: 'Cadastre ao menos um dia (data, horário e sala).', tab: 'bancas' },
  );
  const unscheduled = groups.filter((g) => !g.scheduled);
  const noStudents = groups.filter((g) => g.students === 0);
  checks.push(
    groups.length === 0
      ? { key: 'groups', label: 'Grupos e alunos', status: 'todo', detail: 'Cadastre os grupos e seus alunos.', tab: 'grupos' }
      : unscheduled.length
        ? {
            key: 'groups',
            label: 'Grupos e alunos',
            status: 'warn',
            detail: `${plural(unscheduled.length, 'grupo ainda sem dia', 'grupos ainda sem dia')}: ${unscheduled.map((g) => g.code).join(', ')}.`,
            tab: 'distribuicao',
          }
        : noStudents.length
          ? { key: 'groups', label: 'Grupos e alunos', status: 'warn', detail: `Sem alunos cadastrados: ${noStudents.map((g) => g.code).join(', ')}.`, tab: 'grupos' }
          : { key: 'groups', label: 'Grupos e alunos', status: 'ok', detail: `${plural(groups.length, 'grupo', 'grupos')}, todos no cronograma.`, tab: 'grupos' },
  );
  checks.push(
    !rubricCount
      ? { key: 'rubrics', label: 'Tipo de rubrica', status: 'todo', detail: 'Crie um tipo de rubrica com suas rubricas, ou instale o modelo do Projeto Integrador.', tab: 'rubricas' }
      : !type
        ? { key: 'rubrics', label: 'Tipo de rubrica', status: 'warn', detail: 'Vincule um tipo de rubrica à banca (Editar banca).', tab: 'bancas' }
        : type.deleted
          ? { key: 'rubrics', label: 'Tipo de rubrica', status: 'todo', detail: `O tipo "${type.name}" está na lixeira: vincule outro tipo à banca (Editar banca) ou restaure-o.`, tab: 'bancas' }
          : type.n === 0
            ? { key: 'rubrics', label: 'Tipo de rubrica', status: 'todo', detail: `O tipo "${type.name}" ainda não tem rubricas.`, tab: 'rubricas' }
            : { key: 'rubrics', label: 'Tipo de rubrica', status: 'ok', detail: `${type.name}: ${plural(type.n, 'rubrica', 'rubricas')}.`, tab: 'rubricas' },
  );
  const verdictOptions: string[] = Array.isArray(ev.verdict_options) ? ev.verdict_options : [];
  if (verdictOptions.length && !ev.school_location) {
    checks.push({ key: 'location', label: 'Local impresso', status: 'warn', detail: 'Defina o "Local da escola" em Editar banca para o PDF.', tab: 'bancas' });
  }

  const out: DayReadiness[] = [];
  for (const d of days) {
    const sched = await getDaySchedule(q, d.id);
    const dc: ReadinessCheck[] = [];
    const primary = d.primary_user_id ? await q.one<any>('select name, (active and deleted_at is null) as active, role from users where id = $1', [d.primary_user_id]) : null;
    dc.push(
      !primary
        ? { key: 'primary', label: 'Professor primário', status: 'todo', detail: 'Designe quem conduz o tempo e o fechamento.', tab: 'avaliadores' }
        : !primary.active || primary.role !== 'teacher'
          ? { key: 'primary', label: 'Professor primário', status: 'todo', detail: `${primary.name} está inativo(a) ou não é docente.`, tab: 'avaliadores' }
          : { key: 'primary', label: 'Professor primário', status: 'ok', detail: primary.name, tab: 'avaliadores' },
    );
    dc.push(
      sched.entries.length
        ? { key: 'schedule', label: 'Grupos no dia', status: 'ok', detail: plural(sched.entries.length, 'grupo', 'grupos'), tab: 'distribuicao' }
        : { key: 'schedule', label: 'Grupos no dia', status: 'todo', detail: 'Arraste os grupos para este dia (Distribuição nos dias).', tab: 'distribuicao' },
    );
    const noProfile = sched.entries.filter((e) => !e.effectiveProfileId);
    dc.push(
      noProfile.length || (!d.default_profile_id && sched.entries.length === 0)
        ? {
            key: 'profile',
            label: 'Perfil de tempo',
            status: 'todo',
            detail: noProfile.length ? `Sem perfil: ${noProfile.map((e) => e.code).join(', ')}.` : 'Defina o perfil de tempo padrão do dia.',
            tab: 'bancas',
          }
        : { key: 'profile', label: 'Perfil de tempo', status: 'ok', detail: 'Todos os grupos têm tempo definido.', tab: 'bancas' },
    );
    const timeWarnings = sched.warnings.filter((w) => !/perfil de tempo/i.test(w));
    dc.push(
      timeWarnings.length
        ? { key: 'timing', label: 'Horários', status: 'warn', detail: timeWarnings.join(' '), tab: 'distribuicao' }
        : {
            key: 'timing',
            label: 'Horários',
            status: 'ok',
            detail: sched.predictedEnd ? `Término previsto às ${sched.predictedEnd}.` : 'Sem conflitos.',
            tab: 'distribuicao',
          },
    );
    // Avaliadores: cada grupo precisa de ao menos um docente ativo designado.
    const without: string[] = [];
    const inactive = new Set<string>();
    for (const e of sched.entries) {
      const assigned = await resolveAssignments(q, d.id, e.groupId);
      if (!assigned.length) without.push(e.code);
      for (const a of assigned) {
        const u = await q.one<any>('select name, (active and deleted_at is null) as active, role from users where id = $1', [a.userId]);
        if (u && (!u.active || u.role !== 'teacher')) inactive.add(u.name);
      }
    }
    // Ficha atribuída que não existe no tipo de rubrica do grupo: o docente ficaria sem ficha nesse grupo.
    const missing = await q.query<{ code: string; p: number }>(
      `select g.code, a.rubric_position as p
         from schedule_entries se join groups g on g.id = se.group_id join events ev on ev.id = g.event_id
         join evaluator_assignments a on a.day_id = se.day_id and (a.group_id = g.id or a.group_id is null)
        where se.day_id = $1
          and not exists (select 1 from rubric_templates t join rubric_versions v on v.template_id = t.id
                           where t.type_id = coalesce(g.rubric_type_id, ev.rubric_type_id) and t.type_position = a.rubric_position and v.deleted_at is null)
        group by g.code, a.rubric_position order by g.code, a.rubric_position`,
      [d.id],
    );
    const dayAssignments = (await q.one<{ n: number }>('select count(distinct user_id)::int as n from evaluator_assignments where day_id = $1', [d.id]))!.n;
    dc.push(
      without.length
        ? { key: 'evaluators', label: 'Avaliadores', status: 'todo', detail: `Grupos sem avaliador: ${without.join(', ')}.`, tab: 'avaliadores' }
        : missing.length
          ? {
              key: 'evaluators',
              label: 'Avaliadores',
              status: 'todo',
              detail: `Ficha que não existe no tipo de rubrica do grupo: ${missing.map((m) => `${m.code} (${m.p}ª ficha)`).join(', ')}.`,
              tab: 'avaliadores',
            }
          : inactive.size
            ? { key: 'evaluators', label: 'Avaliadores', status: 'warn', detail: `Conta inativa ou sem perfil de professor: ${[...inactive].join(', ')}.`, tab: 'avaliadores' }
            : sched.entries.length
              ? { key: 'evaluators', label: 'Avaliadores', status: 'ok', detail: plural(dayAssignments, 'docente avaliador', 'docentes avaliadores'), tab: 'avaliadores' }
              : { key: 'evaluators', label: 'Avaliadores', status: 'todo', detail: 'Vincule os docentes às fichas deste dia.', tab: 'avaliadores' },
    );
    out.push({
      dayId: d.id,
      label: d.label,
      date: d.date,
      room: d.room,
      checks: dc,
      progress: {
        total: sched.entries.length,
        started: sched.entries.filter((e) => e.started).length,
        finalized: sched.entries.filter((e) => e.status === 'finalized').length,
        running: sched.entries.some((e) => e.status === 'running'),
      },
      displayActive: d.display_active_at !== null,
    });
  }

  const all = [...checks, ...out.flatMap((d) => d.checks)];
  const count = (s: CheckStatus) => all.filter((c) => c.status === s).length;
  return { eventId, checks, days: out, summary: { ok: count('ok'), warn: count('warn'), todo: count('todo'), ready: count('todo') === 0 } };
}
