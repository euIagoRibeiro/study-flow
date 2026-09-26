-- Remove só os dados do dev_seed.sql (ids começando com 5eed), sem tocar
-- nos seus. A ordem importa por causa dos ON DELETE RESTRICT: sessões,
-- depois execuções, depois tarefas.
--
-- Se você registrou uma execução de verdade numa tarefa fictícia, o
-- RESTRICT recusa apagar essa tarefa e a transação inteira é desfeita:
-- nada some pela metade.

BEGIN;

DELETE FROM time_entries
WHERE task_execution_id::text LIKE '5eed%';

DELETE FROM task_executions
WHERE id::text LIKE '5eed%';

DELETE FROM tasks
WHERE id::text LIKE '5eed%';

COMMIT;
