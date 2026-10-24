-- Casos da A1 (sessão estimada). Rodar DEPOIS do DDL (no protótipo, o DDL
-- vem antes no mesmo arquivo; contra o schema migrado, só isto).
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

INSERT INTO tasks (id, title) VALUES ('00000000-0000-4000-c000-000000000010', 'teste a1');
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at) VALUES
  ('00000000-0000-4000-c000-000000000101', '00000000-0000-4000-c000-000000000010', 'teste a1', 'none', '2026-10-20 22:00-03'),
  ('00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c000-000000000010', 'teste a1', 'none', '2026-10-20 22:30-03');

\o /dev/null
-- (O caso 0, "nenhuma estimada fora do teste", conferia os dados no dia da
-- migration 0008. Saiu ao ir pra tests/: o seed tem estimadas de propósito)

SELECT pg_temp.aceita('A. estimada encerrada (45 min antes do Quando)',
  $$INSERT INTO time_entries (id, task_execution_id, started_at, ended_at, estimated)
    VALUES ('00000000-0000-4000-c000-000000000201', '00000000-0000-4000-c000-000000000101',
            '2026-10-20 21:15-03', '2026-10-20 22:00-03', true)$$);

SELECT pg_temp.recusa('B. estimada rodando (sem fim)',
  $$INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated)
    VALUES ('00000000-0000-4000-c000-000000000102', '2026-10-20 22:00-03', NULL, true)$$,
  'time_entries_estimated_ended');

SELECT pg_temp.recusa('C. segunda estimada no mesmo registro',
  $$INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated)
    VALUES ('00000000-0000-4000-c000-000000000101', '2026-10-20 20:00-03', '2026-10-20 20:30-03', true)$$,
  'time_entries_one_estimate');

SELECT pg_temp.aceita('D. estimada SOBREPOSTA a outra estimada (outro registro, mesma noite)',
  $$INSERT INTO time_entries (id, task_execution_id, started_at, ended_at, estimated)
    VALUES ('00000000-0000-4000-c000-000000000202', '00000000-0000-4000-c000-000000000102',
            '2026-10-20 21:30-03', '2026-10-20 22:30-03', true)$$);

SELECT pg_temp.aceita('E. cronômetro + estimativa no mesmo registro',
  $$INSERT INTO time_entries (task_execution_id, started_at, ended_at)
    VALUES ('00000000-0000-4000-c000-000000000101', '2026-10-20 19:00-03', '2026-10-20 19:20-03')$$);

SELECT pg_temp.recusa('F. sessão rodando virar estimada',
  $$UPDATE time_entries SET estimated = true WHERE ended_at IS NULL$$,
  'time_entries_estimated_ended');

-- O mesmo UPDATE que a API vai fazer ao mudar o "Quando": mover as duas pontas
SELECT pg_temp.aceita('G. mover a estimada junto com o Quando (mantém 45 min)',
  $q$DO $d$ DECLARE n int; BEGIN
      UPDATE time_entries
      SET started_at = started_at + interval '1 day', ended_at = ended_at + interval '1 day'
      WHERE id = '00000000-0000-4000-c000-000000000201';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN RAISE EXCEPTION 'pegou % linhas', n; END IF;
      IF (SELECT ended_at - started_at FROM time_entries WHERE id = '00000000-0000-4000-c000-000000000201')
         <> interval '45 minutes' THEN RAISE EXCEPTION 'duração mudou'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('H. "uma rodando no app" continua valendo e não conta estimada',
  $q$DO $d$ BEGIN
      IF (SELECT count(*) FROM time_entries WHERE ended_at IS NULL) > 1
      THEN RAISE EXCEPTION 'mais de uma rodando'; END IF;
    END $d$$q$);
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
