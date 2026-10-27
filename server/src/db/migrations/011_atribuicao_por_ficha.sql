-- A rubrica deixa de ser escolhida duas vezes: a banca (ou o grupo) define o tipo de rubrica e a atribuição
-- do professor guarda apenas QUAL FICHA do tipo ele preenche (posição 1, 2, 3…). A versão usada em cada
-- ficha nova é a mais recente daquela posição no tipo do grupo; fichas já abertas mantêm a própria versão.

alter table evaluator_assignments add column rubric_position int;

-- 1. Banca sem tipo adota o tipo mais usado nas suas atribuições.
update events e set rubric_type_id = x.type_id
  from (
    select distinct on (d.event_id) d.event_id, t.type_id
      from evaluator_assignments a
      join event_days d on d.id = a.day_id
      join rubric_versions v on v.id = a.rubric_version_id
      join rubric_templates t on t.id = v.template_id
     where t.type_id is not null
     group by d.event_id, t.type_id
     order by d.event_id, count(*) desc, t.type_id
  ) x
 where e.id = x.event_id and e.rubric_type_id is null;

-- 2. Rubricas sem tipo que estavam atribuídas entram no tipo da banca (na próxima posição);
--    banca ainda sem tipo ganha um tipo próprio com essas rubricas.
do $$
declare
  r record;
  tid int;
begin
  for r in
    select distinct d.event_id, v.template_id, e.name as event_name
      from evaluator_assignments a
      join event_days d on d.id = a.day_id
      join events e on e.id = d.event_id
      join rubric_versions v on v.id = a.rubric_version_id
      join rubric_templates t on t.id = v.template_id
     where t.type_id is null
     order by d.event_id, v.template_id
  loop
    continue when (select type_id from rubric_templates where id = r.template_id) is not null;
    select rubric_type_id into tid from events where id = r.event_id;
    if tid is null then
      insert into rubric_types (name, description)
           values ('Rubricas — ' || r.event_name || ' (#' || r.event_id || ')', 'Criado automaticamente com as rubricas que a banca já usava.')
        returning id into tid;
      update events set rubric_type_id = tid where id = r.event_id;
    end if;
    update rubric_templates
       set type_id = tid,
           type_position = (select coalesce(max(type_position), 0) + 1 from rubric_templates where type_id = tid)
     where id = r.template_id;
  end loop;
end $$;

-- Posição 0 (valor padrão antigo) não identifica ficha: vai para o fim do tipo.
update rubric_templates t
   set type_position = x.p
  from (
    select id, (select coalesce(max(type_position), 0) from rubric_templates m where m.type_id = r.type_id)
               + row_number() over (partition by type_id order by id) as p
      from rubric_templates r
     where type_id is not null and type_position <= 0
  ) x
 where t.id = x.id;

-- 3. Cada atribuição passa a apontar a ficha (posição dentro do tipo).
update evaluator_assignments a
   set rubric_position = t.type_position
  from rubric_versions v
  join rubric_templates t on t.id = v.template_id
 where v.id = a.rubric_version_id;

alter table evaluator_assignments
  alter column rubric_position set not null,
  add constraint evaluator_assignments_position_ck check (rubric_position > 0),
  drop column rubric_version_id;
