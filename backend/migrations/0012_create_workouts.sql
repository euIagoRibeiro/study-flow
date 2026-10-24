-- Treino estruturado (Atividades A3): catálogo de exercícios, cabeçalho de
-- treino por registro (com a tag marcadora do caminho, como a medida),
-- exercícios da sessão e séries. Desenho no CLAUDE.md, "A3 treino".

-- Tag que usa treino, em qualquer nível; os descendentes herdam (regra da API)
ALTER TABLE tags
  ADD COLUMN tracks_workout boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT tags_id_tracks_workout_key UNIQUE (id, tracks_workout);

-- Catálogo único. O equipamento faz parte do nome ("Rosca direta barra")
CREATE TABLE exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT exercises_name_valid CHECK (btrim(name) <> '' AND length(name) <= 60),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX exercises_name_unique ON exercises (lower(btrim(name)));

CREATE TRIGGER exercises_set_updated_at
BEFORE UPDATE ON exercises
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Um treino por registro (PK = o registro), com a tag marcadora
CREATE TABLE execution_workouts (
  task_execution_id uuid PRIMARY KEY,
  tag_id uuid NOT NULL,       -- a marcadora (tracks_workout) no caminho
  root_tag_id uuid NOT NULL,  -- a raiz do registro
  tag_tracks_workout boolean GENERATED ALWAYS AS (true) STORED,
  -- Marcadora abaixo da raiz: tem que estar nas tags do registro. NULL
  -- quando a marcadora é a própria raiz (aí a FK de raiz basta)
  branch_tag_id uuid GENERATED ALWAYS AS
    (CASE WHEN tag_id <> root_tag_id THEN tag_id END) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A marcadora usa treino (desmarcar tag usada é recusado)
  CONSTRAINT execution_workouts_tag_marked FOREIGN KEY (tag_id, tag_tracks_workout)
    REFERENCES tags (id, tracks_workout) ON DELETE RESTRICT,
  -- A raiz é a do registro (registro sem tag não tem treino)
  CONSTRAINT execution_workouts_execution_root FOREIGN KEY (task_execution_id, root_tag_id)
    REFERENCES task_executions (id, root_tag_id) ON DELETE RESTRICT,
  -- A marcadora é da árvore dessa raiz
  CONSTRAINT execution_workouts_tag_in_root FOREIGN KEY (tag_id, root_tag_id)
    REFERENCES tags (id, effective_root) ON DELETE RESTRICT,
  -- A marcadora está no caminho. Adiável, sem RESTRICT (mesmo motivo da
  -- execution_measures_tag_on_path: salvar tags apaga e regrava as ligações)
  CONSTRAINT execution_workouts_tag_on_path FOREIGN KEY (task_execution_id, branch_tag_id)
    REFERENCES task_execution_tags (task_execution_id, tag_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX execution_workouts_tag_id_idx ON execution_workouts (tag_id);

CREATE TRIGGER execution_workouts_set_updated_at
BEFORE UPDATE ON execution_workouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Exercícios da sessão, em ordem; o mesmo exercício uma vez por sessão
CREATE TABLE execution_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_execution_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  position smallint NOT NULL
    CONSTRAINT execution_exercises_position_positive CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_exercises_workout FOREIGN KEY (task_execution_id)
    REFERENCES execution_workouts (task_execution_id) ON DELETE RESTRICT,
  CONSTRAINT execution_exercises_exercise FOREIGN KEY (exercise_id)
    REFERENCES exercises (id) ON DELETE RESTRICT,
  CONSTRAINT execution_exercises_one_per_session UNIQUE (task_execution_id, exercise_id),
  CONSTRAINT execution_exercises_position_unique UNIQUE (task_execution_id, position)
);

CREATE INDEX execution_exercises_exercise_id_idx ON execution_exercises (exercise_id);

CREATE TRIGGER execution_exercises_set_updated_at
BEFORE UPDATE ON execution_exercises
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Séries, em ordem. Peso NULL = peso do corpo; o banco ARREDONDA a 3ª
-- casa em silêncio (numeric), quem valida é a API
CREATE TABLE exercise_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_exercise_id uuid NOT NULL,
  position smallint NOT NULL
    CONSTRAINT exercise_sets_position_positive CHECK (position >= 1),
  reps smallint NOT NULL
    CONSTRAINT exercise_sets_reps_positive CHECK (reps > 0),
  weight_kg numeric(6, 2)
    CONSTRAINT exercise_sets_weight_positive CHECK (weight_kg > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exercise_sets_execution_exercise FOREIGN KEY (execution_exercise_id)
    REFERENCES execution_exercises (id) ON DELETE RESTRICT,
  CONSTRAINT exercise_sets_position_unique UNIQUE (execution_exercise_id, position)
);

CREATE TRIGGER exercise_sets_set_updated_at
BEFORE UPDATE ON exercise_sets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
