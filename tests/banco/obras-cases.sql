-- Casos das obras (O1, 2026-11-02). Rodam contra a migration 0014 aplicada (no
-- protótipo, depois do rascunho, na mesma transação). Transação desfeita: nada
-- sobra. Nomes próprios de teste (prefixo o1-).
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

-- Valor fora do enum: não há constraint, é o tipo que recusa
CREATE FUNCTION pg_temp.recusa_tipo(caso text, sql text) RETURNS void AS $$
BEGIN
  EXECUTE sql;
  INSERT INTO resultado VALUES (caso, false, 'aceito, esperava erro de tipo');
EXCEPTION WHEN invalid_text_representation THEN
  INSERT INTO resultado VALUES (caso, true, 'recusado pelo enum');
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-f400-' || substr(md5(k), 1, 12))::uuid $$;
-- INSERT de obra com o mínimo; os outros campos entram por `extras` (colunas, valores)
CREATE FUNCTION pg_temp.obra(titulo text, cols text DEFAULT '', vals text DEFAULT '', tag text DEFAULT 'tag') RETURNS text
LANGUAGE sql AS $$
  SELECT format('INSERT INTO works (title, default_tag_id, default_task_id%s) VALUES (%L, %L, %L%s)',
    cols, titulo, pg_temp.id(tag), pg_temp.id('tarefa'), vals) $$;

INSERT INTO tags (id, name, level) VALUES
  (pg_temp.id('tag'), 'o1-raiz', 1),
  (pg_temp.id('outra'), 'o1-outra', 1),
  (pg_temp.id('solta'), 'o1-solta', 1),
  (pg_temp.id('marcada'), 'o1-usada-por-obra', 1);
INSERT INTO tasks (id, title) VALUES
  (pg_temp.id('tarefa'), 'o1-tarefa'),
  (pg_temp.id('tarefa2'), 'o1-tarefa2');
INSERT INTO measures (id, tag_id, name, singular) VALUES
  (pg_temp.id('medida'), pg_temp.id('tag'), 'capítulos', 'capítulo');
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time) VALUES
  (pg_temp.id('registro'), pg_temp.id('tarefa'), 'o1-tarefa', 'none');

-- A. Obra: aceitos
SELECT pg_temp.aceita('A1. só o obrigatório', pg_temp.obra('Soul Eater'));
SELECT pg_temp.aceita('A2. com medida, total e url', pg_temp.obra('Bleach', ', measure_id, total, url',
  format(', %L, 113, %L', pg_temp.id('medida'), 'https://exemplo.com/a')));
SELECT pg_temp.aceita('A3. mesmo título em outra tag', pg_temp.obra('Soul Eater', '', '', 'outra'));
SELECT pg_temp.aceita('A4. total mínimo', pg_temp.obra('Mínimo', ', measure_id, total', format(', %L, 0.01', pg_temp.id('medida'))));
SELECT pg_temp.aceita('A5. status concluido', pg_temp.obra('S1', ', status', ', ''concluido'''));
SELECT pg_temp.aceita('A6. status pausado', pg_temp.obra('S2', ', status', ', ''pausado'''));
SELECT pg_temp.aceita('A7. status abandonado', pg_temp.obra('S3', ', status', ', ''abandonado'''));
SELECT pg_temp.aceita('A8. título com 100 caracteres', pg_temp.obra(repeat('x', 100)));
SELECT pg_temp.aceita('A9. http', pg_temp.obra('U1', ', url', ', ''http://exemplo.com'''));
INSERT INTO resultado SELECT 'A10. status padrão é em_andamento', status = 'em_andamento', status::text
  FROM works WHERE title = 'Soul Eater' AND default_tag_id = pg_temp.id('tag');

