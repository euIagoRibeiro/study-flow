-- Seed das seleções (blocos S3a e S3b do dev_seed.sql) contra a conta à mão do comentário dele.
-- Só lê; dias relativos ao dia local de hoje
CREATE TEMP TABLE r (caso text, ok boolean, detalhe text);
CREATE TEMP VIEW s3s AS
  SELECT t.*, e.root_tag_id, e.completed_at,
         t.started_at AT TIME ZONE 'America/Sao_Paulo' AS ini_l,
         (now() AT TIME ZONE 'America/Sao_Paulo')::date - (t.started_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
  FROM time_entries t JOIN task_executions e ON e.id = t.task_execution_id
  WHERE substr(e.id::text, 25, 10) = '0000000022';
CREATE FUNCTION pg_temp.c(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS
  $$INSERT INTO r VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)$$;
CREATE FUNCTION pg_temp.ms(i interval) RETURNS text LANGUAGE sql AS
  $$SELECT (extract(epoch FROM i)::int / 60) || ':' || lpad((extract(epoch FROM i)::int % 60)::text, 2, '0')$$;

\o /dev/null
SELECT pg_temp.c('1. registros / sessões do bloco; total 159:05',
  (SELECT count(DISTINCT task_execution_id) || ' / ' || count(*) || ' ' || pg_temp.ms(sum(ended_at - started_at)) FROM s3s), '10 / 10 159:05');
SELECT pg_temp.c('2. por contexto: Desenho 94:30, Música 27:25, Tecnologia 19:50, Vestibular 17:20',
  (SELECT string_agg(n || '=' || m, ' ' ORDER BY n) FROM (
     SELECT g.name n, pg_temp.ms(sum(ended_at - started_at)) m
     FROM s3s JOIN tags g ON g.id = s3s.root_tag_id GROUP BY g.name) x),
  'Desenho=94:30 Música=27:25 Tecnologia=19:50 Vestibular=17:20');
SELECT pg_temp.c('3. dias locais: 4 ontem, 4 anteontem, 1 há 9 dias, 1 há 30',
  (SELECT string_agg(dias || '=' || n, ' ' ORDER BY dias) FROM (SELECT dias, count(*) n FROM s3s GROUP BY dias) x), '1=4 2=4 9=1 30=1');
SELECT pg_temp.c('4. nada hoje, nada nas semanas 7–12 (43 a 84 dias), tudo encerrado e antes de agora',
  (SELECT count(*) FILTER (WHERE dias = 0 OR dias BETWEEN 43 AND 84 OR ended_at IS NULL OR ended_at > now())::text FROM s3s), '0');
SELECT pg_temp.c('5. horários locais das anotações (início) e cada registro termina no fim da sessão',
  (SELECT string_agg(substr(task_execution_id::text, 33, 4) || ' ' || to_char(ini_l, 'HH24:MI'), ', ' ORDER BY task_execution_id)
          || ' ' || bool_and(completed_at = ended_at) FROM s3s),
  '2201 14:00, 2202 14:00, 2203 15:00, 2204 18:00, 2205 18:00, 2206 18:30, 2207 18:30, 2208 15:00, 2209 19:00, 2210 19:00 true');
SELECT pg_temp.c('6. fechamento: Perspectiva (nível 3) leva Fundamentos; Música sem subtag; total 8 ligações',
  (SELECT count(*) || ' ' || count(*) FILTER (WHERE substr(task_execution_id::text, 25, 12) = '000000002203') || ' '
          || count(*) FILTER (WHERE root_tag_id = '5eed0000-0000-4000-9000-000000000800')
   FROM task_execution_tags WHERE substr(task_execution_id::text, 25, 10) = '0000000022'), '8 2 0');
SELECT pg_temp.c('7. tarefas novas: Desenhar e Praticar guitarra, avulsas e ativas',
  (SELECT string_agg(title || ' ' || frequency || ' ' || active, ', ' ORDER BY title) FROM tasks
   WHERE id IN ('5eed0000-0000-4000-8000-000000000013', '5eed0000-0000-4000-8000-000000000014')),
  'Desenhar none true, Praticar guitarra none true');
SELECT pg_temp.c('8. seleções: opções em ordem; a Natureza é a única global; a Habilidade é a única múltipla',
  (SELECT string_agg(s.name || coalesce('@' || g.name, '@global') || ':' || (SELECT string_agg(o.name, ',' ORDER BY o.position) FROM selection_options o WHERE o.selection_id = s.id), ' ' ORDER BY s.name)
          || ' ' || string_agg(s.name, ',') FILTER (WHERE s.multiple)
   FROM selections s LEFT JOIN tags g ON g.id = s.tag_id WHERE s.id::text LIKE '5eed%'),
  'Abordagem@Tecnologia:vibecode,tradicional Habilidade@Idiomas:escuta,leitura,escrita,fala,pensamento Instrumento@Música:guitarra,violão Local@Exercícios:academia,casa,rua Meio@Desenho:digital,tradicional Natureza@global:estudo,pesquisa,prática,criação,lazer Tipo de input@Idiomas:raw,comprehensible Habilidade');
SELECT pg_temp.c('9. escolhas por seleção: Natureza 10, Local 5, Habilidade 4, Meio 3, Instrumento 3, Tipo de input 2, Abordagem 1 (28)',
  (SELECT string_agg(n || '=' || c, ' ' ORDER BY n) FROM (
     SELECT s.name n, count(*) c FROM execution_selections es JOIN selections s ON s.id = es.selection_id
     WHERE es.task_execution_id::text LIKE '5eed%' GROUP BY s.name) x),
  'Abordagem=1 Habilidade=4 Instrumento=3 Local=5 Meio=3 Natureza=10 Tipo de input=2');
SELECT pg_temp.c('10. cópias iguais às da seleção; raiz do registro (NULL só na global)',
  (SELECT count(*)::text FROM execution_selections es JOIN selections s ON s.id = es.selection_id
   JOIN task_executions e ON e.id = es.task_execution_id
   WHERE es.task_execution_id::text LIKE '5eed%'
     AND (es.selection_multiple <> s.multiple OR es.selection_global <> s.is_global
          OR es.tag_id IS DISTINCT FROM s.tag_id
          OR es.root_tag_id IS DISTINCT FROM CASE WHEN s.is_global THEN NULL ELSE e.root_tag_id END)), '0');
SELECT pg_temp.c('11. declarante no caminho gravado (a raiz ou uma ligação); uma opção por seleção única',
  (SELECT count(*) FILTER (WHERE NOT es.selection_global AND es.tag_id <> e.root_tag_id
                             AND NOT EXISTS (SELECT 1 FROM task_execution_tags et
                                             WHERE et.task_execution_id = e.id AND et.tag_id = es.tag_id))
          || ' ' || (SELECT max(n) FROM (SELECT count(*) n FROM execution_selections WHERE task_execution_id::text LIKE '5eed%' AND NOT selection_multiple
                                          GROUP BY task_execution_id, selection_id) x)
   FROM execution_selections es JOIN task_executions e ON e.id = es.task_execution_id
   WHERE es.task_execution_id::text LIKE '5eed%'), '0 1');
SELECT pg_temp.c('12. violão arquivado e mantido no 2208; as outras opções ativas',
  (SELECT string_agg(o.name, ',') || ' ' || (SELECT count(*) FROM execution_selections WHERE option_id = '5eed0000-0000-4000-a300-000000000042')
   FROM selection_options o WHERE o.id::text LIKE '5eed%' AND NOT o.active), 'violão 1');
SELECT pg_temp.c('13. "Nenhuma" de propósito: 2207 sem Natureza, 2204 sem Abordagem; 501 (sem tag) com estudo',
  (SELECT string_agg(substr(e.id::text, 33, 4) || ':' || coalesce((SELECT string_agg(s.name || '=' || o.name, ',' ORDER BY s.name)
     FROM execution_selections es JOIN selections s ON s.id = es.selection_id JOIN selection_options o ON o.id = es.option_id
     WHERE es.task_execution_id = e.id), '-'), ' ' ORDER BY e.id)
   FROM task_executions e WHERE e.id IN ('5eed0000-0000-4000-8000-000000002207', '5eed0000-0000-4000-8000-000000002204', '5eed0000-0000-4000-8000-000000000501')),
  '0501:Natureza=estudo 2204:Natureza=pesquisa 2207:Instrumento=guitarra');
SELECT pg_temp.c('14. Redação: medida mais próxima do caminho (a regra da API) = a da Redação; 2210 com 1, 2209 sem medida',
  (SELECT (SELECT m.name || '@' || t.name FROM measures m JOIN tags t ON t.id = m.tag_id
           WHERE m.active AND m.tag_id IN ('5eed0000-0000-4000-9000-000000000100', '5eed0000-0000-4000-9000-000000000140')
           ORDER BY t.level DESC LIMIT 1)
          || ' ' || (SELECT m.name || '@' || t.name || '=' || v.quantity::int FROM execution_measures em
                     JOIN measures m ON m.id = em.measure_id JOIN tags t ON t.id = em.tag_id
                     JOIN execution_measure_values v ON v.task_execution_id = em.task_execution_id
                     WHERE em.task_execution_id = '5eed0000-0000-4000-8000-000000002210')
          || ' ' || (SELECT count(*) FROM execution_measures WHERE task_execution_id = '5eed0000-0000-4000-8000-000000002209')),
  'exercícios@Redação exercícios@Redação=1 0');
SELECT pg_temp.c('15. reestruturação: Casa, Academia e Linguagens fora; Treino a única marcada; 4 grupos embaixo dela; total de tags',
  (SELECT count(*) FILTER (WHERE name IN ('Casa', 'Academia', 'Linguagens')) || ' '
          || string_agg(name, ',') FILTER (WHERE tracks_workout) || ' '
          || (SELECT string_agg(c.name, ',' ORDER BY c.id) FROM tags c WHERE c.parent_id = '5eed0000-0000-4000-9000-000000000310') || ' '
          || count(*) FROM tags WHERE id::text LIKE '5eed%'),
  '0 Treino Peito, tríceps e ombro,Costas, trapézio e bíceps,Perna,Abdômen 35');
SELECT pg_temp.c('16. treinos: caminho gravado (com o fechamento), marcadora = a tag mais funda marcada (regra da API), Local',
  (SELECT string_agg(substr(w.task_execution_id::text, 33, 4) || ':' || (SELECT string_agg(t.name, '>' ORDER BY t.level) FROM task_execution_tags x JOIN tags t ON t.id = x.tag_id WHERE x.task_execution_id = w.task_execution_id)
          || '@' || (SELECT t.name FROM tags t WHERE t.id = w.tag_id) || '=' || (SELECT t.name FROM task_execution_tags x JOIN tags t ON t.id = x.tag_id WHERE x.task_execution_id = w.task_execution_id AND t.tracks_workout ORDER BY t.level DESC LIMIT 1)
          || ':' || (SELECT o.name FROM execution_selections es JOIN selection_options o ON o.id = es.option_id WHERE es.task_execution_id = w.task_execution_id), ' ' ORDER BY w.task_execution_id)
   FROM execution_workouts w WHERE w.task_execution_id::text LIKE '5eed%'),
  '0602:Treino@Treino=Treino:academia 1401:Treino>Costas, trapézio e bíceps@Treino=Treino:academia 1402:Treino>Perna@Treino=Treino:casa 1403:Treino>Costas, trapézio e bíceps@Treino=Treino:academia');
SELECT pg_temp.c('17. Idiomas: medida sem tipos; 1301 e 202 sem tipo, com 1 e 2; total de valores',
  (SELECT (SELECT count(*) FROM measure_kinds WHERE measure_id = '5eed0000-0000-4000-a000-000000000002') || ' '
          || (SELECT string_agg(substr(task_execution_id::text, 33, 4) || '=' || quantity::int || coalesce(kind_id::text, ''), ' ' ORDER BY task_execution_id) FROM execution_measure_values WHERE measure_id = '5eed0000-0000-4000-a000-000000000002') || ' '
          || (SELECT count(*) FROM execution_measure_values WHERE task_execution_id::text LIKE '5eed%')),
  '0 0202=2 1301=1 9');
SELECT pg_temp.c('18. Idiomas: 1301 escuta + raw, 202 escuta + comprehensible, 1701 escrita + pensamento (a múltipla com duas)',
  (SELECT string_agg(r, ' ' ORDER BY r) FROM (
     SELECT substr(es.task_execution_id::text, 33, 4) || ':' || s.name || '=' || string_agg(o.name, ',' ORDER BY o.position) r
     FROM execution_selections es JOIN selections s ON s.id = es.selection_id JOIN selection_options o ON o.id = es.option_id
     WHERE s.name IN ('Habilidade', 'Tipo de input') GROUP BY es.task_execution_id, s.name) x),
  '0202:Habilidade=escuta 0202:Tipo de input=comprehensible 1301:Habilidade=escuta 1301:Tipo de input=raw 1701:Habilidade=escrita,pensamento');
\o
SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END, caso, detalhe FROM r;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) FROM r;
