-- Painel, medidas (MA1): totais por medida e por tipo, com a conta à mão. Rodar dentro de
-- BEGIN ... ROLLBACK (o run.mjs embrulha). Abril de 2025 (o seed é relativo a hoje e nunca cai lá).
-- Regras (decididas em 2026-11-17):
--   - a data é a do REGISTRO (completed_at), em [de, ate); registro aberto não entra;
--   - a medida é a GRAVADA no registro (execution_measures.measure_id), não a atual da tag;
--   - medidas e tipos agrupam por lower(btrim(nome)); nomes diferentes não se somam;
--   - nome mostrado = o do registro mais recente do grupo (completed_at desc, id desc);
--   - kinds só existe se algum valor do grupo tem tipo; aí o "(sem tipo)" é uma linha, e a soma
--     das linhas fecha com o total.
SET client_min_messages = warning;
CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

-- ---------------------------------------------------------------- dados
-- Prefixos: tag a0d2, medida a0d3, tipo a0d4, registro a0d5 (o número é o do caso)
CREATE FUNCTION pg_temp.u(p text, n int) RETURNS uuid LANGUAGE sql AS
  $$SELECT ('00000000-0000-4000-' || p || '-' || lpad(n::text, 12, '0'))::uuid$$;
CREATE FUNCTION pg_temp.local(t text) RETURNS timestamptz LANGUAGE sql AS
  $$SELECT (t::timestamp AT TIME ZONE 'America/Sao_Paulo')$$;

-- R1, R2, R3 (raízes) e S (nível 2, sob R1)
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.u('a0d2', 1), 'MA R1', 1, NULL, NULL),
  (pg_temp.u('a0d2', 2), 'MA R2', 1, NULL, NULL),
  (pg_temp.u('a0d2', 3), 'MA R3', 1, NULL, NULL);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.u('a0d2', 11), 'MA S', 2, pg_temp.u('a0d2', 1), pg_temp.u('a0d2', 1));
-- M1 em R1 "Questões" (tipos A1 "Acertos", E1 "Erros"); M2 em R2 "QUESTÕES " (mesmo nome, outra
-- grafia; tipos "acertos", "ERROS"); M3 em S "Exercícios" (tipo "Leitura"); M4 em R3 "Km" (sem tipos)
INSERT INTO measures (id, tag_id, name, singular, allows_decimal) VALUES
  (pg_temp.u('a0d3', 1), pg_temp.u('a0d2', 1), 'Questões', 'questão', false),
  (pg_temp.u('a0d3', 2), pg_temp.u('a0d2', 2), 'QUESTÕES ', 'questão', false),
  (pg_temp.u('a0d3', 3), pg_temp.u('a0d2', 11), 'Exercícios', 'exercício', false),
  (pg_temp.u('a0d3', 4), pg_temp.u('a0d2', 3), 'Km', 'km', true);
INSERT INTO measure_kinds (id, measure_id, name) VALUES
  (pg_temp.u('a0d4', 1), pg_temp.u('a0d3', 1), 'Acertos'),
  (pg_temp.u('a0d4', 2), pg_temp.u('a0d3', 1), 'Erros'),
  (pg_temp.u('a0d4', 3), pg_temp.u('a0d3', 2), 'acertos'),
  (pg_temp.u('a0d4', 4), pg_temp.u('a0d3', 2), 'ERROS'),
  (pg_temp.u('a0d4', 5), pg_temp.u('a0d3', 3), 'Leitura');
INSERT INTO tasks (id, title) VALUES (pg_temp.u('a0d6', 1), 'MA tarefa');

-- Registro n na raiz r, concluído em t (NULL = aberto), com a medida m declarada na tag d
CREATE FUNCTION pg_temp.reg(n int, raiz int, t text, m int, decl int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
  VALUES (pg_temp.u('a0d5', n), pg_temp.u('a0d6', 1), 'MA tarefa', 'none', pg_temp.local(t), pg_temp.u('a0d2', raiz));
  INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id)
  VALUES (pg_temp.u('a0d5', n), pg_temp.u('a0d3', m), pg_temp.u('a0d2', decl), pg_temp.u('a0d2', raiz))
