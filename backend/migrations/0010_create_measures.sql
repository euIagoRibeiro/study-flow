-- Medidas por contexto: a tag declara o que se mede nos registros dela
-- (descendentes herdam; subtag pode substituir). Treino fica fora (A3)
CREATE TABLE measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid NOT NULL,
  name text NOT NULL,      -- plural: "exercícios"
  singular text NOT NULL,  -- "exercício"
  allows_decimal boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT measures_name_valid CHECK (btrim(name) <> '' AND length(name) <= 30),
  CONSTRAINT measures_singular_valid CHECK (btrim(singular) <> '' AND length(singular) <= 30),
  -- Uma medida por tag
  CONSTRAINT measures_tag_id_key UNIQUE (tag_id),
  CONSTRAINT measures_id_tag_key UNIQUE (id, tag_id),
  CONSTRAINT measures_tag FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE RESTRICT
);

CREATE TRIGGER measures_set_updated_at
BEFORE UPDATE ON measures
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tipos opcionais de uma medida (refatoração, leitura, questões)
CREATE TABLE measure_kinds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT measure_kinds_name_valid CHECK (btrim(name) <> '' AND length(name) <= 30),
  CONSTRAINT measure_kinds_id_measure_key UNIQUE (id, measure_id),
  CONSTRAINT measure_kinds_measure FOREIGN KEY (measure_id)
    REFERENCES measures (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX measure_kinds_name_unique
  ON measure_kinds (measure_id, lower(btrim(name)));

CREATE TRIGGER measure_kinds_set_updated_at
BEFORE UPDATE ON measure_kinds
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Qual medida um registro usa: UMA por registro (a chave é o registro).
-- As garantias de caminho moram aqui
CREATE TABLE execution_measures (
  task_execution_id uuid PRIMARY KEY,
  measure_id uuid NOT NULL,
  tag_id uuid NOT NULL,       -- a tag que declara a medida
  root_tag_id uuid NOT NULL,  -- a raiz do registro
  -- Declarante abaixo da raiz: tem que estar nas tags do registro. NULL
  -- quando a declarante é a própria raiz (aí a FK de raiz basta)
  branch_tag_id uuid GENERATED ALWAYS AS
    (CASE WHEN tag_id <> root_tag_id THEN tag_id END) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_measures_execution_measure_key UNIQUE (task_execution_id, measure_id),
  CONSTRAINT execution_measures_measure_tag FOREIGN KEY (measure_id, tag_id)
    REFERENCES measures (id, tag_id) ON DELETE RESTRICT,
  -- A raiz é a do registro (registro sem tag não tem medida)
  CONSTRAINT execution_measures_execution_root FOREIGN KEY (task_execution_id, root_tag_id)
    REFERENCES task_executions (id, root_tag_id) ON DELETE RESTRICT,
  -- A declarante é da árvore dessa raiz
  CONSTRAINT execution_measures_tag_in_root FOREIGN KEY (tag_id, root_tag_id)
    REFERENCES tags (id, effective_root) ON DELETE RESTRICT,
  -- A declarante está no caminho do registro. Adiável: salvar tags apaga
  -- e regrava as ligações na mesma transação, e a conferência fica pro
  -- fim. Sem ON DELETE RESTRICT de propósito: RESTRICT nunca é adiado,
  -- só a ação padrão (NO ACTION) espera o fim da transação
  CONSTRAINT execution_measures_tag_on_path FOREIGN KEY (task_execution_id, branch_tag_id)
    REFERENCES task_execution_tags (task_execution_id, tag_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX execution_measures_measure_id_idx ON execution_measures (measure_id);

CREATE TRIGGER execution_measures_set_updated_at
BEFORE UPDATE ON execution_measures
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Os valores: 3 refatoração + 2 leitura. Sem tipo (kind_id NULL) só em
-- medida sem tipos (regra da API); no máximo um valor por tipo
CREATE TABLE execution_measure_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_execution_id uuid NOT NULL,
  measure_id uuid NOT NULL,
  kind_id uuid,
  quantity numeric(10, 2) NOT NULL
    CONSTRAINT execution_measure_values_quantity_positive CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_measure_values_one_per_kind
    UNIQUE NULLS NOT DISTINCT (task_execution_id, kind_id),
  -- O valor é da medida escolhida pro registro
  CONSTRAINT execution_measure_values_execution_measure FOREIGN KEY (task_execution_id, measure_id)
    REFERENCES execution_measures (task_execution_id, measure_id) ON DELETE RESTRICT,
  -- O tipo é dessa medida
  CONSTRAINT execution_measure_values_kind_of_measure FOREIGN KEY (kind_id, measure_id)
    REFERENCES measure_kinds (id, measure_id) ON DELETE RESTRICT
);

CREATE INDEX execution_measure_values_kind_id_idx ON execution_measure_values (kind_id);

CREATE TRIGGER execution_measure_values_set_updated_at
BEFORE UPDATE ON execution_measure_values
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
