-- Seed das obras (bloco O3a do dev_seed.sql) contra a conta à mão do comentário dele.
-- Só lê; dias relativos ao dia local de hoje
CREATE TEMP TABLE r (caso text, ok boolean, detalhe text);
CREATE TEMP VIEW o3s AS
  SELECT t.*, e.root_tag_id, e.completed_at, e.work_id,
         t.started_at AT TIME ZONE 'America/Sao_Paulo' AS ini_l,
         (now() AT TIME ZONE 'America/Sao_Paulo')::date - (t.started_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
  FROM time_entries t JOIN task_executions e ON e.id = t.task_execution_id
  WHERE substr(e.id::text, 25, 10) = '0000000023';
CREATE FUNCTION pg_temp.c(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS
  $$INSERT INTO r VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)$$;
CREATE FUNCTION pg_temp.ms(i interval) RETURNS text LANGUAGE sql AS
  $$SELECT (extract(epoch FROM i)::int / 60) || ':' || lpad((extract(epoch FROM i)::int % 60)::text, 2, '0')$$;

\o /dev/null
SELECT pg_temp.c('1. registros / sessões do bloco; total 102:25',
  (SELECT count(DISTINCT task_execution_id) || ' / ' || count(*) || ' ' || pg_temp.ms(sum(ended_at - started_at)) FROM o3s), '4 / 4 102:25');
SELECT pg_temp.c('2. dias e horários locais das anotações; cada registro termina no fim da sessão',
  (SELECT string_agg(substr(task_execution_id::text, 33, 4) || ' -' || dias || ' ' || to_char(ini_l, 'HH24:MI'), ', ' ORDER BY task_execution_id)
          || ' ' || bool_and(completed_at = ended_at) FROM o3s),
  '2301 -2 01:00, 2302 -1 01:00, 2303 -2 09:00, 2304 -1 15:00 true');
SELECT pg_temp.c('3. nada hoje, nada nas semanas 7–12 (43 a 84 dias), tudo encerrado e antes de agora',
  (SELECT count(*) FILTER (WHERE dias = 0 OR dias BETWEEN 43 AND 84 OR ended_at IS NULL OR ended_at > now())::text FROM o3s), '0');
SELECT pg_temp.c('4. caminhos: Leitura › Mangá (com a ligação), Finanças e Perfume só a raiz',
  (SELECT string_agg(substr(e.id::text, 33, 4) || ':' || g.name || coalesce('>' || (SELECT string_agg(t.name, '>') FROM task_execution_tags x JOIN tags t ON t.id = x.tag_id WHERE x.task_execution_id = e.id), ''), ' ' ORDER BY e.id)
   FROM task_executions e JOIN tags g ON g.id = e.root_tag_id WHERE substr(e.id::text, 25, 10) = '0000000023'),
  '2301:Leitura>Mangá 2302:Leitura>Mangá 2303:Finanças 2304:Perfume');
SELECT pg_temp.c('5. tarefas: Ler e Pesquisar avulsas e ativas; Finanças pela Organizar finanças (mensal)',
  (SELECT string_agg(substr(e.id::text, 33, 4) || ':' || e.task_title_at_time || '/' || e.task_frequency_at_time || '/' || k.active, ' ' ORDER BY e.id)
   FROM task_executions e JOIN tasks k ON k.id = e.task_id WHERE substr(e.id::text, 25, 10) = '0000000023'),
  '2301:Ler/none/true 2302:Ler/none/true 2303:Organizar finanças/monthly/true 2304:Pesquisar/none/true');
SELECT pg_temp.c('6. obras: título, status, caminho padrão, tarefa (ativa?), medida, total',
  (SELECT string_agg(w.title || '|' || w.status || '|' || t.name || '|' || k.title || '/' || k.active || '|' || coalesce(m.name, '-') || '|' || coalesce(w.total::int::text, '-'), ' ; ' ORDER BY w.title)
   FROM works w JOIN tags t ON t.id = w.default_tag_id JOIN tasks k ON k.id = w.default_task_id LEFT JOIN measures m ON m.id = w.measure_id
   WHERE w.id::text LIKE '5eed%'),
  'Curso de Docker|concluido|Tecnologia|Curso de Docker/false|-|- ; Inktober|em_andamento|Inktober|Desenhar/true|-|- ; Soul Eater|em_andamento|Mangá|Ler/true|capítulos|113 ; Vagabond|pausado|Mangá|Ler/true|capítulos|327');
SELECT pg_temp.c('7. medida da obra = a mais próxima do caminho padrão, NULL só onde o caminho não mede (measureCurrent)',
  (SELECT count(*)::text FROM works w
   WHERE w.id::text LIKE '5eed%' AND w.measure_id IS DISTINCT FROM (
     SELECT m.id FROM tags d JOIN tags t ON t.id IN (d.id, d.parent_id, d.root_id) JOIN measures m ON m.tag_id = t.id AND m.active
     WHERE d.id = w.default_tag_id ORDER BY t.level DESC LIMIT 1)), '0');
SELECT pg_temp.c('8. por obra: registros, tempo, soma da medida (Soul Eater 2 / 82:20 / 6; Inktober 2 / 54:30)',
  (SELECT string_agg(w.title || '=' || (SELECT count(*) FROM task_executions e WHERE e.work_id = w.id) || '/'
          || coalesce((SELECT pg_temp.ms(sum(s.ended_at - s.started_at)) FROM time_entries s JOIN task_executions e ON e.id = s.task_execution_id WHERE e.work_id = w.id), '0:00') || '/'
          || coalesce((SELECT sum(v.quantity)::int::text FROM execution_measure_values v JOIN task_executions e ON e.id = v.task_execution_id WHERE e.work_id = w.id AND v.measure_id = w.measure_id), '-'), ' ' ORDER BY w.title)
   FROM works w WHERE w.id::text LIKE '5eed%'),
  'Curso de Docker=0/0:00/- Inktober=2/54:30/- Soul Eater=2/82:20/6 Vagabond=0/0:00/-');
SELECT pg_temp.c('9. ligados às obras: 2201, 2202 (Inktober), 2301, 2302 (Soul Eater); mais nenhum',
  (SELECT string_agg(substr(e.id::text, 33, 4) || ':' || w.title, ' ' ORDER BY e.id) FROM task_executions e JOIN works w ON w.id = e.work_id),
  '2201:Inktober 2202:Inktober 2301:Soul Eater 2302:Soul Eater');
SELECT pg_temp.c('10. medida: 2301 com 6 capítulos (declarante Mangá); 2302 sem linha de medida',
  (SELECT (SELECT t.name || '=' || v.quantity::int FROM execution_measures em JOIN tags t ON t.id = em.tag_id
           JOIN execution_measure_values v ON v.task_execution_id = em.task_execution_id
           WHERE em.task_execution_id = '5eed0000-0000-4000-8000-000000002301')
          || ' ' || (SELECT count(*) FROM execution_measures WHERE task_execution_id = '5eed0000-0000-4000-8000-000000002302')),
  'Mangá=6 0');
SELECT pg_temp.c('11. Perfume com Natureza = pesquisa (global); os outros três sem escolha',
  (SELECT string_agg(substr(e.id::text, 33, 4) || ':' || coalesce((SELECT string_agg(s.name || '=' || o.name || '/' || es.selection_global, ',')
     FROM execution_selections es JOIN selections s ON s.id = es.selection_id JOIN selection_options o ON o.id = es.option_id
     WHERE es.task_execution_id = e.id), '-'), ' ' ORDER BY e.id)
   FROM task_executions e WHERE substr(e.id::text, 25, 10) = '0000000023'),
  '2301:- 2302:- 2303:- 2304:Natureza=pesquisa/true');
SELECT pg_temp.c('12. link: só o 1301',
  (SELECT string_agg(substr(id::text, 33, 4) || '=' || link_url, ' ') FROM task_executions WHERE link_url IS NOT NULL),
  '1301=https://www.youtube.com/watch?v=jNQXAC9IVRw');
SELECT pg_temp.c('13. totais do seed: registros, sessões, tags, tarefas, escolhas, valores, obras',
  (SELECT (SELECT count(*) FROM task_executions WHERE id::text LIKE '5eed%') || ' ' || (SELECT count(*) FROM time_entries WHERE task_execution_id::text LIKE '5eed%')
          || ' ' || (SELECT count(*) FROM tags WHERE id::text LIKE '5eed%') || ' ' || (SELECT count(*) FROM tasks WHERE id::text LIKE '5eed%')
          || ' ' || (SELECT count(*) FROM execution_selections WHERE task_execution_id::text LIKE '5eed%')
          || ' ' || (SELECT count(*) FROM execution_measure_values WHERE task_execution_id::text LIKE '5eed%')
          || ' ' || (SELECT count(*) FROM works WHERE id::text LIKE '5eed%')),
  '106 100 39 16 29 10 4');
\o
SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END, caso, detalhe FROM r;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) FROM r;
