-- Tipos de rubrica, materiais do projeto e cor de identificação dos grupos.

-- Tipo de rubrica: um conjunto de rubricas (ex.: "Projeto Integrador" com 4 fichas) vinculado à banca.
create table rubric_types (
  id int generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  description text,
  created_at timestamptz not null default now()
);
create unique index rubric_types_name_uq on rubric_types (lower(name));

-- Cada rubrica (modelo) pertence a no máximo um tipo; a posição define a ordem dentro do tipo
-- e é usada para equivaler rubricas de tipos diferentes (1ª ↔ 1ª, 2ª ↔ 2ª…).
alter table rubric_templates
  add column type_id int references rubric_types(id) on delete set null,
  add column type_position int not null default 0;

-- Tipo de rubrica padrão da banca; o grupo pode usar outro tipo.
alter table events add column rubric_type_id int references rubric_types(id) on delete set null;

alter table groups
  add column advisors jsonb not null default '[]',
  add column project_url text check (project_url is null or project_url ~ '^https?://'),
  add column pdf_url text check (pdf_url is null or pdf_url ~ '^(https?://|/)'),
  add column slides_url text check (slides_url is null or slides_url ~ '^(https?://|/)'),
  add column color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  add column rubric_type_id int references rubric_types(id) on delete set null;

-- O antigo campo único "orientador" vira o primeiro item da lista de orientadores.
update groups set advisors = jsonb_build_array(trim(advisor)) where advisor is not null and length(trim(advisor)) > 0;

-- Cores distintas para os grupos já cadastrados, na ordem do código dentro de cada banca.
update groups g
   set color = (array['#2563eb','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2','#db2777','#65a30d','#4f46e5','#b45309','#0d9488','#be123c'])[1 + ((x.rn - 1) % 12)::int]
  from (select id, row_number() over (partition by event_id order by code, id) as rn from groups) x
 where x.id = g.id;
