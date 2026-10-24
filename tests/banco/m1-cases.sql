-- Casos da M1 (medidas por contexto). Rodar DEPOIS do DDL.
SET client_min_messages = notice;
CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.aceita(caso text, sql text) RETURNS void AS $$
DECLARE c text;
BEGIN
  EXECUTE sql;
  INSERT INTO resultado VALUES (caso, true, 'aceito');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  INSERT INTO resultado VALUES (caso, false, 'recusado por ' || coalesce(nullif(c, ''), SQLERRM));
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.recusa(caso text, sql text, esperada text) RETURNS void AS $$
DECLARE c text;
BEGIN
  EXECUTE sql;
  INSERT INTO resultado VALUES (caso, false, 'aceito, esperava ' || esperada);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  INSERT INTO resultado VALUES (caso, c = esperada, 'recusado por ' || coalesce(nullif(c, ''), SQLERRM));
END $$ LANGUAGE plpgsql;

-- Confere agora a FK adiável do caminho (e volta a adiar)
CREATE FUNCTION pg_temp.confere() RETURNS void AS $$
BEGIN
  SET CONSTRAINTS execution_measures_tag_on_path IMMEDIATE;
  SET CONSTRAINTS execution_measures_tag_on_path DEFERRED;
END $$ LANGUAGE plpgsql;

-- Árvore: R1 › C1 › G1, R1 › C2, R1 › C3 (folha sem uso) e R2
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('00000000-0000-4000-e000-000000000001', 'm1-code', 1, NULL, NULL),
  ('00000000-0000-4000-e000-000000000002', 'm1-ling', 1, NULL, NULL);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('00000000-0000-4000-e000-000000000011', 'pessoal', 2, '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001'),
  ('00000000-0000-4000-e000-000000000012', 'empresa', 2, '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001'),
  ('00000000-0000-4000-e000-000000000013', 'avulsa',  2, '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001');
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  ('00000000-0000-4000-e000-000000000111', 'proj', 3, '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001');

-- Medidas: M1 em R1 (tipos K1, K2), M2 em C1 (substitui, sem tipos),
-- M3 em R2 (tipo K3), M4 em C3 (nunca usada)
INSERT INTO measures (id, tag_id, name, singular) VALUES
  ('00000000-0000-4000-e100-000000000001', '00000000-0000-4000-e000-000000000001', 'exercícios', 'exercício'),
  ('00000000-0000-4000-e100-000000000002', '00000000-0000-4000-e000-000000000011', 'páginas', 'página'),
  ('00000000-0000-4000-e100-000000000003', '00000000-0000-4000-e000-000000000002', 'exercícios', 'exercício'),
  ('00000000-0000-4000-e100-000000000004', '00000000-0000-4000-e000-000000000013', 'questões', 'questão');
INSERT INTO measure_kinds (id, measure_id, name) VALUES
  ('00000000-0000-4000-e200-000000000001', '00000000-0000-4000-e100-000000000001', 'refatoração'),
  ('00000000-0000-4000-e200-000000000002', '00000000-0000-4000-e100-000000000001', 'leitura'),
  ('00000000-0000-4000-e200-000000000003', '00000000-0000-4000-e100-000000000003', 'escuta');

-- Registros: E1 R1›C1›G1, E6 igual, E3 só R1, E2 só R2, E4 sem tag, E5 R1›C2
INSERT INTO tasks (id, title) VALUES ('00000000-0000-4000-e300-000000000001', 'teste m1');
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
SELECT ('00000000-0000-4000-e400-00000000000' || n)::uuid, '00000000-0000-4000-e300-000000000001', 'teste m1', 'none', now(), r::uuid
FROM (VALUES (1, '00000000-0000-4000-e000-000000000001'), (2, '00000000-0000-4000-e000-000000000002'),
             (3, '00000000-0000-4000-e000-000000000001'), (4, NULL),
             (5, '00000000-0000-4000-e000-000000000001'), (6, '00000000-0000-4000-e000-000000000001')) AS v (n, r);
INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id) VALUES
  ('00000000-0000-4000-e400-000000000001', '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001'),
  ('00000000-0000-4000-e400-000000000001', '00000000-0000-4000-e000-000000000111', '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001'),
  ('00000000-0000-4000-e400-000000000006', '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001'),
  ('00000000-0000-4000-e400-000000000006', '00000000-0000-4000-e000-000000000111', '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001'),
  ('00000000-0000-4000-e400-000000000005', '00000000-0000-4000-e000-000000000012', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001');

-- Atalhos: linha de medida do registro, e valor
CREATE FUNCTION pg_temp.em(e int, m int, t text, r text) RETURNS text AS $$
  SELECT format('INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id) VALUES (%L, %L, %L, %L)',
    '00000000-0000-4000-e400-00000000000' || e, '00000000-0000-4000-e100-00000000000' || m,
    '00000000-0000-4000-e000-' || t, '00000000-0000-4000-e000-' || r)
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.val(e int, m int, k text, q text) RETURNS text AS $$
  SELECT format('INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity) VALUES (%L, %L, %s, %s)',
    '00000000-0000-4000-e400-00000000000' || e, '00000000-0000-4000-e100-00000000000' || m,
    CASE WHEN k IS NULL THEN 'NULL' ELSE quote_literal('00000000-0000-4000-e200-00000000000' || k) END, q)
$$ LANGUAGE sql;
\set R1 '''000000000001'''
\o /dev/null

-- --- Aceites
SELECT pg_temp.aceita('A. registro só com a raiz usa a medida da raiz, 3 refatoração + 2 leitura',
  pg_temp.em(3, 1, '000000000001', '000000000001') || '; ' || pg_temp.val(3, 1, '1', '3') || '; ' || pg_temp.val(3, 1, '2', '2'));
SELECT pg_temp.aceita('B. declarante subtag no caminho (C1 substitui R1), valor sem tipo, decimal',
  format($q$DO $d$ BEGIN %s; %s; PERFORM pg_temp.confere(); END $d$$q$,
    pg_temp.em(1, 2, '000000000011', '000000000001'), pg_temp.val(1, 2, NULL, '5.5')));
SELECT pg_temp.aceita('C. ancestral em vez da mais próxima (E6 usa R1 tendo C1): o banco aceita, regra da API',
  format($q$DO $d$ BEGIN %s; PERFORM pg_temp.confere(); END $d$$q$, pg_temp.em(6, 1, '000000000001', '000000000001')));
SELECT pg_temp.aceita('P. salvar tags como a API (apagar e regravar as ligações do E1, medida em C1)',
  $q$DO $d$ BEGIN
      DELETE FROM task_execution_tags WHERE task_execution_id = '00000000-0000-4000-e400-000000000001';
      INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id) VALUES
        ('00000000-0000-4000-e400-000000000001', '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-e000-000000000001'),
        ('00000000-0000-4000-e400-000000000001', '00000000-0000-4000-e000-000000000111', '00000000-0000-4000-e000-000000000011', '00000000-0000-4000-e000-000000000001');
      PERFORM pg_temp.confere();
    END $d$$q$);

-- --- Recusas: caminho e raiz
SELECT pg_temp.recusa('D1. declarante de outra árvore (E2 é R2, medida de R1)',
  pg_temp.em(2, 1, '000000000001', '000000000002'), 'execution_measures_tag_in_root');
SELECT pg_temp.recusa('D2. raiz mentida (E2 é R2, dizendo R1)',
  pg_temp.em(2, 1, '000000000001', '000000000001'), 'execution_measures_execution_root');
SELECT pg_temp.recusa('E. declarante fora do caminho (E5 é R1›C2, medida de C1)',
  format($q$DO $d$ BEGIN %s; PERFORM pg_temp.confere(); END $d$$q$, pg_temp.em(5, 2, '000000000011', '000000000001')),
  'execution_measures_tag_on_path');
