-- Casos da A3 (treino). Rodar DEPOIS do DDL, dentro de BEGIN ... ROLLBACK.
-- Caso aceito fica gravado (os seguintes usam); recusado volta sozinho
-- (cada caso roda num bloco com EXCEPTION = savepoint).
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
  SET CONSTRAINTS execution_workouts_tag_on_path IMMEDIATE;
  SET CONSTRAINTS execution_workouts_tag_on_path DEFERRED;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.id(grupo text, n int) RETURNS uuid AS $$
  SELECT ('00000000-0000-4000-' || grupo || '-' || lpad(n::text, 12, '0'))::uuid
$$ LANGUAGE sql;

-- Árvore: R › academia (treino) › peito; R › casa (treino); R › corrida;
-- R2 = raiz que usa treino ela mesma
INSERT INTO tags (id, name, level, parent_id, root_id, tracks_workout) VALUES
  (pg_temp.id('f000', 1), 'a3-exer', 1, NULL, NULL, false),
  (pg_temp.id('f000', 2), 'a3-outro', 1, NULL, NULL, true);
INSERT INTO tags (id, name, level, parent_id, root_id, tracks_workout) VALUES
  (pg_temp.id('f000', 11), 'academia', 2, pg_temp.id('f000', 1), pg_temp.id('f000', 1), true),
  (pg_temp.id('f000', 12), 'casa',     2, pg_temp.id('f000', 1), pg_temp.id('f000', 1), true),
  (pg_temp.id('f000', 13), 'corrida',  2, pg_temp.id('f000', 1), pg_temp.id('f000', 1), false);
INSERT INTO tags (id, name, level, parent_id, root_id) VALUES
  (pg_temp.id('f000', 111), 'peito', 3, pg_temp.id('f000', 11), pg_temp.id('f000', 1));

-- Catálogo (o equipamento no nome)
INSERT INTO exercises (id, name) VALUES
  (pg_temp.id('f100', 1), 'Teste A3 puxada alta com barra'),
  (pg_temp.id('f100', 2), 'Teste A3 puxada alta com triângulo'),
  (pg_temp.id('f100', 3), 'Teste A3 rosca martelo unilateral'),
  (pg_temp.id('f100', 4), 'Teste A3 agachamento'),
  (pg_temp.id('f100', 5), 'Nunca usado');

-- Registros: E1 academia, E2 casa, E3 corrida, E4 sem tag, E5 academia ›
-- peito, E6 academia ABERTO, E7 raiz R2, E8 casa (pra marcadora fora do caminho)
INSERT INTO tasks (id, title) VALUES (pg_temp.id('f300', 1), 'teste a3');
INSERT INTO task_executions (id, task_id, task_title_at_time, task_frequency_at_time, completed_at, root_tag_id)
SELECT pg_temp.id('f400', n), pg_temp.id('f300', 1), 'teste a3', 'none',
       CASE WHEN n = 6 THEN NULL ELSE now() END, r
FROM (VALUES (1, pg_temp.id('f000', 1)), (2, pg_temp.id('f000', 1)), (3, pg_temp.id('f000', 1)),
             (4, NULL), (5, pg_temp.id('f000', 1)), (6, pg_temp.id('f000', 1)),
             (7, pg_temp.id('f000', 2)), (8, pg_temp.id('f000', 1))) AS v (n, r);
INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id) VALUES
  (pg_temp.id('f400', 1), pg_temp.id('f000', 11), pg_temp.id('f000', 1), pg_temp.id('f000', 1)),
  (pg_temp.id('f400', 2), pg_temp.id('f000', 12), pg_temp.id('f000', 1), pg_temp.id('f000', 1)),
  (pg_temp.id('f400', 3), pg_temp.id('f000', 13), pg_temp.id('f000', 1), pg_temp.id('f000', 1)),
  (pg_temp.id('f400', 5), pg_temp.id('f000', 11), pg_temp.id('f000', 1), pg_temp.id('f000', 1)),
  (pg_temp.id('f400', 5), pg_temp.id('f000', 111), pg_temp.id('f000', 11), pg_temp.id('f000', 1)),
  (pg_temp.id('f400', 6), pg_temp.id('f000', 11), pg_temp.id('f000', 1), pg_temp.id('f000', 1)),
  (pg_temp.id('f400', 8), pg_temp.id('f000', 12), pg_temp.id('f000', 1), pg_temp.id('f000', 1));

-- SQL de cabeçalho (registro n, marcadora, raiz), exercício e série
CREATE FUNCTION pg_temp.cab(n int, tag int, root int) RETURNS text AS $$
  SELECT format('INSERT INTO execution_workouts (task_execution_id, tag_id, root_tag_id) VALUES (%L, %L, %L)',
                pg_temp.id('f400', n), pg_temp.id('f000', tag), pg_temp.id('f000', root))
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.ex(id int, n int, exercise int, pos int) RETURNS text AS $$
  SELECT format('INSERT INTO execution_exercises (id, task_execution_id, exercise_id, position) VALUES (%L, %L, %L, %s)',
                pg_temp.id('f500', id), pg_temp.id('f400', n), pg_temp.id('f100', exercise), pos)
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.serie(ex int, pos int, reps int, kg text) RETURNS text AS $$
  SELECT format('INSERT INTO exercise_sets (execution_exercise_id, position, reps, weight_kg) VALUES (%L, %s, %s, %s)',
                pg_temp.id('f500', ex), pos, reps, kg)
