-- Painel, medidas por contexto (MA2a): a mesma regra da MA1 (tests/banco/medidas-cases.sql), com o grupo = a
-- RAIZ do registro (e.root_tag_id), como tempo-por-contexto. Rodar dentro de BEGIN ... ROLLBACK (o run.mjs
-- embrulha). Abril de 2025 (o seed nunca cai lá). Regras:
--   - data = completed_at do REGISTRO em [de, ate); aberto não entra; a medida é a GRAVADA no registro;
--   - dentro de cada contexto, medidas e tipos agrupam por lower(btrim(nome)); contextos diferentes NÃO
--     se somam (a mesma "Questões" em duas raízes são dois itens);
--   - toda medida tem raiz (execution_measures.root_tag_id é NOT NULL): não existe item sem tag;
--   - nome mostrado = o do registro mais recente do grupo (completed_at desc, id desc).
SET client_min_messages = warning;
CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

-- ---------------------------------------------------------------- dados
-- Prefixos: tag a0d7, medida a0d8, tipo a0d9, registro a0da, tarefa a0db
CREATE FUNCTION pg_temp.u(p text, n int) RETURNS uuid LANGUAGE sql AS
  $$SELECT ('00000000-0000-4000-' || p || '-' || lpad(n::text, 12, '0'))::uuid$$;
CREATE FUNCTION pg_temp.local(t text) RETURNS timestamptz LANGUAGE sql AS
  $$SELECT (t::timestamp AT TIME ZONE 'America/Sao_Paulo')$$;

-- R1, R2, R3, R4 (raízes) e S (nível 2, sob R1, que substitui a medida da raiz)
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.u('a0d7', 1), 'MC R1', 1, NULL, NULL),
  (pg_temp.u('a0d7', 2), 'MC R2', 1, NULL, NULL),
  (pg_temp.u('a0d7', 3), 'MC R3', 1, NULL, NULL),
  (pg_temp.u('a0d7', 4), 'MC R4', 1, NULL, NULL);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.u('a0d7', 11), 'MC S', 2, pg_temp.u('a0d7', 1), pg_temp.u('a0d7', 1));
-- M1 em R1 "Questões" (Acertos, Erros); M2 em R2 "QUESTÕES " (acertos, ERROS); M3 em S "Exercícios"
-- (Leitura); M4 em R3 "Km" (decimal, sem tipos); R4 nunca tem medida
INSERT INTO measures (id, tag_id, name, singular, allows_decimal) VALUES
  (pg_temp.u('a0d8', 1), pg_temp.u('a0d7', 1), 'Questões', 'questão', false),
  (pg_temp.u('a0d8', 2), pg_temp.u('a0d7', 2), 'QUESTÕES ', 'questão', false),
  (pg_temp.u('a0d8', 3), pg_temp.u('a0d7', 11), 'Exercícios', 'exercício', false),
  (pg_temp.u('a0d8', 4), pg_temp.u('a0d7', 3), 'Km', 'km', true);
INSERT INTO measure_kinds (id, measure_id, name) VALUES
  (pg_temp.u('a0d9', 1), pg_temp.u('a0d8', 1), 'Acertos'),
  (pg_temp.u('a0d9', 2), pg_temp.u('a0d8', 1), 'Erros'),
  (pg_temp.u('a0d9', 3), pg_temp.u('a0d8', 2), 'acertos'),
  (pg_temp.u('a0d9', 4), pg_temp.u('a0d8', 2), 'ERROS'),
  (pg_temp.u('a0d9', 5), pg_temp.u('a0d8', 3), 'Leitura');
INSERT INTO tasks (id, title) VALUES (pg_temp.u('a0db', 1), 'MC tarefa');

-- Registro n na raiz r, concluído em t (NULL = aberto), com a medida m declarada na tag d
CREATE FUNCTION pg_temp.reg(n int, raiz int, t text, m int, decl int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
  VALUES (pg_temp.u('a0da', n), pg_temp.u('a0db', 1), 'MC tarefa', 'none', pg_temp.local(t), pg_temp.u('a0d7', raiz));
  INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id)
  VALUES (pg_temp.u('a0da', n), pg_temp.u('a0d8', m), pg_temp.u('a0d7', decl), pg_temp.u('a0d7', raiz))