-- B. Obra: recusados
SELECT pg_temp.recusa('B1. título vazio', pg_temp.obra(''), 'works_title_valid');
SELECT pg_temp.recusa('B2. título só com espaço', pg_temp.obra('   '), 'works_title_valid');
SELECT pg_temp.recusa('B3. título só com tabulação', pg_temp.obra(E'\t\t'), 'works_title_valid');
SELECT pg_temp.recusa('B4. título só com quebra de linha', pg_temp.obra(E'\n\n'), 'works_title_valid');
SELECT pg_temp.recusa('B5. título com 101 caracteres', pg_temp.obra(repeat('x', 101)), 'works_title_valid');
SELECT pg_temp.recusa('B6. título repetido, outra caixa e espaços', pg_temp.obra('  SOUL EATER '), 'works_title_unique');
SELECT pg_temp.recusa('B7. total zero', pg_temp.obra('T0', ', measure_id, total', format(', %L, 0', pg_temp.id('medida'))), 'works_total_positive');
SELECT pg_temp.recusa('B8. total negativo', pg_temp.obra('T1', ', measure_id, total', format(', %L, -1', pg_temp.id('medida'))), 'works_total_positive');
SELECT pg_temp.recusa('B9. total sem medida', pg_temp.obra('T2', ', total', ', 10'), 'works_total_needs_measure');
SELECT pg_temp.recusa_tipo('B10. status lendo não existe', pg_temp.obra('S4', ', status', ', ''lendo'''));
SELECT pg_temp.recusa('B11. tag inexistente', pg_temp.obra('F1', '', '', 'nao-existe'), 'works_default_tag');
SELECT pg_temp.recusa('B12. tarefa inexistente',
  format('INSERT INTO works (title, default_tag_id, default_task_id) VALUES (''F2'', %L, %L)', pg_temp.id('tag'), pg_temp.id('nao-existe')), 'works_default_task');
SELECT pg_temp.recusa('B13. medida inexistente', pg_temp.obra('F3', ', measure_id', format(', %L', pg_temp.id('nao-existe'))), 'works_measure');