$$ LANGUAGE sql;

\o /dev/null
-- --- Aceitos
SELECT pg_temp.aceita('A. sessão 1 das notas em academia (3 exercícios, peso por série)',
  format($q$DO $d$ BEGIN %s; %s; %s; %s;
      %s; %s; %s; %s; %s; %s; %s; %s; %s; END $d$$q$,
    pg_temp.cab(1, 11, 1),
    pg_temp.ex(1, 1, 1, 1), pg_temp.ex(2, 1, 2, 2), pg_temp.ex(3, 1, 3, 3),
    pg_temp.serie(1, 1, 12, '25'), pg_temp.serie(1, 2, 8, '35'), pg_temp.serie(1, 3, 8, '50'),
    pg_temp.serie(2, 1, 8, '40'), pg_temp.serie(2, 2, 8, '40'), pg_temp.serie(2, 3, 8, '40'),
    pg_temp.serie(3, 1, 8, '8'), pg_temp.serie(3, 2, 8, '8'), pg_temp.serie(3, 3, 8, '8')));
SELECT pg_temp.aceita('B. sessão 2 em casa: 15 reps, peso do corpo (NULL)',
  format($q$DO $d$ BEGIN %s; %s; %s; END $d$$q$,
    pg_temp.cab(2, 12, 1), pg_temp.ex(4, 2, 4, 1), pg_temp.serie(4, 1, 15, 'NULL')));
SELECT pg_temp.aceita('C. herança: academia › peito, marcadora academia no caminho',
  format($q$DO $d$ BEGIN %s; PERFORM pg_temp.confere(); END $d$$q$, pg_temp.cab(5, 11, 1)));
SELECT pg_temp.aceita('D. registro ABERTO com treino (ao vivo)',
  format($q$DO $d$ BEGIN %s; %s; %s; END $d$$q$,
    pg_temp.cab(6, 11, 1), pg_temp.ex(6, 6, 1, 1), pg_temp.serie(6, 1, 10, '30')));
SELECT pg_temp.aceita('E. o mesmo exercício (Agachamento) em dois registros',
  format($q$DO $d$ BEGIN %s; END $d$$q$, pg_temp.ex(5, 5, 4, 1)));
SELECT pg_temp.aceita('F. marcadora é a própria raiz (R2)',
  pg_temp.cab(7, 2, 2));
SELECT pg_temp.aceita('G. regravar as tags de E1 na mesma transação (apaga e insere)',
  $q$DO $d$ BEGIN
      DELETE FROM task_execution_tags WHERE task_execution_id = pg_temp.id('f400', 1);
      INSERT INTO task_execution_tags (task_execution_id, tag_id, tag_parent_id, root_tag_id)
      VALUES (pg_temp.id('f400', 1), pg_temp.id('f000', 11), pg_temp.id('f000', 1), pg_temp.id('f000', 1));
      PERFORM pg_temp.confere();
    END $d$$q$);
SELECT pg_temp.aceita('H. "+ série igual": duas séries idênticas em posições diferentes',
  pg_temp.serie(6, 2, 10, '30'));
SELECT pg_temp.aceita('I. substituir o treino inteiro de E6 numa transação (contrato)',
  format($q$DO $d$ BEGIN
      DELETE FROM exercise_sets WHERE execution_exercise_id IN
        (SELECT id FROM execution_exercises WHERE task_execution_id = pg_temp.id('f400', 6));
      DELETE FROM execution_exercises WHERE task_execution_id = pg_temp.id('f400', 6);
      %s; %s; %s;
    END $d$$q$, pg_temp.ex(7, 6, 2, 1), pg_temp.serie(7, 1, 8, '40'), pg_temp.serie(7, 2, 6, '45')));
SELECT pg_temp.aceita('J. exercício sem série: o banco aceita (a regra é da API)',
  pg_temp.ex(8, 7, 3, 1));

-- --- Recusas: onde pode haver treino
SELECT pg_temp.recusa('K. corrida (sem marca)', pg_temp.cab(3, 13, 1), 'execution_workouts_tag_marked');
SELECT pg_temp.recusa('L. marcadora de outra árvore (E8 é R, marcadora R2)',
  pg_temp.cab(8, 2, 1), 'execution_workouts_tag_in_root');
SELECT pg_temp.recusa('M. raiz mentida (E8 é R, dizendo R2)',
  pg_temp.cab(8, 2, 2), 'execution_workouts_execution_root');
