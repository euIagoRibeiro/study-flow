-- Casos das seleções por contexto (S0 protótipo, 2026-10-29). Rodam contra a
-- migration 0013 aplicada (no S0 rodavam depois do rascunho, na mesma
-- transação). Transação desfeita: nada sobra.
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

-- Recusado por UMA das constraints esperadas (mais de uma pode recusar a
-- mesma operação; qual dispara primeiro depende da ordem de criação)
CREATE FUNCTION pg_temp.recusa(caso text, sql text, esperadas text[]) RETURNS void AS $$
DECLARE c text;
BEGIN
  EXECUTE sql;
  INSERT INTO resultado VALUES (caso, false, 'aceito, esperava ' || array_to_string(esperadas, ' ou '));
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  INSERT INTO resultado VALUES (caso, c = ANY (esperadas), 'recusado por ' || coalesce(nullif(c, ''), SQLERRM));
END $$ LANGUAGE plpgsql;

-- Ids curtos: t('r1') = tag, s('nat') = seleção, o('estudo') = opção, e(1) = registro
CREATE FUNCTION pg_temp.t(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-f000-' || substr(md5(k), 1, 12))::uuid $$;
-- (md5: o hex da chave passava de 12 caracteres e o lpad CORTAVA, e
-- "tradic2" virava o mesmo id de "tradic")
CREATE FUNCTION pg_temp.s(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-f100-' || substr(md5(k), 1, 12))::uuid $$;
CREATE FUNCTION pg_temp.o(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-f200-' || substr(md5(k), 1, 12))::uuid $$;
CREATE FUNCTION pg_temp.e(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-f300-' || lpad(n::text, 12, '0'))::uuid $$;
-- Uma escolha, como a API vai gravar: (registro, seleção, opção, declarante,
-- raiz, múltipla?, global?)
CREATE FUNCTION pg_temp.esc(e int, sel text, opt text, tag text, raiz text, mult boolean, glob boolean) RETURNS text
LANGUAGE sql AS $$
  SELECT format('INSERT INTO execution_selections (task_execution_id, selection_id, option_id, tag_id, root_tag_id, selection_multiple, selection_global) VALUES (%L, %L, %L, %L, %L, %L, %L)',
    pg_temp.e(e), pg_temp.s(sel), pg_temp.o(opt),
    CASE WHEN tag IS NULL THEN NULL ELSE pg_temp.t(tag) END,
    CASE WHEN raiz IS NULL THEN NULL ELSE pg_temp.t(raiz) END, mult, glob) $$;
-- Confere agora a FK adiável do caminho (e volta a adiar)
CREATE FUNCTION pg_temp.confere() RETURNS void AS $$
BEGIN
  SET CONSTRAINTS execution_selections_tag_on_path IMMEDIATE;
  SET CONSTRAINTS execution_selections_tag_on_path DEFERRED;
END $$ LANGUAGE plpgsql;

-- Árvore: R1 (desenho) › C1 (inktober) › G1 (retrato), R1 › C2 (fundamentos);
-- R2 (tecnologia), R3 (sem seleção, pra apagar)
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.t('r1'), 's0-desenho', 1, NULL, NULL),
  (pg_temp.t('r2'), 's0-tecnologia', 1, NULL, NULL),
  (pg_temp.t('r3'), 's0-avulsa', 1, NULL, NULL);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.t('c1'), 'inktober', 2, pg_temp.t('r1'), pg_temp.t('r1')),
  (pg_temp.t('c2'), 'fundamentos', 2, pg_temp.t('r1'), pg_temp.t('r1'));
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.t('g1'), 'retrato', 3, pg_temp.t('c1'), pg_temp.t('r1'));

-- Registros: E1 R1›C1›G1, E2 R2, E3 só R1, E4 sem tag, E5 R1›C2, E6 só R1
INSERT INTO tasks (id, title) VALUES (pg_temp.e(900), 's0 tarefa');
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
SELECT pg_temp.e(n), pg_temp.e(900), 's0 tarefa', 'none', now(), CASE WHEN r IS NULL THEN NULL ELSE pg_temp.t(r) END
FROM (VALUES (1, 'r1'), (2, 'r2'), (3, 'r1'), (4, NULL), (5, 'r1'), (6, 'r1')) v(n, r);
INSERT INTO task_execution_tags VALUES
  (pg_temp.e(1), pg_temp.t('c1'), pg_temp.t('r1'), pg_temp.t('r1')),
  (pg_temp.e(1), pg_temp.t('g1'), pg_temp.t('c1'), pg_temp.t('r1')),
  (pg_temp.e(5), pg_temp.t('c2'), pg_temp.t('r1'), pg_temp.t('r1'));

-- Seleções: natureza (global, única); meio (R1, única); ferramentas (R1,
-- múltipla); técnica (C1, única, nível 2); detalhe (G1, nível 3);
-- habilidade (R2, múltipla); jamais (R2, nunca usada)
\o /dev/null
SELECT pg_temp.aceita('A1. seleção GLOBAL (sem tag): Natureza',
  format('INSERT INTO selections (id, tag_id, name) VALUES (%L, NULL, %L)', pg_temp.s('nat'), 'Natureza'));
SELECT pg_temp.aceita('A2. seleção na raiz (nível 1): Meio no Desenho',
  format('INSERT INTO selections (id, tag_id, name) VALUES (%L, %L, %L)', pg_temp.s('meio'), pg_temp.t('r1'), 'Meio'));
SELECT pg_temp.aceita('A3. seleção em subtag (nível 2): Técnica no Inktober',
  format('INSERT INTO selections (id, tag_id, name) VALUES (%L, %L, %L)', pg_temp.s('tec'), pg_temp.t('c1'), 'Técnica'));
SELECT pg_temp.aceita('A4. seleção em tema (nível 3): Detalhe no Retrato',
  format('INSERT INTO selections (id, tag_id, name) VALUES (%L, %L, %L)', pg_temp.s('det'), pg_temp.t('g1'), 'Detalhe'));
SELECT pg_temp.aceita('A5. seleção múltipla: Ferramentas no Desenho',
  format('INSERT INTO selections (id, tag_id, name, multiple) VALUES (%L, %L, %L, true)', pg_temp.s('ferr'), pg_temp.t('r1'), 'Ferramentas'));
SELECT pg_temp.aceita('A6. seleção múltipla em outra raiz: Habilidade na Tecnologia',
  format('INSERT INTO selections (id, tag_id, name, multiple) VALUES (%L, %L, %L, true)', pg_temp.s('hab'), pg_temp.t('r2'), 'Habilidade'));
SELECT pg_temp.aceita('A7. o mesmo nome de seleção em OUTRA tag (Meio na Tecnologia)',
  format('INSERT INTO selections (id, tag_id, name) VALUES (%L, %L, %L)', pg_temp.s('meio2'), pg_temp.t('r2'), 'Meio'));
SELECT pg_temp.aceita('A8. seleção que nunca será usada (pra apagar)',
  format('INSERT INTO selections (id, tag_id, name) VALUES (%L, %L, %L)', pg_temp.s('jamais'), pg_temp.t('r2'), 'Jamais'));
INSERT INTO selection_options (id, selection_id, name, position) VALUES
  (pg_temp.o('estudo'), pg_temp.s('nat'), 'estudo', 1), (pg_temp.o('pesquisa'), pg_temp.s('nat'), 'pesquisa', 2),
  (pg_temp.o('pratica'), pg_temp.s('nat'), 'prática', 3),
  (pg_temp.o('digital'), pg_temp.s('meio'), 'digital', 1), (pg_temp.o('tradic'), pg_temp.s('meio'), 'tradicional', 2),
  (pg_temp.o('lapis'), pg_temp.s('ferr'), 'lápis', 1), (pg_temp.o('caneta'), pg_temp.s('ferr'), 'caneta', 2),
  (pg_temp.o('tecx'), pg_temp.s('tec'), 'linha', 1), (pg_temp.o('detz'), pg_temp.s('det'), 'olhos', 1),
  (pg_temp.o('escuta'), pg_temp.s('hab'), 'escuta', 1), (pg_temp.o('fala'), pg_temp.s('hab'), 'fala', 2);
SELECT pg_temp.aceita('A9. o mesmo nome de opção em seleções diferentes ("tradicional" no Meio da Tecnologia)',
  format('INSERT INTO selection_options (id, selection_id, name, position) VALUES (%L, %L, %L, 1)', pg_temp.o('tradic2'), pg_temp.s('meio2'), 'tradicional'));

-- ---- escolhas aceitas
SELECT pg_temp.aceita('B1. escolha GLOBAL sem declarante, em registro SEM TAG (E4: natureza = estudo)',
  pg_temp.esc(4, 'nat', 'estudo', NULL, NULL, false, true));
SELECT pg_temp.aceita('B2. escolha global em registro com tag (E2: natureza = pesquisa)',
  pg_temp.esc(2, 'nat', 'pesquisa', NULL, NULL, false, true));
SELECT pg_temp.aceita('B3. seleção da raiz (E3: meio = digital)',
  pg_temp.esc(3, 'meio', 'digital', 'r1', 'r1', false, false));
SELECT pg_temp.aceita('B4. seleção de nível 2 no caminho (E1: técnica, declarada no Inktober)',
  pg_temp.esc(1, 'tec', 'tecx', 'c1', 'r1', false, false));
SELECT pg_temp.aceita('B5. seleção de nível 3 no caminho (E1: detalhe, declarada no Retrato)',
  pg_temp.esc(1, 'det', 'detz', 'g1', 'r1', false, false));
SELECT pg_temp.aceita('B6. a FK adiável do caminho confere E1 (técnica e detalhe no caminho)', 'SELECT pg_temp.confere()');
SELECT pg_temp.aceita('B7. múltipla com duas opções (E3: lápis)',
  pg_temp.esc(3, 'ferr', 'lapis', 'r1', 'r1', true, false));
SELECT pg_temp.aceita('B8. múltipla com duas opções (E3: caneta)',
  pg_temp.esc(3, 'ferr', 'caneta', 'r1', 'r1', true, false));
SELECT pg_temp.aceita('B9. a mesma seleção em outro registro (E1: meio = digital)',
  pg_temp.esc(1, 'meio', 'digital', 'r1', 'r1', false, false));
SELECT pg_temp.aceita('B10. a mesma seleção em outro registro (E6: meio = tradicional)',
  pg_temp.esc(6, 'meio', 'tradic', 'r1', 'r1', false, false));
SELECT pg_temp.aceita('B11. opção arquivada continua no registro que já a tem (arquivar "digital")',
  format('UPDATE selection_options SET active = false WHERE id = %L', pg_temp.o('digital')));
SELECT pg_temp.aceita('B12. apagar seleção nunca usada (Jamais, sem opções)',
  format('DELETE FROM selections WHERE id = %L', pg_temp.s('jamais')));

-- ---- escolhas recusadas
SELECT pg_temp.recusa('C1. duas opções numa seleção ÚNICA (E3 já tem meio = digital)',
  pg_temp.esc(3, 'meio', 'tradic', 'r1', 'r1', false, false), ARRAY['execution_selections_one_per_single']);
SELECT pg_temp.recusa('C2. opção de OUTRA seleção (E5: meio = "estudo", que é da natureza)',
  pg_temp.esc(5, 'meio', 'estudo', 'r1', 'r1', false, false), ARRAY['execution_selections_option_in_selection']);
SELECT pg_temp.recusa('C3. a mesma opção duas vezes (E3: lápis de novo)',
  pg_temp.esc(3, 'ferr', 'lapis', 'r1', 'r1', true, false), ARRAY['execution_selections_pkey']);
SELECT pg_temp.recusa('C4. "múltipla" mentida (E5: meio, que é única, dita múltipla)',
  pg_temp.esc(5, 'meio', 'tradic', 'r1', 'r1', true, false), ARRAY['execution_selections_multiple']);
SELECT pg_temp.recusa('C5. "global" mentida (E5: meio, que é do Desenho, dita global e sem declarante)',
  pg_temp.esc(5, 'meio', 'tradic', NULL, NULL, false, true), ARRAY['execution_selections_global']);
SELECT pg_temp.recusa('C6. seleção NÃO global com declarante NULL (o furo do MATCH SIMPLE)',
  pg_temp.esc(5, 'meio', 'tradic', NULL, NULL, false, false), ARRAY['execution_selections_global_iff_no_tag']);
SELECT pg_temp.recusa('C7. global COM declarante',
  pg_temp.esc(5, 'nat', 'estudo', 'r1', 'r1', false, true), ARRAY['execution_selections_global_iff_no_tag']);
SELECT pg_temp.recusa('C8. declarante que não é a da seleção (meio é do Desenho, dita do Inktober)',
  pg_temp.esc(5, 'meio', 'tradic', 'c1', 'r1', false, false), ARRAY['execution_selections_selection_tag']);
SELECT pg_temp.recusa('C9. raiz mentida (E2 é Tecnologia, dita Desenho)',
  pg_temp.esc(2, 'meio', 'tradic', 'r1', 'r1', false, false), ARRAY['execution_selections_execution_root']);
SELECT pg_temp.recusa('C10. declarante de outra árvore (habilidade, da Tecnologia, em E3 do Desenho)',
  pg_temp.esc(3, 'hab', 'escuta', 'r2', 'r1', true, false), ARRAY['execution_selections_tag_in_root']);
-- Fora do caminho: a FK é adiável, a recusa vem ao conferir
SELECT pg_temp.recusa('C11. escolha em tag FORA do caminho (E5 é Desenho › Fundamentos; técnica é do Inktober)',
  pg_temp.esc(5, 'tec', 'tecx', 'c1', 'r1', false, false) || '; SELECT pg_temp.confere()', ARRAY['execution_selections_tag_on_path']);

-- ---- nomes e posições
SELECT pg_temp.recusa('D1. seleção com nome repetido na mesma tag ("meio", minúscula, no Desenho)',
  format('INSERT INTO selections (tag_id, name) VALUES (%L, %L)', pg_temp.t('r1'), ' meio '), ARRAY['selections_tag_name_unique']);
SELECT pg_temp.recusa('D2. seleção global com nome repetido ("NATUREZA")',
  format('INSERT INTO selections (tag_id, name) VALUES (NULL, %L)', 'NATUREZA'), ARRAY['selections_global_name_unique']);
SELECT pg_temp.recusa('D3. nome de seleção vazio',
  format('INSERT INTO selections (tag_id, name) VALUES (%L, %L)', pg_temp.t('r1'), '   '), ARRAY['selections_name_valid']);
SELECT pg_temp.recusa('D4. nome de seleção com 31 caracteres',
  format('INSERT INTO selections (tag_id, name) VALUES (%L, %L)', pg_temp.t('r1'), repeat('x', 31)), ARRAY['selections_name_valid']);
SELECT pg_temp.recusa('D5. opção com nome repetido na mesma seleção ("Digital")',
  format('INSERT INTO selection_options (selection_id, name, position) VALUES (%L, %L, 9)', pg_temp.s('meio'), 'Digital'), ARRAY['selection_options_name_unique']);
SELECT pg_temp.recusa('D6. nome de opção vazio',
  format('INSERT INTO selection_options (selection_id, name, position) VALUES (%L, %L, 9)', pg_temp.s('meio'), ''), ARRAY['selection_options_name_valid']);
SELECT pg_temp.recusa('D7. posição repetida na mesma seleção (1)',
  format('INSERT INTO selection_options (selection_id, name, position) VALUES (%L, %L, 1)', pg_temp.s('meio'), 'aquarela'), ARRAY['selection_options_position_unique']);
SELECT pg_temp.recusa('D8. posição zero',
  format('INSERT INTO selection_options (selection_id, name, position) VALUES (%L, %L, 0)', pg_temp.s('meio'), 'aquarela'), ARRAY['selection_options_position_valid']);

-- ---- apagar o que está em uso
SELECT pg_temp.recusa('E1. apagar opção usada (tradicional, de E6)',
  format('DELETE FROM selection_options WHERE id = %L', pg_temp.o('tradic')), ARRAY['execution_selections_option_in_selection']);
SELECT pg_temp.recusa('E2. apagar seleção usada (meio)',
  format('DELETE FROM selections WHERE id = %L', pg_temp.s('meio')),
  ARRAY['selection_options_selection', 'execution_selections_multiple', 'execution_selections_global', 'execution_selections_selection_tag']);
SELECT pg_temp.recusa('E3. apagar tag que declara seleção (Retrato, que E1 usa)',
  format('DELETE FROM task_execution_tags WHERE tag_id = %L; DELETE FROM tags WHERE id = %L', pg_temp.t('g1'), pg_temp.t('g1')),
  ARRAY['selections_tag', 'execution_selections_tag_in_root']);
SELECT pg_temp.recusa('E4. apagar registro que só tem escolha GLOBAL (E4, sem tag: a FK simples)',
  format('DELETE FROM task_executions WHERE id = %L', pg_temp.e(4)), ARRAY['execution_selections_execution']);

-- ---- trocar o caminho
SELECT pg_temp.recusa('F1. tirar a declarante do caminho SEM apagar a escolha (E1 perde Inktober › Retrato)',
  format('DELETE FROM task_execution_tags WHERE task_execution_id = %L; SELECT pg_temp.confere()', pg_temp.e(1)),
  ARRAY['execution_selections_tag_on_path']);
SELECT pg_temp.aceita('F2. trocar o caminho apagando, NA MESMA TRANSAÇÃO, as escolhas que saíram (E1: técnica e detalhe; meio e natureza ficam)',
  format('DELETE FROM execution_selections WHERE task_execution_id = %L AND tag_id IN (%L, %L); DELETE FROM task_execution_tags WHERE task_execution_id = %L; INSERT INTO task_execution_tags VALUES (%L, %L, %L, %L); SELECT pg_temp.confere()',
    pg_temp.e(1), pg_temp.t('c1'), pg_temp.t('g1'), pg_temp.e(1), pg_temp.e(1), pg_temp.t('c2'), pg_temp.t('r1'), pg_temp.t('r1')));
SELECT pg_temp.recusa('F3. trocar a RAIZ de registro com escolha da raiz, sem apagar (E3: Desenho → Tecnologia)',
  format('UPDATE task_executions SET root_tag_id = %L WHERE id = %L', pg_temp.t('r2'), pg_temp.e(3)), ARRAY['execution_selections_execution_root']);
SELECT pg_temp.aceita('F4. trocar a raiz apagando, na mesma transação, as escolhas da raiz antiga (E6: Desenho → Tecnologia)',
  format('DELETE FROM execution_selections WHERE task_execution_id = %L AND root_tag_id IS NOT NULL; UPDATE task_executions SET root_tag_id = %L WHERE id = %L',
    pg_temp.e(6), pg_temp.t('r2'), pg_temp.e(6)));
SELECT pg_temp.aceita('F5. trocar a raiz de registro que só tem escolha GLOBAL (E2: Tecnologia → Desenho; a natureza fica)',
  format('UPDATE task_executions SET root_tag_id = %L WHERE id = %L', pg_temp.t('r1'), pg_temp.e(2)));

-- ---- única ↔ múltipla depois de usada (ON UPDATE CASCADE na cópia)
SELECT pg_temp.aceita('G1. única → múltipla (meio: E1 e E3 com uma opção cada; a cópia acompanha)',
  format('UPDATE selections SET multiple = true WHERE id = %L', pg_temp.s('meio')));
SELECT pg_temp.aceita('G2. múltipla → única ACEITA quando todos os registros têm uma opção (meio de volta)',
  format('UPDATE selections SET multiple = false WHERE id = %L', pg_temp.s('meio')));
SELECT pg_temp.recusa('G3. múltipla → única RECUSADA quando algum registro tem duas (ferramentas: E3 com lápis e caneta)',
  format('UPDATE selections SET multiple = false WHERE id = %L', pg_temp.s('ferr')),
  ARRAY['execution_selections_one_per_single']);
SELECT pg_temp.recusa('G4. mover a seleção usada pra outra tag (meio: Desenho → Inktober)',
  format('UPDATE selections SET tag_id = %L WHERE id = %L', pg_temp.t('c1'), pg_temp.s('meio')),
  ARRAY['execution_selections_selection_tag']);
SELECT pg_temp.recusa('G5. tornar global uma seleção usada (meio: tag → NULL)',
  format('UPDATE selections SET tag_id = NULL WHERE id = %L', pg_temp.s('meio')),
  ARRAY['execution_selections_global', 'execution_selections_selection_tag']);
\o

-- ---- conferências do estado final
INSERT INTO resultado SELECT 'H1. depois de G1/G2, as cópias de "múltipla" do meio voltaram a false',
  bool_and(NOT selection_multiple), count(*) || ' escolhas' FROM execution_selections WHERE selection_id = pg_temp.s('meio');
INSERT INTO resultado SELECT 'H2. F2 tirou só as escolhas do Inktober/Retrato de E1 (ficou o meio)',
  string_agg(selection_id::text, ',') = pg_temp.s('meio')::text, string_agg(selection_id::text, ',')
  FROM execution_selections WHERE task_execution_id = pg_temp.e(1);
INSERT INTO resultado SELECT 'H4. F4: E6 trocou de raiz sem escolhas do Desenho',
  count(*) = 0, count(*) || ' escolha(s)' FROM execution_selections WHERE task_execution_id = pg_temp.e(6);
INSERT INTO resultado SELECT 'H3. F5: E2 trocou de raiz e manteve a natureza (global)',
  count(*) = 1, count(*) || ' escolha(s)' FROM execution_selections WHERE task_execution_id = pg_temp.e(2) AND selection_id = pg_temp.s('nat');

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado ORDER BY caso;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
