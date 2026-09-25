CREATE TABLE task_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: o banco recusa apagar uma tarefa que tenha execução
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  description text,
  task_title_at_time text NOT NULL,
  task_frequency_at_time frequency NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_executions_task_id_idx ON task_executions (task_id);

-- Só uma execução aberta por tarefa: o índice vale apenas pras linhas
-- com completed_at nulo
CREATE UNIQUE INDEX task_executions_one_open_per_task
ON task_executions (task_id)
WHERE completed_at IS NULL;

CREATE TRIGGER task_executions_set_updated_at
BEFORE UPDATE ON task_executions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
