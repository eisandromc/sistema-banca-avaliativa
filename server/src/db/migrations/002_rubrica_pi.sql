-- Formato de banca do Projeto Integrador: identidade do documento, local concatenado,
-- soma das pontuações, parecer da banca e metadados das rubricas por avaliador.

alter table events
  add column institution_detail text,
  add column report_purpose text,
  add column report_guidance text,
  add column school_location text,
  add column location_format text not null default '{sala} — {escola}',
  add column aggregation text not null default 'mean' check (aggregation in ('mean', 'sum')),
  add column verdict_options jsonb not null default '[]',
  add column logo_data_url text check (logo_data_url is null or logo_data_url ~ '^data:image/(png|jpeg);base64,');

alter table rubric_versions
  add column evaluator_role text,
  add column dimension text,
  add column dimension_short text,
  add column feedback_label text,
  add column scale_labels jsonb not null default '[]',
  add column sort_order int not null default 0;

-- Parecer consolidado da banca (um por grupo), preenchido na conferência e congelado no fechamento.
create table group_verdicts (
  group_id int primary key references groups(id) on delete cascade,
  verdict text,
  strengths text,
  improvements text,
  guidance text,
  updated_by int references users(id),
  updated_at timestamptz not null default now()
);
