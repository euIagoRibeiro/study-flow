-- Os 8 casos da fase contra o schema MIGRADO (0006 + 0007 aplicadas).
-- Tudo dentro de uma transação desfeita: não sobra nada no banco.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

CREATE TEMP TABLE resultado (caso text, ok boolean, detalhe text) ON COMMIT DROP;

-- Espera aceitar: roda o SQL e registra OK, ou FALHOU com a constraint
CREATE FUNCTION pg_temp.aceita(caso text, sql text) RETURNS void AS $$
DECLARE c text;
BEGIN
  EXECUTE sql;
  INSERT INTO resultado VALUES (caso, true, 'aceito');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  INSERT INTO resultado VALUES (caso, false, 'recusado por ' || coalesce(nullif(c, ''), SQLERRM));
END $$ LANGUAGE plpgsql;

-- Espera recusar por UMA constraint específica (recusa por outra = FALHOU)
CREATE FUNCTION pg_temp.recusa(caso text, sql text, esperada text) RETURNS void AS $$
DECLARE c text;
BEGIN
  EXECUTE sql;
  INSERT INTO resultado VALUES (caso, false, 'aceito, esperava ' || esperada);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  INSERT INTO resultado VALUES (caso, c = esperada, 'recusado por ' || coalesce(nullif(c, ''), SQLERRM));
END $$ LANGUAGE plpgsql;

INSERT INTO tags (id, name, level, tracks_phase) VALUES
  ('00000000-0000-4000-a000-000000000001', 'teste-code', 1, true),
  ('00000000-0000-4000-a000-000000000002', 'teste-estudo', 1, false);
INSERT INTO tasks (id, title) VALUES ('00000000-0000-4000-a000-000000000010', 'teste fase');

-- Esconde as linhas vazias que cada chamada imprime
\o /dev/null
SELECT pg_temp.aceita('0. ordem do enum (validacao > prototipo, posição 3)',
  $q$DO $d$ BEGIN
      IF NOT ('validacao'::phase > 'prototipo'::phase
              AND array_position(enum_range(NULL::phase), 'validacao'::phase) = 3)
      THEN RAISE EXCEPTION 'ordem errada'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('A. fase em raiz com fases',
  $$INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id, phase)
    VALUES ('00000000-0000-4000-a000-000000000100', '00000000-0000-4000-a000-000000000010', 'teste fase', 'none', now(),
            '00000000-0000-4000-a000-000000000001', 'prototipo')$$);

SELECT pg_temp.recusa('B. fase em raiz sem fases',
  $$INSERT INTO task_executions (task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id, phase)
    VALUES ('00000000-0000-4000-a000-000000000010', 'teste fase', 'none', now(),
            '00000000-0000-4000-a000-000000000002', 'prototipo')$$,
  'task_executions_phase_root_tracks');

SELECT pg_temp.recusa('C. fase sem tag',
  $$INSERT INTO task_executions (task_id, task_title_at_time, task_frequency_at_time, completed_at, phase)
    VALUES ('00000000-0000-4000-a000-000000000010', 'teste fase', 'none', now(), 'prototipo')$$,
  'task_executions_phase_needs_root');

SELECT pg_temp.aceita('D. raiz sem fases, sem fase',
  $$INSERT INTO task_executions (task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
    VALUES ('00000000-0000-4000-a000-000000000010', 'teste fase', 'none', now(),
            '00000000-0000-4000-a000-000000000002')$$);

SELECT pg_temp.recusa('E. desligar fases de raiz usada com fase',
  $$UPDATE tags SET tracks_phase = false WHERE id = '00000000-0000-4000-a000-000000000001'$$,
  'task_executions_phase_root_tracks');

SELECT pg_temp.recusa('F. trocar a raiz sem limpar a fase',
  $$UPDATE task_executions SET root_tag_id = '00000000-0000-4000-a000-000000000002'
    WHERE id = '00000000-0000-4000-a000-000000000100'$$,
  'task_executions_phase_root_tracks');

-- Confere que o UPDATE pegou mesmo a linha (0 linhas também "aceitaria")
SELECT pg_temp.aceita('G. trocar a raiz limpando a fase no mesmo UPDATE',
  $q$DO $d$ DECLARE n int; BEGIN
      UPDATE task_executions SET root_tag_id = '00000000-0000-4000-a000-000000000002', phase = NULL
      WHERE id = '00000000-0000-4000-a000-000000000100';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN RAISE EXCEPTION 'UPDATE pegou % linhas', n; END IF;
    END $d$$q$);

SELECT pg_temp.recusa('H. tracks_phase em subtag',
  $$INSERT INTO tags (name, level, parent_id, root_id, tracks_phase)
    VALUES ('sub', 2, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', true)$$,
  'tags_tracks_phase_only_root');

\o
SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;

ROLLBACK;
