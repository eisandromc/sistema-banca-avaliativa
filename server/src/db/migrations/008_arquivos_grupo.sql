-- Materiais do grupo: link do repositório no GitHub e arquivos enviados (slides e artigo) guardados no banco.
alter table groups
  add column github_url text check (github_url is null or github_url ~ '^https?://');

create table group_files (
  group_id int not null references groups(id) on delete cascade,
  kind text not null check (kind in ('slides', 'article')),
  filename text not null,
  mime text not null,
  size int not null check (size > 0),
  data bytea not null,
  uploaded_by int references users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  primary key (group_id, kind)
);
