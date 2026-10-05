-- Tags na execução: uma raiz por execução (coluna), e as tags de nível
-- 2/3 marcadas nela (tabela de ligação). Execução sem tag continua valendo.
ALTER TABLE task_executions
  ADD COLUMN root_tag_id uuid,
  -- Constante: só existe pra FK abaixo exigir que a raiz seja nível 1
  ADD COLUMN root_tag_level smallint GENERATED ALWAYS AS (1) STORED,
  -- Alvo da FK de task_execution_tags
  ADD CONSTRAINT task_executions_id_root_tag_key UNIQUE (id, root_tag_id),
  ADD CONSTRAINT task_executions_root_tag_is_root
    FOREIGN KEY (root_tag_id, root_tag_level)
    REFERENCES tags (id, level) ON DELETE RESTRICT;

CREATE INDEX task_executions_root_tag_id_idx ON task_executions (root_tag_id);

-- Guarda o fechamento do que foi escolhido: cada nível 3 vem com o nível
-- 2 pai (quem decide é o servidor). As três FKs juntas: a tag é dessa
-- raiz, essa é a raiz da execução, e a tag tem esse pai — mover uma tag
-- já usada, mesmo dentro da mesma raiz, é recusado
CREATE TABLE task_execution_tags (
  task_execution_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  tag_parent_id uuid NOT NULL,
  root_tag_id uuid NOT NULL,
  CONSTRAINT task_execution_tags_pkey PRIMARY KEY (task_execution_id, tag_id),
  CONSTRAINT task_execution_tags_execution_root
    FOREIGN KEY (task_execution_id, root_tag_id)
    REFERENCES task_executions (id, root_tag_id) ON DELETE RESTRICT,
  CONSTRAINT task_execution_tags_tag_in_root
    FOREIGN KEY (tag_id, root_tag_id)
    REFERENCES tags (id, effective_root) ON DELETE RESTRICT,
  CONSTRAINT task_execution_tags_tag_parent
    FOREIGN KEY (tag_id, tag_parent_id)
    REFERENCES tags (id, parent_id) ON DELETE RESTRICT
);

-- Filtro por tag (Dashboard) e a checagem do banco ao apagar uma tag
CREATE INDEX task_execution_tags_tag_id_idx ON task_execution_tags (tag_id);
