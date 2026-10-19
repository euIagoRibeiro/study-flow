-- Raízes que usam fase de trabalho nas execuções (ex.: "code")
ALTER TABLE tags
  ADD COLUMN tracks_phase boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT tags_tracks_phase_only_root CHECK (level = 1 OR NOT tracks_phase),
  -- Alvo da FK de task_executions.phase
  ADD CONSTRAINT tags_id_tracks_phase_key UNIQUE (id, tracks_phase);
