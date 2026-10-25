-- Dashboard D-0: as 4 consultas de tempo contra dados próprios, com a conta
-- à mão. Rodar dentro de BEGIN ... ROLLBACK (o run.mjs embrulha): nada sobra.
-- Período em março de 2025: o seed é relativo a hoje e nunca cai lá.
SET client_min_messages = warning;
CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

-- Só uma sessão rodando no app (índice): a do seed fecha DENTRO da transação
-- (o ROLLBACK devolve) pra caber a rodando dos casos
UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL;

-- ---------------------------------------------------------------- dados
-- A (com fases) › A1 › A11, A › A2; B › B1; uma tarefa
INSERT INTO tags (id, name, level, parent_id, root_id, tracks_phase) VALUES
  ('00000000-0000-4000-d000-00000000000a', 'D0 contexto A', 1, NULL, NULL, true),
  ('00000000-0000-4000-d000-00000000000b', 'D0 contexto B', 1, NULL, NULL, false);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('00000000-0000-4000-d000-0000000000a1', 'A1', 2, '00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-d000-00000000000a'),
  ('00000000-0000-4000-d000-0000000000a2', 'A2', 2, '00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-d000-00000000000a'),
  ('00000000-0000-4000-d000-0000000000b1', 'B1', 2, '00000000-0000-4000-d000-00000000000b', '00000000-0000-4000-d000-00000000000b');
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('00000000-0000-4000-d000-000000000a11', 'A11', 3, '00000000-0000-4000-d000-0000000000a1', '00000000-0000-4000-d000-00000000000a');
INSERT INTO tasks (id, title) VALUES ('00000000-0000-4000-d000-000000000001', 'D0 tarefa');

CREATE FUNCTION pg_temp.id(n int) RETURNS uuid LANGUAGE sql AS
  $$SELECT ('00000000-0000-4000-d100-' || lpad(n::text, 12, '0'))::uuid$$;
CREATE FUNCTION pg_temp.local(t text) RETURNS timestamptz LANGUAGE sql AS
  $$SELECT (t::timestamp AT TIME ZONE 'America/Sao_Paulo')$$;
-- registro: n, raiz, fase, concluído?
CREATE FUNCTION pg_temp.reg(n int, raiz uuid, fase phase, aberto boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id, phase)
  VALUES (pg_temp.id(n), '00000000-0000-4000-d000-000000000001', 'D0 tarefa', 'none',
          CASE WHEN aberto THEN NULL ELSE pg_temp.local('2025-04-02 12:00') END, raiz, fase)
