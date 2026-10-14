-- Esquema inicial do Sistema de Gestão de Bancas.
-- Carimbos de tempo em timestamptz (UTC internamente); horários de agenda como "HH:MM" no fuso do evento.

create table users (
  id int generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  email text not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'teacher', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table auth_sessions (
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_sessions_user_idx on auth_sessions (user_id);

create table events (
  id int generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  institution text,
  period text,
  timezone text not null default 'America/Sao_Paulo',
  report_header text,
  report_subtitle text,
  report_footer text,
  report_color text not null default '#1f3a5f' check (report_color ~ '^#[0-9a-fA-F]{6}$'),
  show_student_names boolean not null default false,
  public_display boolean not null default true,
  warn_pct int not null default 50,
  danger_pct int not null default 20,
  edit_after_submit text not null default 'locked' check (edit_after_submit in ('locked', 'until_closure')),
  vote_privacy text not null default 'nominal' check (vote_privacy in ('nominal', 'anonymous')),
  created_at timestamptz not null default now(),
  constraint events_thresholds_ck check (warn_pct between 2 and 99 and danger_pct between 1 and 98 and danger_pct < warn_pct)
);

create table time_profiles (
  id int generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table time_stages (
  id int generated always as identity primary key,
  profile_id int not null references time_profiles(id) on delete cascade,
  position int not null,
  name text not null check (length(trim(name)) > 0),
  duration_seconds int not null check (duration_seconds > 0 and duration_seconds <= 86400),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint time_stages_pos_uq unique (profile_id, position) deferrable initially deferred
);

create table event_days (
  id int generated always as identity primary key,
  event_id int not null references events(id) on delete cascade,
  label text not null default '',
  date date not null,
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  room text,
  gap_minutes int not null default 5 check (gap_minutes between 0 and 120),
  default_profile_id int references time_profiles(id) on delete set null,
  primary_user_id int references users(id) on delete set null,
  current_entry_id int,
  created_at timestamptz not null default now(),
  constraint event_days_hours_ck check (end_time > start_time)
);
create index event_days_event_idx on event_days (event_id, date);

create table breaks (
  id int generated always as identity primary key,
  day_id int not null references event_days(id) on delete cascade,
  label text not null default 'Intervalo',
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint breaks_hours_ck check (end_time > start_time)
);
create index breaks_day_idx on breaks (day_id);

create table groups (
  id int generated always as identity primary key,
  event_id int not null references events(id) on delete cascade,
  code text not null check (length(trim(code)) > 0),
  class_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  description text,
  advisor text,
  created_at timestamptz not null default now(),
  constraint groups_code_uq unique (event_id, code)
);

create table students (
  id int generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table group_students (
  group_id int not null references groups(id) on delete cascade,
  student_id int not null references students(id) on delete cascade,
  position int not null default 0,
  primary key (group_id, student_id)
);

-- Uma entrada de agenda por grupo: o mesmo grupo não pode estar em duas apresentações.
create table schedule_entries (
  id int generated always as identity primary key,
  day_id int not null references event_days(id) on delete cascade,
  group_id int not null references groups(id) on delete cascade,
  position int not null,
  time_profile_id int references time_profiles(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint schedule_entries_group_uq unique (group_id),
  constraint schedule_entries_pos_uq unique (day_id, position) deferrable initially deferred
);

alter table event_days
  add constraint event_days_current_entry_fk foreign key (current_entry_id) references schedule_entries(id) on delete set null;

create table rubric_templates (
  id int generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  description text,
  created_at timestamptz not null default now()
);

create table rubric_versions (
  id int generated always as identity primary key,
  template_id int not null references rubric_templates(id) on delete cascade,
  version int not null,
  title text not null check (length(trim(title)) > 0),
  instructions text,
  scale_min numeric(8, 3) not null default 0,
  scale_max numeric(8, 3) not null default 10,
  scale_step numeric(8, 3) not null default 0.5 check (scale_step > 0),
  normalization text check (normalization in ('linear')),
  general_comment_required boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rubric_versions_uq unique (template_id, version),
  constraint rubric_versions_scale_ck check (scale_max > scale_min)
);

create table rubric_criteria (
  id int generated always as identity primary key,
  version_id int not null references rubric_versions(id) on delete cascade,
  position int not null,
  title text not null check (length(trim(title)) > 0),
  description text,
  weight numeric(8, 3) not null check (weight > 0),
  required boolean not null default true,
  comment_enabled boolean not null default false,
  comment_required boolean not null default false,
  constraint rubric_criteria_pos_uq unique (version_id, position) deferrable initially deferred
);

-- Atribuição docente ↔ dia (todos os grupos) ou ↔ grupo específico (sobrescreve a do dia).
create table evaluator_assignments (
  id int generated always as identity primary key,
  day_id int not null references event_days(id) on delete cascade,
  user_id int not null references users(id) on delete cascade,
  group_id int references groups(id) on delete cascade,
  rubric_version_id int not null references rubric_versions(id),
  created_at timestamptz not null default now()
);
create unique index evaluator_assignments_uq on evaluator_assignments (day_id, user_id, coalesce(group_id, 0));
create index evaluator_assignments_user_idx on evaluator_assignments (user_id);

create table timer_sessions (
  id int generated always as identity primary key,
  entry_id int not null references schedule_entries(id) on delete cascade,
  day_id int not null references event_days(id) on delete cascade,
  status text not null check (status in ('running', 'paused', 'ended', 'stopped')),
  stages jsonb not null,
  speed double precision not null default 1,
  accumulated_ms double precision not null default 0,
  running_since timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by int references users(id),
  superseded boolean not null default false,
  revision int not null default 1
);
-- Um único cronômetro ativo por sessão/dia e uma única sessão vigente por apresentação.
create unique index timer_sessions_one_active_per_day on timer_sessions (day_id) where status in ('running', 'paused');
create unique index timer_sessions_one_per_entry on timer_sessions (entry_id) where not superseded;

create table timer_events (
  id int generated always as identity primary key,
  session_id int not null references timer_sessions(id) on delete cascade,
  type text not null,
  actor_id int references users(id),
  at timestamptz not null default now(),
  elapsed_ms double precision not null default 0,
  details jsonb
);
create index timer_events_session_idx on timer_events (session_id, at);

create table evaluations (
  id int generated always as identity primary key,
  entry_id int not null references schedule_entries(id) on delete cascade,
  group_id int not null references groups(id) on delete cascade,
  user_id int not null references users(id),
  rubric_version_id int not null references rubric_versions(id),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  general_comment text,
  revision int not null default 1,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  constraint evaluations_uq unique (group_id, user_id)
);
create index evaluations_user_idx on evaluations (user_id);

create table evaluation_scores (
  evaluation_id int not null references evaluations(id) on delete cascade,
  criterion_id int not null references rubric_criteria(id),
  score numeric(8, 3),
  comment text,
  primary key (evaluation_id, criterion_id)
);

create table vote_questions (
  id int generated always as identity primary key,
  event_id int not null references events(id) on delete cascade,
  position int not null default 0,
  title text not null check (length(trim(title)) > 0),
  prompt text not null check (length(trim(prompt)) > 0),
  enabled boolean not null default true,
  required boolean not null default true,
  allow_abstain boolean not null default true,
  rule text not null default 'simple_majority' check (rule in ('simple_majority', 'quorum', 'counts_only')),
  quorum_min int check (quorum_min is null or quorum_min > 0),
  created_at timestamptz not null default now()
);

create table vote_options (
  id int generated always as identity primary key,
  question_id int not null references vote_questions(id) on delete cascade,
  position int not null,
  label text not null check (length(trim(label)) > 0),
  is_abstain boolean not null default false
);

-- Um voto por docente (avaliação) e pergunta: impede duplicidade.
create table votes (
  id int generated always as identity primary key,
  evaluation_id int not null references evaluations(id) on delete cascade,
  question_id int not null references vote_questions(id) on delete cascade,
  option_id int not null references vote_options(id),
  updated_at timestamptz not null default now(),
  constraint votes_uq unique (evaluation_id, question_id)
);

create table closure_exceptions (
  id int generated always as identity primary key,
  group_id int not null references groups(id) on delete cascade,
  kind text not null check (kind in ('evaluator_absent', 'criterion_waived')),
  evaluation_id int not null references evaluations(id) on delete cascade,
  criterion_id int references rubric_criteria(id),
  reason text not null check (length(trim(reason)) >= 5),
  created_by int not null references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint closure_exceptions_kind_ck check ((kind = 'criterion_waived') = (criterion_id is not null))
);
create index closure_exceptions_group_idx on closure_exceptions (group_id);

create table evaluation_closures (
  id int generated always as identity primary key,
  group_id int not null references groups(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  final_score double precision,
  closed_by int not null references users(id),
  closed_at timestamptz not null default now(),
  reopened_by int references users(id),
  reopened_at timestamptz,
  reopen_reason text,
  constraint evaluation_closures_uq unique (group_id, version)
);
-- No máximo um fechamento vigente (não reaberto) por grupo.
create unique index evaluation_closures_one_open on evaluation_closures (group_id) where reopened_at is null;

create table audit_logs (
  id int generated always as identity primary key,
  actor_id int references users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  at timestamptz not null default now()
);
create index audit_logs_at_idx on audit_logs (at desc);
create index audit_logs_entity_idx on audit_logs (entity, entity_id);
