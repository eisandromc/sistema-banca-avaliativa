-- Lixeira: exclusão lógica. deleted_at = na lixeira (pode ser restaurado);
-- purged_at = excluído definitivamente (não aparece nem pode ser restaurado pela plataforma).
alter table events add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table event_days add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table time_profiles add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table groups add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table group_files add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table rubric_types add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table rubric_versions add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
alter table vote_questions add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;

alter table group_files add column id int generated always as identity;

-- Itens na lixeira não podem bloquear o reaproveitamento de código/nome.
alter table groups drop constraint groups_code_uq;
create unique index groups_code_uq on groups (event_id, code) where deleted_at is null;
drop index rubric_types_name_uq;
create unique index rubric_types_name_uq on rubric_types (lower(name)) where deleted_at is null;
