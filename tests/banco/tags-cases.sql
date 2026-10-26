-- Painel D7-0: tempo por tags escolhidas livremente (qualquer nível), com a
-- conta à mão. Rodar dentro de BEGIN ... ROLLBACK (o run.mjs embrulha).
-- Semana de 24/03/2025 (o seed é relativo a hoje e nunca cai lá; caso 0).
-- Regras (CLAUDE.md, 2026-10-04 e Painel v2):
--   - tempo sob um nó = sessões de registros com o nó no caminho: nível 1
--     pela raiz do registro; nível 2/3 pela subárvore (t.id = X OR
--     t.parent_id = X OR p.parent_id = X), NÃO só pelo fechamento gravado
--     (o fechamento é calculado pela API; o banco não garante o pai);
--   - DISTINCT por (nó, sessão): o mesmo registro chega por duas ligações;
--   - a união dos escolhidos conta cada sessão UMA vez (aninhados não somam).
SET client_min_messages = warning;
CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

-- ---------------------------------------------------------------- dados
-- V › VM › VMA, VMG; V › VF › VFX (nunca usada)   ("Vestibular › Matemática › Álgebra")
-- M › MA                                           ("Matemática › Álgebra")
-- X › XA (ARQUIVADA)
CREATE FUNCTION pg_temp.t(s text) RETURNS uuid LANGUAGE sql AS
  $$SELECT ('00000000-0000-4000-d700-' || lpad(s, 12, '0'))::uuid$$;
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.t('a'), 'D7 V', 1, NULL, NULL),
  (pg_temp.t('b'), 'D7 M', 1, NULL, NULL),
  (pg_temp.t('c'), 'D7 X', 1, NULL, NULL);
INSERT INTO tags (id, name, level, parent_id, root_id, active) VALUES
  (pg_temp.t('a1'), 'Matemática', 2, pg_temp.t('a'), pg_temp.t('a'), true),
  (pg_temp.t('a2'), 'Física', 2, pg_temp.t('a'), pg_temp.t('a'), true),
  (pg_temp.t('b1'), 'Álgebra', 2, pg_temp.t('b'), pg_temp.t('b'), true),
  (pg_temp.t('c1'), 'Arquivada', 2, pg_temp.t('c'), pg_temp.t('c'), false);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.t('a11'), 'Álgebra', 3, pg_temp.t('a1'), pg_temp.t('a')),
  (pg_temp.t('a12'), 'Geometria', 3, pg_temp.t('a1'), pg_temp.t('a')),
  (pg_temp.t('a21'), 'Nunca usada', 3, pg_temp.t('a2'), pg_temp.t('a'));
INSERT INTO tasks (id, title) VALUES (pg_temp.t('1'), 'D7 tarefa');

CREATE FUNCTION pg_temp.id(n int) RETURNS uuid LANGUAGE sql AS
  $$SELECT ('00000000-0000-4000-d701-' || lpad(n::text, 12, '0'))::uuid$$;
CREATE FUNCTION pg_temp.local(t text) RETURNS timestamptz LANGUAGE sql AS
  $$SELECT (t::timestamp AT TIME ZONE 'America/Sao_Paulo')$$;
