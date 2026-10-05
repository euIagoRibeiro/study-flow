-- Remove só os dados do dev_seed.sql (ids começando com 5eed), sem tocar
-- nos seus. A ordem importa por causa dos ON DELETE RESTRICT: sessões,
-- depois execuções, depois tarefas; tags dos netos pras raízes.
--
-- Se você registrou uma execução de verdade numa tarefa fictícia (ou criou
-- uma tag sua dentro de uma tag fictícia), o RESTRICT recusa e a transação
-- inteira é desfeita: nada some pela metade.

BEGIN;

DELETE FROM time_entries
WHERE task_execution_id::text LIKE '5eed%';

DELETE FROM task_executions
WHERE id::text LIKE '5eed%';

DELETE FROM tasks
WHERE id::text LIKE '5eed%';

DELETE FROM tags
WHERE id::text LIKE '5eed%' AND level = 3;

DELETE FROM tags
WHERE id::text LIKE '5eed%' AND level = 2;

DELETE FROM tags
WHERE id::text LIKE '5eed%' AND level = 1;

COMMIT;