SELECT pg_temp.recusa('N. marcadora fora do caminho (E8 é casa, marcadora academia)',
  format($q$DO $d$ BEGIN %s; PERFORM pg_temp.confere(); END $d$$q$, pg_temp.cab(8, 11, 1)),
  'execution_workouts_tag_on_path');
SELECT pg_temp.recusa('O. registro sem tag', pg_temp.cab(4, 2, 2), 'execution_workouts_execution_root');
SELECT pg_temp.recusa('P. segundo treino no mesmo registro', pg_temp.cab(1, 11, 1), 'execution_workouts_pkey');
SELECT pg_temp.recusa('Q. exercício em registro sem cabeçalho de treino (E3)',
  pg_temp.ex(9, 3, 1, 1), 'execution_exercises_workout');

-- --- Recusas: conteúdo
SELECT pg_temp.recusa('R. o mesmo exercício duas vezes na sessão (E1, puxada)',
  pg_temp.ex(9, 1, 1, 4), 'execution_exercises_one_per_session');
SELECT pg_temp.recusa('S. posição de exercício repetida', pg_temp.ex(9, 1, 4, 1), 'execution_exercises_position_unique');
SELECT pg_temp.recusa('T. posição de série repetida', pg_temp.serie(1, 1, 5, '20'), 'exercise_sets_position_unique');
SELECT pg_temp.recusa('U. 0 repetições', pg_temp.serie(1, 4, 0, '20'), 'exercise_sets_reps_positive');
SELECT pg_temp.recusa('V. peso 0 (peso do corpo é NULL)', pg_temp.serie(1, 4, 5, '0'), 'exercise_sets_weight_positive');
SELECT pg_temp.recusa('W. peso negativo', pg_temp.serie(1, 4, 5, '-5'), 'exercise_sets_weight_positive');
SELECT pg_temp.recusa('X. posição 0', pg_temp.serie(1, 0, 5, '20'), 'exercise_sets_position_positive');

-- --- Recusas: catálogo
SELECT pg_temp.recusa('Y. nome repetido sem diferenciar maiúscula/espaço',
  $$INSERT INTO exercises (name) VALUES ('  teste a3 PUXADA alta com barra ')$$, 'exercises_name_unique');
SELECT pg_temp.recusa('Z. nome em branco', $$INSERT INTO exercises (name) VALUES ('   ')$$, 'exercises_name_valid');
SELECT pg_temp.recusa('Z2. nome com 61 caracteres',
  format('INSERT INTO exercises (name) VALUES (%L)', repeat('x', 61)), 'exercises_name_valid');
SELECT pg_temp.recusa('Z3. apagar exercício usado', format('DELETE FROM exercises WHERE id = %L', pg_temp.id('f100', 1)),
  'execution_exercises_exercise');
SELECT pg_temp.aceita('Z4. apagar exercício nunca usado', format('DELETE FROM exercises WHERE id = %L', pg_temp.id('f100', 5)));

-- --- Recusas: mudar o que o treino usa
SELECT pg_temp.recusa('AA. desmarcar treino de tag usada (academia)',
  format('UPDATE tags SET tracks_workout = false WHERE id = %L', pg_temp.id('f000', 11)), 'execution_workouts_tag_marked');
SELECT pg_temp.recusa('AC. desmarcar casa (usada por E2)',
  format('UPDATE tags SET tracks_workout = false WHERE id = %L', pg_temp.id('f000', 12)), 'execution_workouts_tag_marked');
SELECT pg_temp.recusa('AD. trocar a raiz de registro com treino (E7: R2 → R; sem ligações de tag, só a FK nova pode recusar)',
  format('UPDATE task_executions SET root_tag_id = %L WHERE id = %L', pg_temp.id('f000', 1), pg_temp.id('f400', 7)),
  'execution_workouts_execution_root');
SELECT pg_temp.recusa('AE. tirar a marcadora do caminho (E5 fica só com a raiz)',
  $q$DO $d$ BEGIN
      DELETE FROM task_execution_tags WHERE task_execution_id = pg_temp.id('f400', 5);
      PERFORM pg_temp.confere();
    END $d$$q$, 'execution_workouts_tag_on_path');
SELECT pg_temp.recusa('AF. apagar registro com treino (E7, idem)', format('DELETE FROM task_executions WHERE id = %L', pg_temp.id('f400', 7)),
  'execution_workouts_execution_root');

-- --- Documentado: o banco arredonda a 3ª casa do peso em silêncio
SELECT pg_temp.aceita('AG. 22,555 kg vira 22,56 (arredonda, não recusa: a API valida)',
  format($q$DO $d$ BEGIN %s;
      IF (SELECT weight_kg FROM exercise_sets WHERE execution_exercise_id = pg_temp.id('f500', 1) AND position = 9) <> 22.56
      THEN RAISE EXCEPTION 'não arredondou'; END IF;
    END $d$$q$, pg_temp.serie(1, 9, 5, '22.555')));
\o

SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS status, caso, detalhe FROM resultado;
SELECT count(*) FILTER (WHERE ok) || ' de ' || count(*) AS total FROM resultado;
