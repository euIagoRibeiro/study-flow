CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_execution_id uuid NOT NULL REFERENCES task_executions (id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- >= e não >: "Iniciar" + "Pausar" no mesmo milissegundo é inofensivo
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX time_entries_task_execution_id_idx ON time_entries (task_execution_id);

-- Só uma sessão rodando no app inteiro: toda linha rodando tem o mesmo
-- valor (true), e o índice único só permite uma
CREATE UNIQUE INDEX time_entries_one_running
ON time_entries ((true))
WHERE ended_at IS NULL;

CREATE TRIGGER time_entries_set_updated_at
BEFORE UPDATE ON time_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
