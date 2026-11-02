-- Obras (O1, 2026-11-02): catálogo do que se acompanha ao longo de vários
-- registros (mangá, livro, curso, desafio como o Inktober). O tipo é o caminho
-- padrão, sem campo. Status manual e sem `active`: "abandonado" e "arquivado"
-- poderiam se contradizer. Uma obra por registro pela estrutura; o caminho do
-- registro é livre (fica fora do banco, de propósito). Na API: a medida estar no
-- caminho padrão, o progresso (derivado) e a normalização do esquema das URLs
CREATE TYPE work_status AS ENUM ('em_andamento', 'concluido', 'pausado', 'abandonado');

CREATE TABLE works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status work_status NOT NULL DEFAULT 'em_andamento',
  default_tag_id uuid NOT NULL,   -- a tag mais funda do caminho padrão
  default_task_id uuid NOT NULL,  -- o toque em "Em andamento" precisa da tarefa
  measure_id uuid,                -- qual medida soma; NULL = sem progresso numérico
  total numeric(10,2),            -- 113 capítulos, 31 desenhos; passar dele é permitido
  url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT works_title_valid CHECK (title ~ '\S' AND char_length(title) <= 100),
  CONSTRAINT works_total_positive CHECK (total > 0),
  CONSTRAINT works_total_needs_measure CHECK (total IS NULL OR measure_id IS NOT NULL),
  -- Só http/https: vira link clicável, e javascript: não pode entrar
  CONSTRAINT works_url_valid CHECK (url ~ '^https?://\S+$' AND char_length(url) <= 2000),
  CONSTRAINT works_default_tag FOREIGN KEY (default_tag_id) REFERENCES tags (id) ON DELETE RESTRICT,
  CONSTRAINT works_default_task FOREIGN KEY (default_task_id) REFERENCES tasks (id) ON DELETE RESTRICT,
  CONSTRAINT works_measure FOREIGN KEY (measure_id) REFERENCES measures (id) ON DELETE RESTRICT
);

-- Por tag padrão: mangá e anime podem ter o mesmo título
CREATE UNIQUE INDEX works_title_unique ON works (lower(btrim(title)), default_tag_id);

CREATE TRIGGER works_set_updated_at
BEFORE UPDATE ON works
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE task_executions
  ADD COLUMN work_id uuid,
  ADD COLUMN link_url text,
  ADD CONSTRAINT task_executions_work FOREIGN KEY (work_id) REFERENCES works (id) ON DELETE RESTRICT,
  ADD CONSTRAINT task_executions_link_url_valid
    CHECK (link_url ~ '^https?://\S+$' AND char_length(link_url) <= 2000);

CREATE INDEX task_executions_work_id_idx ON task_executions (work_id);
