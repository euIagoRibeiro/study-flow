-- Duração estimada (Atividades A1): sessão marcada, termina no "Quando" do
-- registro e começa X minutos antes. Pode sobrepor outras de propósito
ALTER TABLE time_entries
  ADD COLUMN estimated boolean NOT NULL DEFAULT false,
  -- Estimativa nunca está rodando
  ADD CONSTRAINT time_entries_estimated_ended
    CHECK (NOT estimated OR ended_at IS NOT NULL);

-- No máximo uma estimativa por registro
CREATE UNIQUE INDEX time_entries_one_estimate
  ON time_entries (task_execution_id) WHERE estimated;
