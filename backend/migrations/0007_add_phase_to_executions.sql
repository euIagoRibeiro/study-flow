-- Ordem da declaração = ordem das fases (>, <, ORDER BY)
CREATE TYPE phase AS ENUM ('requisitos', 'prototipo', 'validacao', 'implementacao');

-- NULL = sem fase. Só sob raiz com tracks_phase
ALTER TABLE task_executions
  ADD COLUMN phase phase,
  -- true quando há fase, senão NULL: a FK só confere quando há fase
  ADD COLUMN phase_needs_tracking boolean
    GENERATED ALWAYS AS (CASE WHEN phase IS NOT NULL THEN true END) STORED,
  -- Sem tag a FK não confere nada; este CHECK fecha o buraco
  ADD CONSTRAINT task_executions_phase_needs_root
    CHECK (phase IS NULL OR root_tag_id IS NOT NULL),
  ADD CONSTRAINT task_executions_phase_root_tracks
    FOREIGN KEY (root_tag_id, phase_needs_tracking)
    REFERENCES tags (id, tracks_phase) ON DELETE RESTRICT;
