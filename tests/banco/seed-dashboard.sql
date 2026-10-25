-- Seed do Dashboard (bloco D1 do dev_seed.sql) contra a conta à mão do comentário dele.
-- Só lê; semanas relativas à segunda-feira local da semana atual
CREATE TEMP TABLE r (caso text, ok boolean, detalhe text);
CREATE TEMP VIEW d1s AS
  SELECT t.*, e.root_tag_id, e.completed_at,
         t.started_at AT TIME ZONE 'America/Sao_Paulo' AS ini_l,
         t.ended_at AT TIME ZONE 'America/Sao_Paulo' AS fim_l
  FROM time_entries t JOIN task_executions e ON e.id = t.task_execution_id
  WHERE substr(e.id::text, 25, 10) IN ('0000000015', '0000000016', '0000000017', '0000000018', '0000000019', '0000000020', '0000000021');
CREATE TEMP VIEW seg AS SELECT date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AS d;
CREATE FUNCTION pg_temp.c(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS
  $$INSERT INTO r VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)$$;
CREATE FUNCTION pg_temp.m(i interval) RETURNS text LANGUAGE sql AS $$SELECT round(extract(epoch FROM i) / 60)::text$$;

\o /dev/null
SELECT pg_temp.c('1. registros / sessões do bloco', (SELECT count(DISTINCT task_execution_id) || ' / ' || count(*) FROM d1s), '47 / 47');
SELECT pg_temp.c('2. total 2840 min', (SELECT pg_temp.m(sum(ended_at - started_at)) FROM d1s), '2840');
SELECT pg_temp.c('3. por contexto: Vestibular 1700, Linguagens 600, Exercícios 240, Matemática 180, sem tag 120',
  (SELECT string_agg(n || '=' || m, ' ' ORDER BY n) FROM (
     SELECT coalesce(g.name, 'sem tag') n, pg_temp.m(sum(ended_at - started_at)) m
     FROM d1s LEFT JOIN tags g ON g.id = d1s.root_tag_id GROUP BY g.name) x),
  'Exercícios=240 Linguagens=600 Matemática=180 sem tag=120 Vestibular=1700');
SELECT pg_temp.c('4. Vestibular por subtag: Matemática 1080, Física 620',
  (SELECT string_agg(n || '=' || m, ' ' ORDER BY n) FROM (
     SELECT t.name n, pg_temp.m(sum(d.ended_at - d.started_at)) m
     FROM d1s d JOIN task_execution_tags et ON et.task_execution_id = d.task_execution_id
     JOIN tags t ON t.id = et.tag_id AND t.level = 2 AND t.root_id = '5eed0000-0000-4000-9000-000000000100'
     GROUP BY t.name) x), 'Física=620 Matemática=1080');
SELECT pg_temp.c('5. por semana k (a virada do mês fora): 195 275 275 275 135 275 255 235 135 235 255 235',
  (SELECT string_agg(m, ' ' ORDER BY k) FROM (
     SELECT round(extract(epoch FROM (SELECT d FROM seg) - date_trunc('week', ini_l)) / 604800)::int k,
            pg_temp.m(sum(ended_at - started_at)) m
     FROM d1s WHERE substr(task_execution_id::text, 25, 12) <> '000000002101' GROUP BY 1) x),
  '195 275 275 275 135 275 255 235 135 235 255 235');
SELECT pg_temp.c('6. meia-noite (semana 3, qui): 23:20 → 00:40 local, em dias locais diferentes',
  (SELECT to_char(ini_l, 'HH24:MI') || ' ' || to_char(fim_l, 'HH24:MI') || ' ' || (fim_l::date - ini_l::date)
   FROM d1s WHERE substr(task_execution_id::text, 25, 12) = '000000001603'), '23:20 00:40 1');
SELECT pg_temp.c('7. virada do mês: 23:30 do último dia → 00:30 do dia 1 do mês anterior, ≥ 28 dias atrás',
  (SELECT to_char(ini_l, 'HH24:MI') || ' ' || to_char(fim_l, 'DD HH24:MI') || ' ' || (date_trunc('month', fim_l) = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month') || ' ' || (now() - ended_at >= interval '28 days')
   FROM d1s WHERE substr(task_execution_id::text, 25, 12) = '000000002101'), '23:30 01 00:30 true true');
SELECT pg_temp.c('8. uma estimada, 40 min, terminando no "Quando" do registro',
  (SELECT count(*) || ' ' || pg_temp.m(sum(ended_at - started_at)) || ' ' || bool_and(ended_at = completed_at) FROM d1s WHERE estimated), '1 40 true');
SELECT pg_temp.c('9. nada hoje nem na semana atual; tudo encerrado e antes de agora',
  (SELECT count(*) FILTER (WHERE ini_l >= (SELECT d FROM seg) OR ended_at IS NULL OR ended_at > now())::text FROM d1s), '0');
SELECT pg_temp.c('10. horários reais: todas as sessões começam entre 7h e 23h59 local',
  (SELECT count(*) FILTER (WHERE extract(hour FROM ini_l) NOT BETWEEN 7 AND 23)::text FROM d1s), '0');
SELECT pg_temp.c('11. cada registro termina no fim da sua sessão',
  (SELECT count(*) FILTER (WHERE completed_at <> ended_at)::text FROM d1s), '0');
SELECT pg_temp.c('12. fechamento das tags: Álgebra (nível 3) leva Matemática; os demais só a folha',
  (SELECT count(*)::text FROM task_execution_tags WHERE substr(task_execution_id::text, 25, 10) IN ('0000000015', '0000000016', '0000000017', '0000000018', '0000000019', '0000000021')),
  (12 * 2 + 10 + 12 + 6 + 3 + 1)::text);
\o
SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END, caso, detalhe FROM r;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) FROM r;