-- C. URL da obra
SELECT pg_temp.recusa('C1. javascript:', pg_temp.obra('U2', ', url', ', ''javascript:alert(1)'''), 'works_url_valid');
SELECT pg_temp.recusa('C2. ftp', pg_temp.obra('U3', ', url', ', ''ftp://exemplo.com'''), 'works_url_valid');
SELECT pg_temp.recusa('C3. com espaço', pg_temp.obra('U4', ', url', ', ''http://exemplo.com/a b'''), 'works_url_valid');
SELECT pg_temp.recusa('C4. 2001 caracteres', pg_temp.obra('U5', ', url', format(', %L', 'http://' || repeat('x', 1994))), 'works_url_valid');
SELECT pg_temp.recusa('C5. HTTP maiúsculo (a API normaliza antes)', pg_temp.obra('U6', ', url', ', ''HTTP://exemplo.com'''), 'works_url_valid');
SELECT pg_temp.recusa('C6. quebra de linha no fim', pg_temp.obra('U7', ', url', format(', %L', E'http://exemplo.com\n')), 'works_url_valid');
SELECT pg_temp.recusa('C7. http:// sozinho', pg_temp.obra('U8', ', url', ', ''http://'''), 'works_url_valid');
SELECT pg_temp.recusa('C8. vazio (a API grava NULL)', pg_temp.obra('U9', ', url', ', '''''), 'works_url_valid');
SELECT pg_temp.aceita('C9. exatamente 2000 caracteres', pg_temp.obra('U10', ', url', format(', %L', 'http://' || repeat('x', 1993))));

-- D. Registro
SELECT pg_temp.aceita('D1. registro aponta pra obra',
  format('UPDATE task_executions SET work_id = (SELECT id FROM works WHERE title = ''Bleach'') WHERE id = %L', pg_temp.id('registro')));
SELECT pg_temp.aceita('D2. caminho diferente do padrão da obra',
  format('UPDATE task_executions SET root_tag_id = %L WHERE id = %L', pg_temp.id('outra'), pg_temp.id('registro')));
SELECT pg_temp.aceita('D3. com link', format('UPDATE task_executions SET link_url = ''https://exemplo.com/video?t=42'' WHERE id = %L', pg_temp.id('registro')));
SELECT pg_temp.recusa('D4. obra inexistente', format('UPDATE task_executions SET work_id = %L WHERE id = %L', pg_temp.id('nao-existe'), pg_temp.id('registro')), 'task_executions_work');
SELECT pg_temp.recusa('D5. link javascript:', format('UPDATE task_executions SET link_url = ''javascript:alert(1)'' WHERE id = %L', pg_temp.id('registro')), 'task_executions_link_url_valid');
SELECT pg_temp.recusa('D6. link com quebra de linha', format('UPDATE task_executions SET link_url = %L WHERE id = %L', E'http://exemplo.com\n', pg_temp.id('registro')), 'task_executions_link_url_valid');
SELECT pg_temp.recusa('D7. link http:// sozinho', format('UPDATE task_executions SET link_url = ''http://'' WHERE id = %L', pg_temp.id('registro')), 'task_executions_link_url_valid');
SELECT pg_temp.recusa('D8. link maiúsculo', format('UPDATE task_executions SET link_url = ''HTTPS://exemplo.com'' WHERE id = %L', pg_temp.id('registro')), 'task_executions_link_url_valid');
SELECT pg_temp.recusa('D9. link com 2001 caracteres', format('UPDATE task_executions SET link_url = %L WHERE id = %L', 'http://' || repeat('x', 1994), pg_temp.id('registro')), 'task_executions_link_url_valid');

-- E. Tag padrão arquivada: a obra fica, nada bloqueia
SELECT pg_temp.aceita('E1. obra em tag',  pg_temp.obra('Presa', '', '', 'marcada'));
SELECT pg_temp.aceita('E2. arquivar tag padrão de obra', format('UPDATE tags SET active = false WHERE id = %L', pg_temp.id('marcada')));
SELECT pg_temp.aceita('E3. obra nova em tag arquivada', pg_temp.obra('Presa 2', '', '', 'marcada'));

-- F. Apagar: RESTRICT
SELECT pg_temp.aceita('F1. apagar obra sem registro', 'DELETE FROM works WHERE title = ''S1''');
SELECT pg_temp.recusa('F2. apagar obra com registro', 'DELETE FROM works WHERE title = ''Bleach''', 'task_executions_work');
SELECT pg_temp.recusa('F3. apagar tag padrão de obra', format('DELETE FROM tags WHERE id = %L', pg_temp.id('marcada')), 'works_default_tag');
SELECT pg_temp.recusa('F4. apagar medida usada por obra', format('DELETE FROM measures WHERE id = %L', pg_temp.id('medida')), 'works_measure');
INSERT INTO works (title, default_tag_id, default_task_id) VALUES ('Outra tarefa', pg_temp.id('tag'), pg_temp.id('tarefa2'));
SELECT pg_temp.recusa('F5. apagar tarefa padrão de obra', format('DELETE FROM tasks WHERE id = %L', pg_temp.id('tarefa2')), 'works_default_task');
SELECT pg_temp.aceita('F6. registro larga a obra, e aí ela pode sair',
  format('UPDATE task_executions SET work_id = NULL WHERE id = %L', pg_temp.id('registro')));
SELECT pg_temp.aceita('F7. apagar a obra largada', 'DELETE FROM works WHERE title = ''Bleach''');

-- G. Trigger
CREATE TEMP TABLE antes ON COMMIT DROP AS SELECT id, updated_at FROM works WHERE title = 'Soul Eater' LIMIT 1;
UPDATE works SET updated_at = '2000-01-01' WHERE id = (SELECT id FROM antes);
UPDATE works SET status = 'pausado' WHERE id = (SELECT id FROM antes);
INSERT INTO resultado SELECT 'G1. updated_at acompanha a mudança', updated_at > '2000-01-02', updated_at::text
  FROM works WHERE id = (SELECT id FROM antes);

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado ORDER BY caso;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