CREATE FUNCTION pg_temp.reg(n int, raiz uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
  VALUES (pg_temp.id(n), pg_temp.t('1'), 'D7 tarefa', 'none', pg_temp.local('2025-04-02 12:00'), raiz)
$$;
-- ligação: a tag, com o pai e a raiz que a FK confere
CREATE FUNCTION pg_temp.liga(n int, tag uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_execution_tags SELECT pg_temp.id(n), t.id, t.parent_id, t.root_id FROM tags t WHERE t.id = tag
$$;
CREATE FUNCTION pg_temp.sessao(n int, ini text, fim text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO time_entries (task_execution_id, started_at, ended_at)
  VALUES (pg_temp.id(n), pg_temp.local(ini), pg_temp.local(fim))
$$;

\o /dev/null
SELECT pg_temp.reg(1, pg_temp.t('a')); SELECT pg_temp.liga(1, pg_temp.t('a1')); SELECT pg_temp.liga(1, pg_temp.t('a11'));
SELECT pg_temp.sessao(1, '2025-03-24 10:00', '2025-03-24 11:00');   -- V›VM›VMA (fechamento), seg 60
SELECT pg_temp.sessao(1, '2025-03-24 20:00', '2025-03-24 20:20');   -- 2ª sessão do mesmo registro, 20
SELECT pg_temp.reg(2, pg_temp.t('a')); SELECT pg_temp.liga(2, pg_temp.t('a1'));
SELECT pg_temp.sessao(2, '2025-03-23 23:30', '2025-03-24 00:30');   -- V›VM, cruza o INÍCIO: 30 dentro
SELECT pg_temp.reg(3, pg_temp.t('a')); SELECT pg_temp.liga(3, pg_temp.t('a2'));
SELECT pg_temp.sessao(3, '2025-03-25 10:00', '2025-03-25 10:45');   -- V›VF, ter 45
SELECT pg_temp.reg(4, pg_temp.t('a'));
SELECT pg_temp.sessao(4, '2025-03-25 14:00', '2025-03-25 14:20');   -- V sem subtag, ter 20
SELECT pg_temp.reg(5, pg_temp.t('b')); SELECT pg_temp.liga(5, pg_temp.t('b1'));
SELECT pg_temp.sessao(5, '2025-03-26 09:00', '2025-03-26 09:40');   -- M›MA, qua 40
SELECT pg_temp.reg(6, pg_temp.t('b'));
SELECT pg_temp.sessao(6, '2025-03-26 20:00', '2025-03-26 20:15');   -- M sem subtag, qua 15
SELECT pg_temp.reg(7, pg_temp.t('a')); SELECT pg_temp.liga(7, pg_temp.t('a1')); SELECT pg_temp.liga(7, pg_temp.t('a12'));
SELECT pg_temp.sessao(7, '2025-03-27 10:00', '2025-03-27 10:25');   -- V›VM›VMG (fechamento), qui 25
SELECT pg_temp.reg(8, pg_temp.t('a')); SELECT pg_temp.liga(8, pg_temp.t('a11'));
SELECT pg_temp.sessao(8, '2025-03-28 10:00', '2025-03-28 10:10');   -- V›VM›VMA SEM o pai gravado, sex 10
SELECT pg_temp.reg(9, pg_temp.t('c')); SELECT pg_temp.liga(9, pg_temp.t('c1'));
SELECT pg_temp.sessao(9, '2025-03-29 10:00', '2025-03-29 10:50');   -- X›XA (arquivada), sáb 50
\o

-- ---------------------------------------------------------------- consulta
-- (a que a rota vai rodar; recorte igual ao das outras rotas)
CREATE FUNCTION pg_temp.recorte(de timestamptz, ate timestamptz)
RETURNS TABLE (sessao uuid, execucao uuid, ini timestamptz, fim timestamptz)
LANGUAGE sql AS $$
  SELECT t.id, t.task_execution_id, GREATEST(t.started_at, de), LEAST(COALESCE(t.ended_at, now()), ate)
  FROM time_entries t WHERE t.started_at < ate AND COALESCE(t.ended_at, now()) > de
$$;
CREATE FUNCTION pg_temp.min(i interval) RETURNS numeric LANGUAGE sql AS
  $$SELECT round(extract(epoch FROM i) / 60, 2)$$;

-- Sessões sob cada nó escolhido, uma vez por (nó, sessão)
CREATE FUNCTION pg_temp.sob(de timestamptz, ate timestamptz, escolhidas uuid[])
RETURNS TABLE (no uuid, sessao uuid, ini timestamptz, fim timestamptz) LANGUAGE sql AS $$
  WITH n AS (SELECT id, level FROM tags WHERE id = ANY (escolhidas)),
  r AS (SELECT * FROM pg_temp.recorte(de, ate))
  -- nível 1: a raiz do registro (exato, como por contexto)
  SELECT n.id, r.sessao, r.ini, r.fim
  FROM r JOIN task_executions e ON e.id = r.execucao
         JOIN n ON n.level = 1 AND e.root_tag_id = n.id
  UNION
  -- nível 2/3: qualquer tag do registro na subárvore do nó
  SELECT DISTINCT n.id, r.sessao, r.ini, r.fim
  FROM r JOIN task_execution_tags et ON et.task_execution_id = r.execucao
         JOIN tags t ON t.id = et.tag_id
         LEFT JOIN tags p ON p.id = t.parent_id
         JOIN n ON n.level > 1 AND (t.id = n.id OR t.parent_id = n.id OR p.parent_id = n.id)
$$;

-- Itens: cada escolhido, com 0 se não tem tempo
CREATE FUNCTION pg_temp.por_tags(de timestamptz, ate timestamptz, escolhidas uuid[])
RETURNS TABLE (tag uuid, minutos numeric) LANGUAGE sql AS $$
  SELECT n.id, pg_temp.min(COALESCE(sum(s.fim - s.ini), interval '0'))
  FROM tags n LEFT JOIN pg_temp.sob(de, ate, escolhidas) s ON s.no = n.id
  WHERE n.id = ANY (escolhidas)
  GROUP BY n.id
$$;

-- União: cada sessão uma vez, venha de quantos escolhidos vier
CREATE FUNCTION pg_temp.uniao(de timestamptz, ate timestamptz, escolhidas uuid[])
RETURNS numeric LANGUAGE sql AS $$
  SELECT pg_temp.min(COALESCE(sum(fim - ini), interval '0'))
  FROM (SELECT DISTINCT sessao, ini, fim FROM pg_temp.sob(de, ate, escolhidas)) u
$$;

-- ---------------------------------------------------------------- casos
CREATE FUNCTION pg_temp.confere(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO resultado VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)
$$;
CREATE FUNCTION pg_temp.de() RETURNS timestamptz LANGUAGE sql AS $$SELECT pg_temp.local('2025-03-24 00:00')$$;
CREATE FUNCTION pg_temp.ate() RETURNS timestamptz LANGUAGE sql AS $$SELECT pg_temp.local('2025-03-31 00:00')$$;
-- "nome=minutos" dos itens, na ordem do nome curto
CREATE FUNCTION pg_temp.itens(escolhidas uuid[], ate timestamptz DEFAULT pg_temp.ate()) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(replace(right(tag::text, 3), '0', '') || '=' || minutos, ' ' ORDER BY replace(right(tag::text, 3), '0', ''))
  FROM pg_temp.por_tags(pg_temp.de(), ate, escolhidas)
$$;

\o /dev/null
SELECT pg_temp.confere('0. nenhuma sessão fora do D7 na semana de 24/03/2025 (a conta à mão vale)',
  (SELECT count(*)::text FROM time_entries t JOIN task_executions e ON e.id = t.task_execution_id
   WHERE e.task_id <> pg_temp.t('1') AND t.started_at < pg_temp.ate() AND COALESCE(t.ended_at, now()) > pg_temp.de()), '0');

-- As duas Álgebras: raízes diferentes nunca dividem registro, somam exato
SELECT pg_temp.confere('A. Álgebra de V›VM (nível 3) = 90 (registro 1 com 2 sessões + o 8 SEM o pai gravado); Álgebra de M (nível 2) = 40',
  pg_temp.itens(ARRAY[pg_temp.t('a11'), pg_temp.t('b1')]), 'a11=90.00 b1=40.00');
SELECT pg_temp.confere('B. "toda a álgebra" (união das duas) = 130 = 90 + 40',
  pg_temp.uniao(pg_temp.de(), pg_temp.ate(), ARRAY[pg_temp.t('a11'), pg_temp.t('b1')])::text, '130.00');

-- Nível 2 com netos: cada sessão UMA vez, inclusive sem o fechamento
SELECT pg_temp.confere('C. VM (nível 2) = 145: 80 (1, ligado em VM e VMA, conta uma vez) + 30 (2, recortada) + 25 (7) + 10 (8, só VMA gravada)',
  pg_temp.itens(ARRAY[pg_temp.t('a1')]), 'a1=145.00');
SELECT pg_temp.confere('D. V (nível 1, pela raiz) = 210: 80 + 30 + 45 + 20 + 25 + 10',
  pg_temp.itens(ARRAY[pg_temp.t('a')]), 'a=210.00');
SELECT pg_temp.confere('E. M (nível 1) = 55 (com e sem subtag)',
  pg_temp.itens(ARRAY[pg_temp.t('b')]), 'b=55.00');

-- Aninhados: cada item certo sozinho; a união NÃO é a soma
SELECT pg_temp.confere('F. aninhados V + VM: itens 210 e 145',
  pg_temp.itens(ARRAY[pg_temp.t('a'), pg_temp.t('a1')]), 'a=210.00 a1=145.00');
SELECT pg_temp.confere('G. aninhados V + VM: união 210 (não 355)',
  pg_temp.uniao(pg_temp.de(), pg_temp.ate(), ARRAY[pg_temp.t('a'), pg_temp.t('a1')])::text, '210.00');
SELECT pg_temp.confere('H. V, M e as duas Álgebras: união 265 = V 210 + M 55',
  pg_temp.uniao(pg_temp.de(), pg_temp.ate(), ARRAY[pg_temp.t('a'), pg_temp.t('b'), pg_temp.t('a11'), pg_temp.t('b1')])::text, '265.00');

-- Arquivada entra (é histórico); escolhida sem tempo aparece com 0
SELECT pg_temp.confere('I. tag arquivada: 50',
  pg_temp.itens(ARRAY[pg_temp.t('c1')]), 'c1=50.00');
SELECT pg_temp.confere('J. escolhida sem tempo (nunca usada): item com 0, ao lado das outras',
  pg_temp.itens(ARRAY[pg_temp.t('a21'), pg_temp.t('a2')]), 'a2=45.00 a21=0.00');
SELECT pg_temp.confere('K. nenhuma com tempo: união 0',
  pg_temp.uniao(pg_temp.de(), pg_temp.ate(), ARRAY[pg_temp.t('a21')])::text, '0.00');

-- Recorte e "até", como nas outras rotas
SELECT pg_temp.confere('L. "até" qua 00:00 ("como estava"): V 175, VM 110',
  pg_temp.itens(ARRAY[pg_temp.t('a'), pg_temp.t('a1')], pg_temp.local('2025-03-26 00:00')), 'a=175.00 a1=110.00');
SELECT pg_temp.confere('M. V = soma de por contexto (a regra exata) na mesma semana',
  (SELECT pg_temp.min(sum(r.fim - r.ini))::text FROM pg_temp.recorte(pg_temp.de(), pg_temp.ate()) r
   JOIN task_executions e ON e.id = r.execucao WHERE e.root_tag_id = pg_temp.t('a')), '210.00');
SELECT pg_temp.confere('N. o registro 8 só tem a ligação de nível 3 (o banco aceita: o fechamento não é garantido)',
  (SELECT string_agg(replace(right(tag_id::text, 3), '0', ''), ' ') FROM task_execution_tags WHERE task_execution_id = pg_temp.id(8)), 'a11');
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