$$;
CREATE FUNCTION pg_temp.liga(n int, tag uuid, pai uuid, raiz uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_execution_tags VALUES (pg_temp.id(n), tag, pai, raiz)
$$;
CREATE FUNCTION pg_temp.sessao(n int, ini text, fim text, estimada boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated)
  VALUES (pg_temp.id(n), pg_temp.local(ini), CASE WHEN fim IS NULL THEN NULL ELSE pg_temp.local(fim) END, estimada)
$$;

\o /dev/null
-- A = ...0a, B = ...0b. Hora LOCAL (Brasília, -03)
SELECT pg_temp.reg(1, '00000000-0000-4000-d000-00000000000a', 'requisitos');   -- A › A1 › A11
SELECT pg_temp.liga(1, '00000000-0000-4000-d000-0000000000a1', '00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-d000-00000000000a');
SELECT pg_temp.liga(1, '00000000-0000-4000-d000-000000000a11', '00000000-0000-4000-d000-0000000000a1', '00000000-0000-4000-d000-00000000000a');
SELECT pg_temp.sessao(1, '2025-03-24 22:00', '2025-03-24 23:30');                  -- seg, 90 (em UTC já é terça)
SELECT pg_temp.reg(2, '00000000-0000-4000-d000-00000000000a', 'prototipo');    -- A › A1
SELECT pg_temp.liga(2, '00000000-0000-4000-d000-0000000000a1', '00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-d000-00000000000a');
SELECT pg_temp.sessao(2, '2025-03-25 23:00', '2025-03-26 01:00');                  -- cruza a meia-noite: ter 60 + qua 60
SELECT pg_temp.reg(3, '00000000-0000-4000-d000-00000000000a', NULL);           -- A, sem subtag, sem fase
SELECT pg_temp.sessao(3, '2025-03-26 10:00', '2025-03-26 11:00');                  -- qua 60
SELECT pg_temp.reg(4, '00000000-0000-4000-d000-00000000000b', NULL);           -- B › B1
SELECT pg_temp.liga(4, '00000000-0000-4000-d000-0000000000b1', '00000000-0000-4000-d000-00000000000b', '00000000-0000-4000-d000-00000000000b');
SELECT pg_temp.sessao(4, '2025-03-26 10:30', '2025-03-26 11:30');                  -- qua 60, SOBREPOSTA à 3
SELECT pg_temp.reg(5, NULL, NULL);                                             -- sem tag
SELECT pg_temp.sessao(5, '2025-03-27 19:15', '2025-03-27 20:00', true);            -- qui 45, ESTIMADA
SELECT pg_temp.reg(6, '00000000-0000-4000-d000-00000000000a', 'requisitos');   -- A › A2
SELECT pg_temp.liga(6, '00000000-0000-4000-d000-0000000000a2', '00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-d000-00000000000a');
SELECT pg_temp.sessao(6, '2025-03-23 23:00', '2025-03-24 01:00');                  -- cruza o INÍCIO da semana: 60 dentro
SELECT pg_temp.reg(7, '00000000-0000-4000-d000-00000000000b', NULL);           -- B
SELECT pg_temp.sessao(7, '2025-03-30 23:30', '2025-03-31 00:30');                  -- cruza o FIM da semana: 30 dentro
SELECT pg_temp.reg(8, '00000000-0000-4000-d000-00000000000b', NULL);           -- B
SELECT pg_temp.sessao(8, '2025-03-31 23:00', '2025-04-01 01:00');                  -- cruza a virada do MÊS: 60 em março
SELECT pg_temp.reg(9, '00000000-0000-4000-d000-00000000000a', NULL, true);     -- A › A1, ABERTO
SELECT pg_temp.liga(9, '00000000-0000-4000-d000-0000000000a1', '00000000-0000-4000-d000-00000000000a', '00000000-0000-4000-d000-00000000000a');
SELECT pg_temp.sessao(9, '2025-03-30 20:00', NULL);                                -- RODANDO desde dom 20:00
SELECT pg_temp.reg(10, '00000000-0000-4000-d000-00000000000b', NULL);          -- B
SELECT pg_temp.sessao(10, '2025-03-03 19:00', '2025-03-03 20:00');                 -- 2ª semana de março, 60
SELECT pg_temp.reg(11, '00000000-0000-4000-d000-00000000000b', NULL);          -- B
SELECT pg_temp.sessao(11, '2025-02-28 23:00', '2025-03-01 01:00');                 -- cruza o INÍCIO do mês: 60 em março
\o

-- ---------------------------------------------------------------- consultas
-- (o que a API vai rodar; aqui como funções pra conferir com parâmetros)
-- Recorte comum: só o pedaço da sessão dentro de [de, ate). A rodando conta
-- até now(), e o LEAST(…, ate) do recorte já a limita ao "até" explícito
-- (ate no passado = "como estava até tal hora")
CREATE FUNCTION pg_temp.recorte(de timestamptz, ate timestamptz)
RETURNS TABLE (sessao uuid, execucao uuid, ini timestamptz, fim timestamptz, rodando boolean)
LANGUAGE sql AS $$
  SELECT t.id, t.task_execution_id,
         GREATEST(t.started_at, de),
         LEAST(COALESCE(t.ended_at, now()), ate),
         t.ended_at IS NULL
  FROM time_entries t
  WHERE t.started_at < ate
    AND COALESCE(t.ended_at, now()) > de
$$;
CREATE FUNCTION pg_temp.min(i interval) RETURNS numeric LANGUAGE sql AS
  $$SELECT round(extract(epoch FROM i) / 60, 2)$$;

-- Por contexto: EXATO (uma raiz por registro, cada sessão de um registro só).
-- NULL = "(sem tag)"
CREATE FUNCTION pg_temp.por_contexto(de timestamptz, ate timestamptz)
RETURNS TABLE (tag uuid, minutos numeric) LANGUAGE sql AS $$
  SELECT e.root_tag_id, pg_temp.min(sum(r.fim - r.ini))
  FROM pg_temp.recorte(de, ate) r JOIN task_executions e ON e.id = r.execucao
  GROUP BY e.root_tag_id
$$;

-- Por subtag (nível 2) dentro de um contexto: a mesma sessão pode chegar
-- por duas ligações (nível 3 traz o pai no fechamento) => DISTINCT por
-- sessão e subtag. NULL = "(sem subtag)"
CREATE FUNCTION pg_temp.por_subtag(de timestamptz, ate timestamptz, contexto uuid)
RETURNS TABLE (tag uuid, minutos numeric) LANGUAGE sql AS $$
  WITH r AS (
    SELECT r.* FROM pg_temp.recorte(de, ate) r
    JOIN task_executions e ON e.id = r.execucao AND e.root_tag_id = contexto
  ), por_sessao AS (
    SELECT DISTINCT r.sessao, r.ini, r.fim,
           CASE WHEN t.level = 2 THEN t.id ELSE t.parent_id END AS subtag
    FROM r JOIN task_execution_tags et ON et.task_execution_id = r.execucao
           JOIN tags t ON t.id = et.tag_id
    UNION ALL
    SELECT r.sessao, r.ini, r.fim, NULL FROM r
    WHERE NOT EXISTS (SELECT 1 FROM task_execution_tags et WHERE et.task_execution_id = r.execucao)
  )
  SELECT subtag, pg_temp.min(sum(fim - ini)) FROM por_sessao GROUP BY subtag
$$;

-- Por fase dentro de um contexto com fases: EXATO. NULL = "(sem fase)"
CREATE FUNCTION pg_temp.por_fase(de timestamptz, ate timestamptz, contexto uuid)
RETURNS TABLE (fase phase, minutos numeric) LANGUAGE sql AS $$
  SELECT e.phase, pg_temp.min(sum(r.fim - r.ini))
  FROM pg_temp.recorte(de, ate) r
  JOIN task_executions e ON e.id = r.execucao AND e.root_tag_id = contexto
  JOIN tags c ON c.id = e.root_tag_id AND c.tracks_phase
  GROUP BY e.phase
$$;

-- Por período: faixas de 1 dia ou 1 semana (segunda) NO FUSO, cada sessão
-- dividida entre as faixas que cruza. O fuso só importa aqui
CREATE FUNCTION pg_temp.por_periodo(de timestamptz, ate timestamptz, fuso text, unidade text)
RETURNS TABLE (inicio date, minutos numeric) LANGUAGE sql AS $$
  WITH faixas AS (
    SELECT f::date AS inicio,
           f AT TIME ZONE fuso AS ini,
           (f + ('1 ' || unidade)::interval) AT TIME ZONE fuso AS fim
    FROM generate_series(date_trunc(unidade, de AT TIME ZONE fuso),
                         ate AT TIME ZONE fuso - interval '1 microsecond',
                         ('1 ' || unidade)::interval) f
  )
  -- FILTER: faixa sem sessão vem do LEFT JOIN com r.* nulo, e LEAST/GREATEST
  -- IGNORAM NULL (LEAST(NULL, f.fim) = f.fim): sem ele, dia vazio = 1440
  SELECT f.inicio,
         pg_temp.min(COALESCE(sum(LEAST(r.fim, f.fim) - GREATEST(r.ini, f.ini))
                                FILTER (WHERE r.sessao IS NOT NULL), interval '0'))
  FROM faixas f LEFT JOIN pg_temp.recorte(de, ate) r ON r.ini < f.fim AND r.fim > f.ini
  GROUP BY f.inicio ORDER BY f.inicio
$$;

-- Sobreposição no período (a nota "inclui atividades em paralelo")
CREATE FUNCTION pg_temp.sobreposicao(de timestamptz, ate timestamptz) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_temp.recorte(de, ate) a JOIN pg_temp.recorte(de, ate) b
                 ON a.sessao < b.sessao AND a.ini < b.fim AND b.ini < a.fim)
