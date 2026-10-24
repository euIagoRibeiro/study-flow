-- Desfaz a 0009 (quantidade da A2): substituída pelas medidas por contexto
-- (0010). A 0009 fica no repo de propósito: migration aplicada é histórico,
-- e um banco novo passa pela 0009 e por esta e chega ao mesmo lugar.
-- Só havia dado de seed nas colunas. DROP COLUMN leva junto as 3 CHECKs
-- da 0009 (quantity_positive, quantity_unit_not_blank, quantity_with_unit)
ALTER TABLE task_executions
  DROP COLUMN quantity,
  DROP COLUMN quantity_unit;
