-- Casos da nota por sessão (0016, NB1a): a coluna e as três regras de fundo. Rodar DEPOIS da migration, só pelo runner
-- (npm run banco -- notas-cases.sql): os casos não têm transação própria. Frases inventadas, nunca texto de anotação real.
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

-- Registros de teste: E1 (sessões comuns), E2 (aberto, a sessão rodando), E3 e E4 (estimadas)
INSERT INTO tasks (id, title) VALUES ('00000000-0000-4000-c000-000000000410', 'teste notas');
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at) VALUES
  ('00000000-0000-4000-c000-000000000411', '00000000-0000-4000-c000-000000000410', 'teste notas', 'none', '2026-10-20 22:00-03'),
  ('00000000-0000-4000-c000-000000000412', '00000000-0000-4000-c000-000000000410', 'teste notas', 'none', NULL),
  ('00000000-0000-4000-c000-000000000413', '00000000-0000-4000-c000-000000000410', 'teste notas', 'none', '2026-10-20 22:00-03'),
  ('00000000-0000-4000-c000-000000000414', '00000000-0000-4000-c000-000000000410', 'teste notas', 'none', '2026-10-20 22:00-03');

\o /dev/null

SELECT pg_temp.aceita('A. a coluna note existe: text, aceita nulo, sem valor padrão',
  $q$DO $d$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'time_entries' AND column_name = 'note'
          AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL)
      THEN RAISE EXCEPTION 'coluna note fora do combinado'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('B. as três regras existem pelo nome',
  $q$DO $d$ BEGIN
      IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'time_entries'::regclass
          AND conname IN ('time_entries_note_not_blank', 'time_entries_note_length', 'time_entries_note_not_estimated')) <> 3
      THEN RAISE EXCEPTION 'faltam regras'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('C. sessão concluída nasce sem nota (nulo)',
  $q$DO $d$ BEGIN
      INSERT INTO time_entries (id, task_execution_id, started_at, ended_at)
      VALUES ('00000000-0000-4000-c000-000000000421', '00000000-0000-4000-c000-000000000411', '2026-10-20 21:00-03', '2026-10-20 21:30-03');
      IF (SELECT note FROM time_entries WHERE id = '00000000-0000-4000-c000-000000000421') IS NOT NULL
      THEN RAISE EXCEPTION 'nasceu com nota'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('D. nota numa sessão concluída',
  $$UPDATE time_entries SET note = 'frase inventada: revisei o capítulo' WHERE id = '00000000-0000-4000-c000-000000000421'$$);

SELECT pg_temp.aceita('E. nota numa sessão RODANDO (fecha a que o seed deixou rodando, dentro da transação do caso)',
  $q$DO $d$ BEGIN
      UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL;
      INSERT INTO time_entries (id, task_execution_id, started_at, note)
      VALUES ('00000000-0000-4000-c000-000000000422', '00000000-0000-4000-c000-000000000412', now() - interval '10 minutes', 'outra frase inventada');
    END $d$$q$);

SELECT pg_temp.aceita('F. mexer nos horários mantém a nota (o PUT de horários só escreve started_at e ended_at)',
  $q$DO $d$ BEGIN
      UPDATE time_entries SET started_at = started_at - interval '5 minutes', ended_at = ended_at + interval '5 minutes'
      WHERE id = '00000000-0000-4000-c000-000000000421';
      IF (SELECT note FROM time_entries WHERE id = '00000000-0000-4000-c000-000000000421') IS DISTINCT FROM 'frase inventada: revisei o capítulo'
      THEN RAISE EXCEPTION 'a nota mudou'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('G. fechar a sessão rodando (Finalizar) mantém a nota',
  $q$DO $d$ BEGIN
      UPDATE time_entries SET ended_at = now() WHERE id = '00000000-0000-4000-c000-000000000422';
      IF (SELECT note FROM time_entries WHERE id = '00000000-0000-4000-c000-000000000422') IS DISTINCT FROM 'outra frase inventada'
      THEN RAISE EXCEPTION 'a nota mudou'; END IF;
    END $d$$q$);

SELECT pg_temp.aceita('H. texto com acento e quebra de linha',
  $$UPDATE time_entries SET note = E'primeira linha com ação\nsegunda linha, "aspas" e acentuação' WHERE id = '00000000-0000-4000-c000-000000000421'$$);

SELECT pg_temp.aceita('I. exatamente 2000 caracteres',
  $$UPDATE time_entries SET note = repeat('a', 2000) WHERE id = '00000000-0000-4000-c000-000000000421'$$);

SELECT pg_temp.recusa('J. 2001 caracteres',
  $$UPDATE time_entries SET note = repeat('a', 2001) WHERE id = '00000000-0000-4000-c000-000000000421'$$,
  'time_entries_note_length');

SELECT pg_temp.recusa('K. texto vazio',
  $$UPDATE time_entries SET note = '' WHERE id = '00000000-0000-4000-c000-000000000421'$$,
  'time_entries_note_not_blank');

SELECT pg_temp.recusa('L. só espaços',
  $$UPDATE time_entries SET note = '   ' WHERE id = '00000000-0000-4000-c000-000000000421'$$,
  'time_entries_note_not_blank');

SELECT pg_temp.recusa('M. só tabulação e quebra de linha',
  $$UPDATE time_entries SET note = E'\n\t\r\n  ' WHERE id = '00000000-0000-4000-c000-000000000421'$$,
  'time_entries_note_not_blank');

SELECT pg_temp.aceita('N. voltar a nota para nulo (apagar a nota)',
  $$UPDATE time_entries SET note = NULL WHERE id = '00000000-0000-4000-c000-000000000421'$$);

SELECT pg_temp.aceita('O. estimada sem nota',
  $$INSERT INTO time_entries (id, task_execution_id, started_at, ended_at, estimated)
    VALUES ('00000000-0000-4000-c000-000000000423', '00000000-0000-4000-c000-000000000413', '2026-10-20 21:15-03', '2026-10-20 22:00-03', true)$$);

SELECT pg_temp.recusa('P. estimada já criada com nota',
  $$INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated, note)
    VALUES ('00000000-0000-4000-c000-000000000414', '2026-10-20 21:15-03', '2026-10-20 22:00-03', true, 'nota proibida em estimada')$$,
  'time_entries_note_not_estimated');

SELECT pg_temp.recusa('Q. nota posta numa estimada que já existe',
  $$UPDATE time_entries SET note = 'nota proibida em estimada' WHERE id = '00000000-0000-4000-c000-000000000423'$$,
  'time_entries_note_not_estimated');

SELECT pg_temp.aceita('R. uma sessão com nota que ainda não é estimada, mais uma estimada ao lado',
  $$INSERT INTO time_entries (id, task_execution_id, started_at, ended_at, note)
    VALUES ('00000000-0000-4000-c000-000000000424', '00000000-0000-4000-c000-000000000414', '2026-10-20 20:00-03', '2026-10-20 20:30-03', 'sessão comum com nota')$$);

SELECT pg_temp.recusa('S. marcar como estimada uma sessão que tem nota',
  $$UPDATE time_entries SET estimated = true WHERE id = '00000000-0000-4000-c000-000000000424'$$,
  'time_entries_note_not_estimated');

SELECT pg_temp.aceita('T. apagar uma sessão com nota leva a nota junto (a linha some)',
  $q$DO $d$ BEGIN
      DELETE FROM time_entries WHERE id = '00000000-0000-4000-c000-000000000424';
      IF EXISTS (SELECT 1 FROM time_entries WHERE id = '00000000-0000-4000-c000-000000000424')
      THEN RAISE EXCEPTION 'ainda existe'; END IF;
    END $d$$q$);
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