$$;

-- ---------------------------------------------------------------- casos
CREATE FUNCTION pg_temp.confere(caso text, obtido text, esperado text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO resultado VALUES (caso, obtido IS NOT DISTINCT FROM esperado, 'obtido ' || coalesce(obtido, 'NULL') || ', esperado ' || esperado)
$$;
-- Só os dados do D0 (o resto do banco pode ter sessões em 2025 no futuro?
-- não: o seed é relativo a hoje; conferido no caso 0)
CREATE VIEW pg_temp.semana AS SELECT pg_temp.local('2025-03-24 00:00') AS de, pg_temp.local('2025-03-31 00:00') AS ate;
CREATE VIEW pg_temp.marco AS SELECT pg_temp.local('2025-03-01 00:00') AS de, pg_temp.local('2025-04-01 00:00') AS ate;
CREATE FUNCTION pg_temp.lista(q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE s text; BEGIN EXECUTE 'SELECT string_agg(x, '' '' ORDER BY x) FROM (' || q || ') v(x)' INTO s; RETURN s; END $f$;

\o /dev/null
SELECT pg_temp.confere('0. nenhuma sessão fora do D0 em fev–abr de 2025 (a conta à mão vale)',
  (SELECT count(*)::text FROM time_entries t JOIN task_executions e ON e.id = t.task_execution_id
   WHERE e.task_id <> '00000000-0000-4000-d000-000000000001' AND t.started_at < pg_temp.local('2025-04-08 00:00')
     AND COALESCE(t.ended_at, now()) > pg_temp.local('2025-02-20 00:00')), '0');

-- Semana 24–30/03 (de seg 00:00 a seg 00:00, Brasília)
SELECT pg_temp.confere('A. semana: total 705 min (recorte nas duas bordas, estimada conta, sobrepostas somam, rodando até o "até")',
  (SELECT sum(minutos)::text FROM pg_temp.por_contexto((SELECT de FROM pg_temp.semana), (SELECT ate FROM pg_temp.semana))), '705.00');
SELECT pg_temp.confere('B. por contexto: A 570, B 90, (sem tag) 45',
  pg_temp.lista($$SELECT coalesce(right(tag::text, 2), 'sem') || '=' || minutos FROM pg_temp.por_contexto(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'))$$),
  '0a=570.00 0b=90.00 sem=45.00');
SELECT pg_temp.confere('C. por subtag de A: A1 450 (registro com A1 e A11 conta UMA vez), A2 60, (sem subtag) 60',
  pg_temp.lista($$SELECT coalesce(right(tag::text, 2), 'sem') || '=' || minutos FROM pg_temp.por_subtag(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'), '00000000-0000-4000-d000-00000000000a')$$),
  'a1=450.00 a2=60.00 sem=60.00');
SELECT pg_temp.confere('D. por subtag de A fecha com o total de A (570)',
  (SELECT sum(minutos)::text FROM pg_temp.por_subtag(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'), '00000000-0000-4000-d000-00000000000a')), '570.00');
SELECT pg_temp.confere('E. por fase de A: requisitos 150, protótipo 120, (sem fase) 300',
  pg_temp.lista($$SELECT coalesce(fase::text, 'sem') || '=' || minutos FROM pg_temp.por_fase(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'), '00000000-0000-4000-d000-00000000000a')$$),
  'prototipo=120.00 requisitos=150.00 sem=300.00');
SELECT pg_temp.confere('F. por fase de B (sem fases): vazio',
  (SELECT count(*)::text FROM pg_temp.por_fase(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'), '00000000-0000-4000-d000-00000000000b')), '0');
SELECT pg_temp.confere('G. por dia, no fuso: seg 150 (a das 22h fica na segunda), ter 60, qua 180 (meia-noite dividida), qui 45, sex 0, sáb 0, dom 270',
  (SELECT string_agg(to_char(inicio, 'DD') || '=' || minutos, ' ' ORDER BY inicio) FROM pg_temp.por_periodo(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'), 'America/Sao_Paulo', 'day')),
  '24=150.00 25=60.00 26=180.00 27=45.00 28=0.00 29=0.00 30=270.00');
SELECT pg_temp.confere('H. sobreposição na semana: sim (3 e 4 na quarta)',
  pg_temp.sobreposicao(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00'))::text, 'true');
SELECT pg_temp.confere('I. sobreposição em 01–07/03: não',
  pg_temp.sobreposicao(pg_temp.local('2025-03-01 00:00'), pg_temp.local('2025-03-08 00:00'))::text, 'false');
SELECT pg_temp.confere('J. rodando na semana: 1, com 240 min até o "até"',
  (SELECT count(*) || ' ' || pg_temp.min(sum(fim - ini)) FROM pg_temp.recorte(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-31 00:00')) WHERE rodando), '1 240.00');
SELECT pg_temp.confere('K. "até" no meio da semana (qua 12:00): "como estava": A 330, B 60',
  pg_temp.lista($$SELECT coalesce(right(tag::text, 2), 'sem') || '=' || minutos FROM pg_temp.por_contexto(pg_temp.local('2025-03-24 00:00'), pg_temp.local('2025-03-26 12:00'))$$),
  '0a=330.00 0b=60.00');
SELECT pg_temp.confere('L. "até" no futuro: a rodando conta até now(), não até o "até"',
  (SELECT (abs(extract(epoch FROM fim - now())) < 1)::text FROM pg_temp.recorte(pg_temp.local('2025-03-24 00:00'), now() + interval '1 day') WHERE rodando AND execucao = pg_temp.id(9)), 'true');

-- Março por semana (faixas começando na segunda; a 1ª e a última recortadas)
SELECT pg_temp.confere('M. março por semana: 24/02 60 (só 01–02/03), 03 60, 10 0, 17 60, 24 705, 31 1530',
  (SELECT string_agg(to_char(inicio, 'DD/MM') || '=' || minutos, ' ' ORDER BY inicio) FROM pg_temp.por_periodo(pg_temp.local('2025-03-01 00:00'), pg_temp.local('2025-04-01 00:00'), 'America/Sao_Paulo', 'week')),
  '24/02=60.00 03/03=60.00 10/03=0.00 17/03=60.00 24/03=705.00 31/03=1530.00');
SELECT pg_temp.confere('N. março: total 2415 = soma das faixas',
  (SELECT sum(minutos)::text FROM pg_temp.por_contexto(pg_temp.local('2025-03-01 00:00'), pg_temp.local('2025-04-01 00:00'))), '2415.00');
SELECT pg_temp.confere('O. semana de 2025-03-24 cai na segunda (ISO), e domingo 30 é da mesma semana',
  (date_trunc('week', timestamp '2025-03-30 15:00')::date)::text, '2025-03-24');
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
