-- Rubrica analítica: texto orientador de cada nível da escala, por critério ([{value, text}]).
alter table rubric_criteria add column level_descriptors jsonb not null default '[]';
