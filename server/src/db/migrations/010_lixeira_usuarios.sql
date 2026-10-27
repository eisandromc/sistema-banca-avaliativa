-- Lixeira também para usuários (professores etc.): exclusão lógica; o e-mail só é único entre usuários não excluídos.
alter table users add column deleted_at timestamptz, add column deleted_by int references users(id) on delete set null, add column purged_at timestamptz;
drop index if exists users_email_uq;
create unique index users_email_uq on users (lower(email)) where deleted_at is null;
