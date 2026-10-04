-- Tags em até 3 níveis: raiz (contexto) › filho › neto. Ex.:
-- Vestibular › Matemática › Álgebra, ou só Exercícios › Academia.
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CONSTRAINT tags_name_not_blank CHECK (btrim(name) <> ''),
  level smallint NOT NULL CONSTRAINT tags_level_range CHECK (level BETWEEN 1 AND 3),
  parent_id uuid,
  -- A raiz da árvore; NULL na própria raiz
  root_id uuid,
  -- Calculadas pelo banco, só existem pra servir de alvo/origem das FKs
  -- compostas abaixo
  parent_level smallint GENERATED ALWAYS AS (level - 1) STORED,
  effective_root uuid GENERATED ALWAYS AS (COALESCE(root_id, id)) STORED,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_root_iff_no_parent CHECK ((parent_id IS NULL) = (level = 1)),
  CONSTRAINT tags_root_id_iff_parent CHECK ((parent_id IS NULL) = (root_id IS NULL)),

  CONSTRAINT tags_id_level_key UNIQUE (id, level),
  CONSTRAINT tags_id_effective_root_key UNIQUE (id, effective_root),
  -- Alvo da FK de task_execution_tags (migration 0005)
  CONSTRAINT tags_id_parent_key UNIQUE (id, parent_id),

  -- O pai está exatamente um nível acima. Como o nível só desce de pai
  -- pra filho e vai de 1 a 3, não existe 4º nível nem ciclo — garantido
  -- aqui, sem trigger
  CONSTRAINT tags_parent_one_level_up FOREIGN KEY (parent_id, parent_level)
    REFERENCES tags (id, level) ON DELETE RESTRICT,
  -- Mesma raiz do pai. Junto com a FK acima, mover uma tag que tem
  -- filhos pra outra árvore é recusado
  CONSTRAINT tags_same_root_as_parent FOREIGN KEY (parent_id, root_id)
    REFERENCES tags (id, effective_root) ON DELETE RESTRICT
);

-- Nomes únicos entre raízes, e entre irmãos do mesmo pai. "Matemática"
-- raiz e "Vestibular › Matemática" não competem: são tags diferentes, de
-- propósito
CREATE UNIQUE INDEX tags_root_name_unique
ON tags (lower(btrim(name)))
WHERE parent_id IS NULL;

CREATE UNIQUE INDEX tags_sibling_name_unique
ON tags (parent_id, lower(btrim(name)))
WHERE parent_id IS NOT NULL;

CREATE TRIGGER tags_set_updated_at
BEFORE UPDATE ON tags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
