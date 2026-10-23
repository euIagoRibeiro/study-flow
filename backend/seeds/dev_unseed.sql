-- Remove só os dados do dev_seed.sql (ids começando com 5eed), sem tocar
-- nos seus. A ordem importa por causa dos ON DELETE RESTRICT: medidas dos
-- registros, sessões e ligações de tags, depois execuções, depois tarefas;
-- o cadastro de medidas antes das tags; tags dos netos pras raízes.
--
-- Se você registrou uma execução de verdade numa tarefa fictícia (ou criou
-- uma tag sua dentro de uma tag fictícia), o RESTRICT recusa e a transação
-- inteira é desfeita: nada some pela metade.

BEGIN;

DELETE FROM execution_measure_values
WHERE task_execution_id::text LIKE '5eed%';

DELETE FROM execution_measures
WHERE task_execution_id::text LIKE '5eed%';

DELETE FROM time_entries
WHERE task_execution_id::text LIKE '5eed%';

DELETE FROM task_execution_tags
WHERE task_execution_id::text LIKE '5eed%';

DELETE FROM task_executions
WHERE id::text LIKE '5eed%';

DELETE FROM tasks
WHERE id::text LIKE '5eed%';

DELETE FROM measure_kinds
WHERE id::text LIKE '5eed%';

DELETE FROM measures
WHERE id::text LIKE '5eed%';

DELETE FROM tags
WHERE id::text LIKE '5eed%' AND level = 3;

DELETE FROM tags
WHERE id::text LIKE '5eed%' AND level = 2;

DELETE FROM tags
WHERE id::text LIKE '5eed%' AND level = 1;

COMMIT;
