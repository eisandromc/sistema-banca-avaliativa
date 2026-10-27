-- Listas vazias gravadas por engano como objeto vazio (`{}`) em colunas jsonb que guardam listas.
update events set verdict_options = '[]' where verdict_options = '{}'::jsonb;
update rubric_versions set scale_labels = '[]' where scale_labels = '{}'::jsonb;
update groups set advisors = '[]' where advisors = '{}'::jsonb;
update rubric_criteria set level_descriptors = '[]' where level_descriptors = '{}'::jsonb;