$$;
-- O caminho passa por S (a FK adiada confere a declarante abaixo da raiz)
CREATE FUNCTION pg_temp.em_s(n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_execution_tags VALUES (pg_temp.u('a0d5', n), pg_temp.u('a0d2', 11), pg_temp.u('a0d2', 1), pg_temp.u('a0d2', 1))
$$;
-- Valor: tipo k (0 = sem tipo)
CREATE FUNCTION pg_temp.val(n int, m int, k int, q numeric) RETURNS void LANGUAGE sql AS $$
  INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity)
  VALUES (pg_temp.u('a0d5', n), pg_temp.u('a0d3', m), CASE WHEN k = 0 THEN NULL ELSE pg_temp.u('a0d4', k) END, q)
$$;

\o /dev/null
-- E1: R1, 02/04, M1: Acertos 100, Erros 20
SELECT pg_temp.reg(1, 1, '2025-04-02 12:00', 1, 1); SELECT pg_temp.val(1, 1, 1, 100); SELECT pg_temp.val(1, 1, 2, 20);
-- E2: R2, 03/04 12:00, M2 (outra grafia): acertos 50, ERROS 10
SELECT pg_temp.reg(2, 2, '2025-04-03 12:00', 2, 2); SELECT pg_temp.val(2, 2, 3, 50); SELECT pg_temp.val(2, 2, 4, 10);
-- E7: R1, MESMO instante do E2 e id maior: o nome mostrado do grupo vem dele; M1: Acertos 5
SELECT pg_temp.reg(7, 1, '2025-04-03 12:00', 1, 1); SELECT pg_temp.val(7, 1, 1, 5);
-- E4: S, 05/04, M3: Leitura 7 e 3 SEM tipo
SELECT pg_temp.reg(4, 1, '2025-04-05 12:00', 3, 11); SELECT pg_temp.em_s(4); SELECT pg_temp.val(4, 3, 5, 7); SELECT pg_temp.val(4, 3, 0, 3);
-- E5, E6: R3, Km sem tipo 5,5 e 2,25
SELECT pg_temp.reg(5, 3, '2025-04-06 12:00', 4, 3); SELECT pg_temp.val(5, 4, 0, 5.5);
SELECT pg_temp.reg(6, 3, '2025-04-07 12:00', 4, 3); SELECT pg_temp.val(6, 4, 0, 2.25);
-- E11: R3, exatamente em "de" (01/04 00:00): entra; Km 1
SELECT pg_temp.reg(11, 3, '2025-04-01 00:00', 4, 3); SELECT pg_temp.val(11, 4, 0, 1);
-- E9: R1 ABERTO (não entra); M1 Acertos 999
SELECT pg_temp.reg(9, 1, NULL, 1, 1); SELECT pg_temp.val(9, 1, 1, 999);
-- E10: R1 exatamente em "ate" de abril (01/05 00:00): fora de abril, dentro de maio; Acertos 888
SELECT pg_temp.reg(10, 1, '2025-05-01 00:00', 1, 1); SELECT pg_temp.val(10, 1, 1, 888);
-- E8: a MESMA tag S do E4, mas com a medida ANTIGA da raiz (M1), em 10/05: Acertos 4
SELECT pg_temp.reg(8, 1, '2025-05-10 12:00', 1, 1); SELECT pg_temp.em_s(8); SELECT pg_temp.val(8, 1, 1, 4);
\o

