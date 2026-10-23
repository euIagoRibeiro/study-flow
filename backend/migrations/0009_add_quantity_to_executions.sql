-- Quantidade (Atividades A2): número + unidade opcionais por registro
-- ("2 exercícios", "15 reps", "5,5 km"). Sempre os dois juntos
ALTER TABLE task_executions
  ADD COLUMN quantity numeric(10, 2),
  ADD COLUMN quantity_unit text,
  ADD CONSTRAINT task_executions_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT task_executions_quantity_unit_not_blank
    CHECK (btrim(quantity_unit) <> '' AND length(quantity_unit) <= 30),
  ADD CONSTRAINT task_executions_quantity_with_unit
    CHECK ((quantity IS NULL) = (quantity_unit IS NULL));