$$;
CREATE FUNCTION pg_temp.em_s(n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_execution_tags VALUES (pg_temp.u('a0da', n), pg_temp.u('a0d7', 11), pg_temp.u('a0d7', 1), pg_temp.u('a0d7', 1))
$$;
CREATE FUNCTION pg_temp.val(n int, m int, k int, q numeric) RETURNS void LANGUAGE sql AS $$
  INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity)
  VALUES (pg_temp.u('a0da', n), pg_temp.u('a0d8', m), CASE WHEN k = 0 THEN NULL ELSE pg_temp.u('a0d9', k) END, q)
$$;

\o /dev/null
-- E1: R1, 02/04: Acertos 100, Erros 20
SELECT pg_temp.reg(1, 1, '2025-04-02 12:00', 1, 1); SELECT pg_temp.val(1, 1, 1, 100); SELECT pg_temp.val(1, 1, 2, 20);
-- E2: R2, 03/04 12:00: acertos 50, ERROS 10 (a "Questões" de OUTRA raiz: não soma com a da R1)
SELECT pg_temp.reg(2, 2, '2025-04-03 12:00', 2, 2); SELECT pg_temp.val(2, 2, 3, 50); SELECT pg_temp.val(2, 2, 4, 10);
-- E7: R1, mesmo instante do E2, id maior: Acertos 5
SELECT pg_temp.reg(7, 1, '2025-04-03 12:00', 1, 1); SELECT pg_temp.val(7, 1, 1, 5);
-- E4: R1 pela subtag S (a medida de S substitui a da raiz), 05/04: Leitura 7 e 3 sem tipo
SELECT pg_temp.reg(4, 1, '2025-04-05 12:00', 3, 11); SELECT pg_temp.em_s(4); SELECT pg_temp.val(4, 3, 5, 7); SELECT pg_temp.val(4, 3, 0, 3);
-- E5, E6: R3: Km 5,5 e 2,25; E11 exatamente em "de" (01/04 00:00): Km 1
SELECT pg_temp.reg(5, 3, '2025-04-06 12:00', 4, 3); SELECT pg_temp.val(5, 4, 0, 5.5);
SELECT pg_temp.reg(6, 3, '2025-04-07 12:00', 4, 3); SELECT pg_temp.val(6, 4, 0, 2.25);
SELECT pg_temp.reg(11, 3, '2025-04-01 00:00', 4, 3); SELECT pg_temp.val(11, 4, 0, 1);
-- E9: R1 ABERTO (999, não entra); E10: R1 exatamente em "ate" de abril (888: fora de abril, dentro de maio)
SELECT pg_temp.reg(9, 1, NULL, 1, 1); SELECT pg_temp.val(9, 1, 1, 999);
SELECT pg_temp.reg(10, 1, '2025-05-01 00:00', 1, 1); SELECT pg_temp.val(10, 1, 1, 888);
-- E8: R1 pela subtag S, 10/05, com a medida ANTIGA da raiz (M1): Acertos 4
SELECT pg_temp.reg(8, 1, '2025-05-10 12:00', 1, 1); SELECT pg_temp.em_s(8); SELECT pg_temp.val(8, 1, 1, 4);
-- E12: R4 (sem medida nenhuma): registro com tempo, mas sem valor: nunca aparece
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
  VALUES (pg_temp.u('a0da', 12), pg_temp.u('a0db', 1), 'MC tarefa', 'none', pg_temp.local('2025-04-08 12:00'), pg_temp.u('a0d7', 4));
\o