SELECT pg_temp.recusa('F. registro sem tag não tem medida',
  pg_temp.em(4, 1, '000000000001', '000000000001'), 'execution_measures_execution_root');
SELECT pg_temp.recusa('G. segunda medida no mesmo registro (E3 já tem M1)',
  pg_temp.em(3, 3, '000000000002', '000000000002'), 'execution_measures_pkey');
SELECT pg_temp.recusa('Q. tirar a declarante do caminho (E1 fica só com a raiz)',
  $q$DO $d$ BEGIN
      DELETE FROM task_execution_tags WHERE task_execution_id = '00000000-0000-4000-e400-000000000001';
      PERFORM pg_temp.confere();
    END $d$$q$, 'execution_measures_tag_on_path');
SELECT pg_temp.recusa('R. trocar a raiz de registro com medida (E3: R1 → R2)',
  $$UPDATE task_executions SET root_tag_id = '00000000-0000-4000-e000-000000000002'
    WHERE id = '00000000-0000-4000-e400-000000000003'$$, 'execution_measures_execution_root');

-- --- Recusas: valores
SELECT pg_temp.recusa('H. tipo de outra medida (escuta, de R2, em E3 com M1)',
  pg_temp.val(3, 1, '3', '1'), 'execution_measure_values_kind_of_measure');
SELECT pg_temp.recusa('I. mesmo tipo duas vezes (refatoração de novo)',
  pg_temp.val(3, 1, '1', '4'), 'execution_measure_values_one_per_kind');
SELECT pg_temp.recusa('J. dois valores sem tipo',
  pg_temp.val(1, 2, NULL, '1'), 'execution_measure_values_one_per_kind');
SELECT pg_temp.recusa('K. quantidade zero',
  pg_temp.val(6, 1, '1', '0'), 'execution_measure_values_quantity_positive');
SELECT pg_temp.recusa('L. valor sem a medida do registro (E5 não tem linha de medida)',
  pg_temp.val(5, 1, '1', '1'), 'execution_measure_values_execution_measure');
SELECT pg_temp.recusa('L2. valor de outra medida que a do registro (E3 usa M1, valor em M3)',
  pg_temp.val(3, 3, '3', '1'), 'execution_measure_values_execution_measure');

-- --- Recusas: cadastro
SELECT pg_temp.recusa('M. segunda medida na mesma tag',
  $$INSERT INTO measures (tag_id, name, singular) VALUES ('00000000-0000-4000-e000-000000000001', 'questões', 'questão')$$,
  'measures_tag_id_key');
SELECT pg_temp.recusa('N. tipo repetido (" Leitura ", sem distinguir maiúscula/espaço)',
  $$INSERT INTO measure_kinds (measure_id, name) VALUES ('00000000-0000-4000-e100-000000000001', ' Leitura ')$$,
  'measure_kinds_name_unique');
SELECT pg_temp.recusa('O. nome de medida em branco',
  $$INSERT INTO measures (tag_id, name, singular) VALUES ('00000000-0000-4000-e000-000000000012', '  ', 'x')$$,
  'measures_name_valid');
SELECT pg_temp.recusa('S. apagar medida usada (M2, usada pelo E1)',
  $$DELETE FROM measures WHERE id = '00000000-0000-4000-e100-000000000002'$$, 'execution_measures_measure_tag');
SELECT pg_temp.recusa('T. apagar tipo usado (refatoração, usado pelo E3)',
  $$DELETE FROM measure_kinds WHERE id = '00000000-0000-4000-e200-000000000001'$$, 'execution_measure_values_kind_of_measure');
SELECT pg_temp.recusa('U. apagar tag que declara medida (C3, sem uso)',
  $$DELETE FROM tags WHERE id = '00000000-0000-4000-e000-000000000013'$$, 'measures_tag');
SELECT pg_temp.aceita('V. apagar medida nunca usada (M4) e depois a tag dela',
  $$DELETE FROM measures WHERE id = '00000000-0000-4000-e100-000000000004'$$);
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
