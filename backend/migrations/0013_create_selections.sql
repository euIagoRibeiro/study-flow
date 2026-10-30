-- Seleções por contexto (S0 protótipo, S1 migration; 2026-10-29). Lista fechada de
-- opções, escolhida por registro, sempre opcional. Declarada numa tag
-- (vale pros descendentes, SOMANDO: todas as do caminho valem juntas) ou
-- GLOBAL (sem tag: a Natureza). Escolha única ou múltipla. Garantias no
-- banco, no padrão das medidas (0010); o "nome único ao longo do caminho"
-- e a sugestão ficam na API
CREATE TABLE selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid,                -- NULL = global (vale pra todo registro)
  is_global boolean GENERATED ALWAYS AS (tag_id IS NULL) STORED,
  name text NOT NULL,
  multiple boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selections_name_valid CHECK (btrim(name) <> '' AND length(name) <= 30),
  CONSTRAINT selections_tag FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE RESTRICT,
  -- Alvos das FKs compostas das escolhas
  CONSTRAINT selections_id_tag_key UNIQUE (id, tag_id),
  CONSTRAINT selections_id_global_key UNIQUE (id, is_global),
  CONSTRAINT selections_id_multiple_key UNIQUE (id, multiple)
);
-- Nome único na mesma tag e entre as globais (ao longo do caminho: API)
CREATE UNIQUE INDEX selections_tag_name_unique
  ON selections (tag_id, lower(btrim(name))) WHERE tag_id IS NOT NULL;
CREATE UNIQUE INDEX selections_global_name_unique
  ON selections (lower(btrim(name))) WHERE tag_id IS NULL;

CREATE TRIGGER selections_set_updated_at
BEFORE UPDATE ON selections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- As opções, na ordem de cadastro (posição preenchida na criação; sem
-- reordenar por ora)
CREATE TABLE selection_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  selection_id uuid NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selection_options_name_valid CHECK (btrim(name) <> '' AND length(name) <= 30),
  CONSTRAINT selection_options_position_valid CHECK (position >= 1),
  CONSTRAINT selection_options_selection FOREIGN KEY (selection_id)
    REFERENCES selections (id) ON DELETE RESTRICT,
  CONSTRAINT selection_options_id_selection_key UNIQUE (id, selection_id),
  CONSTRAINT selection_options_position_unique UNIQUE (selection_id, position)
);
CREATE UNIQUE INDEX selection_options_name_unique
  ON selection_options (selection_id, lower(btrim(name)));

CREATE TRIGGER selection_options_set_updated_at
BEFORE UPDATE ON selection_options
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- As escolhas de um registro: uma linha por opção escolhida
CREATE TABLE execution_selections (
  task_execution_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  option_id uuid NOT NULL,
  -- Cópias da seleção, conferidas por FK (não podem mentir)
  selection_multiple boolean NOT NULL,
  selection_global boolean NOT NULL,
  tag_id uuid,                -- a declarante; NULL só na global
  root_tag_id uuid,           -- a raiz do registro; NULL só na global
  -- Declarante abaixo da raiz: tem que estar nas tags do registro (como na
  -- medida). NULL quando a declarante é a raiz (a FK da raiz basta) ou global
  branch_tag_id uuid GENERATED ALWAYS AS
    (CASE WHEN tag_id <> root_tag_id THEN tag_id END) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_selections_pkey PRIMARY KEY (task_execution_id, option_id),
  -- FK composta com NULL não é conferida (MATCH SIMPLE): sem este CHECK,
  -- uma escolha de seleção NÃO global com declarante NULL passaria. Global
  -- ⇔ sem declarante ⇔ sem raiz
  CONSTRAINT execution_selections_global_iff_no_tag CHECK (
    selection_global = (tag_id IS NULL) AND (tag_id IS NULL) = (root_tag_id IS NULL)
  ),
  -- O registro existe (as compostas com a raiz não conferem a global)
  CONSTRAINT execution_selections_execution FOREIGN KEY (task_execution_id)
    REFERENCES task_executions (id) ON DELETE RESTRICT,
  -- A opção é daquela seleção
  CONSTRAINT execution_selections_option_in_selection FOREIGN KEY (option_id, selection_id)
    REFERENCES selection_options (id, selection_id) ON DELETE RESTRICT,
  -- As cópias batem com a seleção. ÚNICA EXCEÇÃO ao RESTRICT do projeto:
  -- ON UPDATE CASCADE no "múltipla", pra trocar única ↔ múltipla depois de
  -- usada: única → múltipla passa (a cópia acompanha); múltipla → única é
  -- recusada pelo índice abaixo exatamente quando algum registro tem duas
  -- opções (a API traduz em 409)
  CONSTRAINT execution_selections_multiple FOREIGN KEY (selection_id, selection_multiple)
    REFERENCES selections (id, multiple) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT execution_selections_global FOREIGN KEY (selection_id, selection_global)
    REFERENCES selections (id, is_global) ON DELETE RESTRICT,
  -- A declarante é a da seleção
  CONSTRAINT execution_selections_selection_tag FOREIGN KEY (selection_id, tag_id)
    REFERENCES selections (id, tag_id) ON DELETE RESTRICT,
  -- A raiz é a do registro
  CONSTRAINT execution_selections_execution_root FOREIGN KEY (task_execution_id, root_tag_id)
    REFERENCES task_executions (id, root_tag_id) ON DELETE RESTRICT,
  -- A declarante é da árvore dessa raiz
  CONSTRAINT execution_selections_tag_in_root FOREIGN KEY (tag_id, root_tag_id)
    REFERENCES tags (id, effective_root) ON DELETE RESTRICT,
  -- A declarante está no caminho. Adiável (NO ACTION, nunca RESTRICT, que
  -- não se adia): trocar o caminho apaga e regrava as ligações na mesma
  -- transação, como na medida
  CONSTRAINT execution_selections_tag_on_path FOREIGN KEY (task_execution_id, branch_tag_id)
    REFERENCES task_execution_tags (task_execution_id, tag_id)
    DEFERRABLE INITIALLY DEFERRED
);
-- Escolha única = no máximo uma opção por registro e seleção
CREATE UNIQUE INDEX execution_selections_one_per_single
  ON execution_selections (task_execution_id, selection_id) WHERE NOT selection_multiple;
CREATE INDEX execution_selections_selection_id_idx ON execution_selections (selection_id);
CREATE INDEX execution_selections_option_id_idx ON execution_selections (option_id);