-- ---------------------------------------------------------------- consulta
-- (a que a rota roda: mesmo texto, grupo = e.root_tag_id; $1 = de, $2 = ate)
CREATE FUNCTION pg_temp.por_contexto(de timestamptz, ate timestamptz)
RETURNS TABLE ("tagId" uuid, key text, name text, singular text, total float8, executions int, kinds json)
LANGUAGE sql AS $$
  WITH v AS (
    SELECT e.id AS execucao, e.completed_at, e.root_tag_id AS grupo,
           lower(btrim(m.name)) AS mkey, btrim(m.name) AS mname, btrim(m.singular) AS msing,
           lower(btrim(k.name)) AS kkey, btrim(k.name) AS kname, val.quantity
    FROM execution_measure_values val
    JOIN task_executions e ON e.id = val.task_execution_id
    JOIN measures m ON m.id = val.measure_id
    LEFT JOIN measure_kinds k ON k.id = val.kind_id
    WHERE e.completed_at >= de AND e.completed_at < ate
  ),
  por_tipo AS (
    SELECT grupo, mkey, kkey,
           (array_agg(kname ORDER BY completed_at DESC, execucao DESC))[1] AS name,
           round(sum(quantity), 2)::float8 AS quantity,
           count(DISTINCT execucao)::int AS executions
    FROM v GROUP BY grupo, mkey, kkey
  ),
  por_medida AS (
    SELECT grupo, mkey,
           (array_agg(mname ORDER BY completed_at DESC, execucao DESC))[1] AS name,
           (array_agg(msing ORDER BY completed_at DESC, execucao DESC))[1] AS singular,
           round(sum(quantity), 2)::float8 AS total,
           count(DISTINCT execucao)::int AS executions
    FROM v GROUP BY grupo, mkey
  )
  SELECT pm.grupo, pm.mkey, pm.name, pm.singular, pm.total, pm.executions,
         COALESCE((
           SELECT json_agg(json_build_object('key', pt.kkey, 'name', pt.name,
                                             'quantity', pt.quantity, 'executions', pt.executions)
                           ORDER BY pt.kkey IS NULL, pt.quantity DESC, pt.kkey)
           FROM por_tipo pt
           WHERE pt.grupo IS NOT DISTINCT FROM pm.grupo AND pt.mkey = pm.mkey
             AND EXISTS (SELECT 1 FROM por_tipo x WHERE x.grupo IS NOT DISTINCT FROM pm.grupo
                         AND x.mkey = pm.mkey AND x.kkey IS NOT NULL)
         ), '[]'::json)
  FROM por_medida pm
  ORDER BY pm.grupo NULLS LAST, pm.total DESC, pm.mkey
$$;

