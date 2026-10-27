-- Etapas: pausa entre etapas (não numerada) e destaque na troca para a etapa.
alter table time_stages add column is_pause boolean not null default false;
alter table time_stages add column alert boolean not null default false;

-- Banca: janela do alerta de troca de etapa (segundos antes / depois de entrar na etapa destacada).
alter table events add column stage_alert_before_seconds int not null default 15 check (stage_alert_before_seconds between 0 and 120);
alter table events add column stage_alert_after_seconds int not null default 5 check (stage_alert_after_seconds between 0 and 60);

-- Perfis existentes: destaque na entrada da Demonstração…
update time_stages set alert = true where name ilike 'demonstra%';

-- …e pausa de 30 s para preparar os alunos entre a Demonstração e as Perguntas.
create temporary table _nova_pausa on commit drop as
  select d.profile_id, d.position
    from time_stages d
    join time_stages p on p.profile_id = d.profile_id and p.position = d.position + 1
   where d.name ilike 'demonstra%' and p.name ilike 'perguntas%';
update time_stages s set position = s.position + 1 from _nova_pausa t where s.profile_id = t.profile_id and s.position > t.position;
insert into time_stages (profile_id, position, name, duration_seconds, color, is_pause)
  select profile_id, position + 1, 'Pausa — preparação', 30, '#64748b', true from _nova_pausa;