-- ---------------------------------------------------------------- consulta
-- (a que a rota roda: mesmo texto, $1 = de, $2 = ate)
CREATE FUNCTION pg_temp.medidas(de timestamptz, ate timestamptz)
RETURNS TABLE (key text, name text, singular text, total float8, executions int, kinds json)
LANGUAGE sql AS $$
  WITH v AS (
    SELECT e.id AS execucao, e.completed_at,
           lower(btrim(m.name)) AS mkey, btrim(m.name) AS mname, btrim(m.singular) AS msing,
           lower(btrim(k.name)) AS kkey, btrim(k.name) AS kname, val.quantity
    FROM execution_measure_values val
    JOIN task_executions e ON e.id = val.task_execution_id
    JOIN measures m ON m.id = val.measure_id
    LEFT JOIN measure_kinds k ON k.id = val.kind_id
    WHERE e.completed_at >= de AND e.completed_at < ate
  ),
  por_tipo AS (
    SELECT mkey, kkey,
           (array_agg(kname ORDER BY completed_at DESC, execucao DESC))[1] AS name,
           round(sum(quantity), 2)::float8 AS quantity,
           count(DISTINCT execucao)::int AS executions
    FROM v GROUP BY mkey, kkey
  ),
  por_medida AS (
    SELECT mkey,
           (array_agg(mname ORDER BY completed_at DESC, execucao DESC))[1] AS name,
           (array_agg(msing ORDER BY completed_at DESC, execucao DESC))[1] AS singular,
           round(sum(quantity), 2)::float8 AS total,
           count(DISTINCT execucao)::int AS executions
    FROM v GROUP BY mkey
  )
  SELECT pm.mkey, pm.name, pm.singular, pm.total, pm.executions,
         COALESCE((
           SELECT json_agg(json_build_object('key', pt.kkey, 'name', pt.name,
                                             'quantity', pt.quantity, 'executions', pt.executions)
                           ORDER BY pt.kkey IS NULL, pt.quantity DESC, pt.kkey)
           FROM por_tipo pt
           WHERE pt.mkey = pm.mkey
             AND EXISTS (SELECT 1 FROM por_tipo x WHERE x.mkey = pm.mkey AND x.kkey IS NOT NULL)
         ), '[]'::json)
  FROM por_medida pm
  ORDER BY pm.total DESC, pm.mkey
$$;