-- "Rn:{Nome=total/registros{tipo=qtd/registros;...};...}" por contexto, na ordem da rota
CREATE FUNCTION pg_temp.txt(de timestamptz, ate timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(t.tag || ':{' || t.medidas || '}', ' ' ORDER BY t.n)
  FROM (
    SELECT min(m.n) AS n, 'R' || right(m."tagId"::text, 1) AS tag,
           string_agg(m.name || '=' || m.total || '/' || m.executions || '{' ||
             COALESCE((SELECT string_agg(coalesce(x.k->>'name', '(sem tipo)') || '=' || (x.k->>'quantity') || '/' || (x.k->>'executions'), ';' ORDER BY x.ord)
                       FROM json_array_elements(m.kinds) WITH ORDINALITY AS x(k, ord)), '') || '}', ';' ORDER BY m.n) AS medidas
    FROM (SELECT row_number() OVER () AS n, * FROM pg_temp.por_contexto(de, ate)) m
    GROUP BY m."tagId"
  ) t
$$;

-- ---------------------------------------------------------------- casos
CREATE FUNCTION pg_temp.confere(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO resultado VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)
$$;
CREATE FUNCTION pg_temp.w(a text, b text) RETURNS text LANGUAGE sql AS
  $$SELECT pg_temp.txt(pg_temp.local(a), pg_temp.local(b))$$;

\o /dev/null
SELECT pg_temp.confere('0. nenhum valor de medida de fora do MC em abril/maio de 2025 (a conta à mão vale)',
  (SELECT count(*)::text FROM execution_measure_values v JOIN task_executions e ON e.id = v.task_execution_id
   WHERE e.task_id <> pg_temp.u('a0db', 1) AND e.completed_at >= pg_temp.local('2025-04-01 00:00')
     AND e.completed_at < pg_temp.local('2025-06-01 00:00')), '0');

-- Abril. R1: Questões Acertos 100 + 5 = 105 (E1, E7: 2 registros), Erros 20 (1) = 125 (2 registros), e
-- Exercícios (a medida de S substitui a da raiz, no MESMO contexto): Leitura 7 + 3 sem tipo = 10 (1).
-- R2: "QUESTÕES" é outra raiz, não soma com a da R1: acertos 50, ERROS 10 = 60 (1). R3: Km 5,5 + 2,25 + 1 =
-- 8,75 (3), sem tipos. R4: registro sem medida, não aparece. O aberto (999) e o de 01/05 00:00 (888) ficam
-- de fora; o do dia 01/04 00:00 entra. Nome do tipo da R1: Acertos (só os da R1).
SELECT pg_temp.confere('A. abril: um item por contexto, cada um com as suas medidas (sem somar entre contextos)',
  pg_temp.w('2025-04-01 00:00', '2025-05-01 00:00'),
  'R1:{Questões=125/2{Acertos=105/2;Erros=20/1};Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}} R2:{QUESTÕES=60/1{acertos=50/1;ERROS=10/1}} R3:{Km=8.75/3{}}');
-- A soma dos contextos fecha com o período inteiro (o da MA1, que agrupa por nome entre raízes)
SELECT pg_temp.confere('B. Questões: R1 125 + R2 60 = 185 (o total do período inteiro da MA1, que une as raízes)',
  (SELECT sum(total)::text FROM pg_temp.por_contexto(pg_temp.local('2025-04-01 00:00'), pg_temp.local('2025-05-01 00:00')) WHERE key = 'questões'), '185');
SELECT pg_temp.confere('C. maio: só R1 (E10 em "de" entra; E8, pela subtag S com a medida antiga da raiz, soma na mesma Questões)',
  pg_temp.w('2025-05-01 00:00', '2025-06-01 00:00'), 'R1:{Questões=892/2{Acertos=892/2}}');
SELECT pg_temp.confere('D. janela só do E4 (05/04): só o item R1, só Exercícios',
  pg_temp.w('2025-04-05 00:00', '2025-04-06 00:00'), 'R1:{Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}}');
SELECT pg_temp.confere('E. janela larga: R1 tem os dois blocos (Questões antiga e Exercícios nova) lado a lado',
  pg_temp.w('2025-04-01 00:00', '2025-06-01 00:00'),
  'R1:{Questões=1017/4{Acertos=997/4;Erros=20/1};Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}} R2:{QUESTÕES=60/1{acertos=50/1;ERROS=10/1}} R3:{Km=8.75/3{}}');
SELECT pg_temp.confere('F. [de, ate): E11 em "de" entra; E10 em "ate" não',
  pg_temp.w('2025-04-01 00:00', '2025-04-01 00:00:01'), 'R3:{Km=1/1{}}');
SELECT pg_temp.confere('G. janela que acaba no instante do E10 não o inclui',
  pg_temp.w('2025-04-30 00:00', '2025-05-01 00:00'), NULL);
SELECT pg_temp.confere('H. R4 (registro sem valor de medida) nunca aparece',
  (SELECT count(*)::text FROM pg_temp.por_contexto(pg_temp.local('2025-04-01 00:00'), pg_temp.local('2025-06-01 00:00')) WHERE "tagId" = pg_temp.u('a0d7', 4)), '0');
SELECT pg_temp.confere('I. nenhum item sem tag (root_tag_id NOT NULL em execution_measures)',
  (SELECT count(*)::text FROM pg_temp.por_contexto(pg_temp.local('2025-01-01 00:00'), pg_temp.local('2026-01-01 00:00')) WHERE "tagId" IS NULL), '0');
SELECT pg_temp.confere('J. R3 (Km, só sem tipo): kinds vazio',
  (SELECT json_array_length(kinds)::text FROM pg_temp.por_contexto(pg_temp.local('2025-04-01 00:00'), pg_temp.local('2025-05-01 00:00')) WHERE "tagId" = pg_temp.u('a0d7', 3)), '0');
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