-- "Nome=total/registros{tipo=qtd/registros;...}" por medida, na ordem da rota
CREATE FUNCTION pg_temp.txt_ordenado(de timestamptz, ate timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(
    m.name || '=' || m.total || '/' || m.executions || '{' ||
    COALESCE((SELECT string_agg(coalesce(t.k->>'name', '(sem tipo)') || '=' || (t.k->>'quantity') || '/' || (t.k->>'executions'), ';' ORDER BY t.ord)
              FROM json_array_elements(m.kinds) WITH ORDINALITY AS t(k, ord)), '') || '}', ' ' ORDER BY m.n)
  FROM (SELECT row_number() OVER () AS n, * FROM pg_temp.medidas(de, ate)) m
$$;

-- ---------------------------------------------------------------- casos
CREATE FUNCTION pg_temp.confere(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO resultado VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)
$$;
CREATE FUNCTION pg_temp.w(a text, b text) RETURNS text LANGUAGE sql AS
  $$SELECT pg_temp.txt_ordenado(pg_temp.local(a), pg_temp.local(b))$$;

\o /dev/null
SELECT pg_temp.confere('0. nenhum registro com medida fora do MA em abril/maio de 2025 (a conta à mão vale)',
  (SELECT count(*)::text FROM execution_measure_values v JOIN task_executions e ON e.id = v.task_execution_id
   WHERE e.task_id <> pg_temp.u('a0d6', 1) AND e.completed_at >= pg_temp.local('2025-04-01 00:00')
     AND e.completed_at < pg_temp.local('2025-06-01 00:00')), '0');

-- Abril inteiro. Questões: Acertos 100+50+5 = 155 (3 registros), Erros 20+10 = 30 (2), total 185 (3).
-- O nome do grupo e o do tipo "acertos" vêm do E7 (empate com o E2, id maior); o do tipo "Erros", do E2
-- ("ERROS", o único mais recente). Exercícios 10 = 7 + 3 sem tipo. Km 5,5 + 2,25 + 1 = 8,75 (3), sem linhas
-- de tipo. O aberto (999) e o de 01/05 00:00 (888) ficam de fora; o do dia 01/04 00:00 entra.
SELECT pg_temp.confere('A. abril: três blocos, ordem pelo total, nomes pelo mais recente, soma por tipo',
  pg_temp.w('2025-04-01 00:00', '2025-05-01 00:00'),
  'Questões=185/3{Acertos=155/3;ERROS=30/2} Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1} Km=8.75/3{}');
-- Maio [01/05, 01/06): o E10 (888, exatamente em 01/05 00:00) e o E8 (4)
SELECT pg_temp.confere('B. maio: só Questões (E10 em "de" entra; E8 com a medida antiga da raiz, na tag S)',
  pg_temp.w('2025-05-01 00:00', '2025-06-01 00:00'), 'Questões=892/2{Acertos=892/2}');
-- Janela só do E4 (05/04): só o bloco Exercícios; E8 (mesma tag, medida antiga) fica no bloco dele
SELECT pg_temp.confere('C. janela só do E4: só Exercícios',
  pg_temp.w('2025-04-05 00:00', '2025-04-06 00:00'), 'Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1}');
SELECT pg_temp.confere('D. dois registros da MESMA tag S com medidas diferentes: dois blocos, cada um com o seu período',
  (SELECT string_agg(DISTINCT m.name, ',' ORDER BY m.name) FROM task_executions e
     JOIN execution_measures x ON x.task_execution_id = e.id JOIN measures m ON m.id = x.measure_id
     JOIN task_execution_tags et ON et.task_execution_id = e.id
   WHERE et.tag_id = pg_temp.u('a0d2', 11)), 'Exercícios,Questões');
SELECT pg_temp.confere('E. janela larga: o antigo (Questões) e o novo (Exercícios) lado a lado, sem se somar',
  pg_temp.w('2025-04-01 00:00', '2025-06-01 00:00'),
  'Questões=1077/5{Acertos=1047/5;ERROS=30/2} Exercícios=10/1{Leitura=7/1;(sem tipo)=3/1} Km=8.75/3{}');

-- "de" é inclusivo, "ate" exclusivo
SELECT pg_temp.confere('F. [de, ate) com o instante exato: E11 em "de" entra, E10 em "ate" não',
  pg_temp.w('2025-04-01 00:00', '2025-04-01 00:00:01'), 'Km=1/1{}');
SELECT pg_temp.confere('G. janela que acaba exatamente no instante do E10 não o inclui',
  pg_temp.w('2025-04-30 00:00', '2025-05-01 00:00'), NULL);
SELECT pg_temp.confere('H. janela que COMEÇA no instante do E10 o inclui',
  pg_temp.w('2025-05-01 00:00', '2025-05-02 00:00'), 'Questões=888/1{Acertos=888/1}');
-- Medida só com valores sem tipo: kinds vazio; com tipos e sem tipo: a soma das linhas = total
SELECT pg_temp.confere('J. Km (só sem tipo): kinds vazio',
  (SELECT json_array_length(kinds)::text FROM pg_temp.medidas(pg_temp.local('2025-04-01 00:00'), pg_temp.local('2025-05-01 00:00')) WHERE key = 'km'), '0');
SELECT pg_temp.confere('K. Exercícios: a soma das linhas (7 + 3) = o total (10)',
  (SELECT (sum((k->>'quantity')::numeric) = max(total))::text
   FROM pg_temp.medidas(pg_temp.local('2025-04-01 00:00'), pg_temp.local('2025-05-01 00:00')) m, json_array_elements(m.kinds) k
   WHERE m.key = 'exercícios'), 'true');
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
