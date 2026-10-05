import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isUuid, validate } from '../validation.js'

export const tagsRouter = Router()

const COLUMNS = 'id, name, parent_id AS "parentId", level, active'
const NOT_FOUND = 'Tag não encontrada'
const DUPLICATE = 'Já existe uma tag com esse nome aqui'

const name = z
  .string('name é obrigatório e não pode ser vazio')
  .trim()
  .min(1, 'name é obrigatório e não pode ser vazio')
  .max(50, 'name pode ter no máximo 50 caracteres')

const newTagSchema = z.object({
  name,
  parentId: z.uuid('parentId precisa ser um id válido').nullable().optional(),
})

const tagChangesSchema = z
  .object({
    name: name.optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (name, active)',
  )

function isDuplicateName(err) {
  return (
    err.code === '23505' &&
    ['tags_root_name_unique', 'tags_sibling_name_unique'].includes(
      err.constraint,
    )
  )
}

// Árvore achatada: cada raiz, logo depois os filhos dela, e depois de cada
// filho os netos — ordem feita aqui, o frontend só monta. Profundidade
// fixa (3): dois LEFT JOIN bastam, sem WITH RECURSIVE
tagsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT t.id, t.name, t.parent_id AS "parentId", t.level, t.active
     FROM tags t
     LEFT JOIN tags p ON p.id = t.parent_id
     LEFT JOIN tags g ON g.id = p.parent_id
     ORDER BY
       lower(CASE t.level WHEN 1 THEN t.name WHEN 2 THEN p.name ELSE g.name END),
       lower(CASE t.level WHEN 1 THEN '' WHEN 2 THEN t.name ELSE p.name END),
       lower(CASE t.level WHEN 3 THEN t.name ELSE '' END)`,
  )
  res.json(result.rows)
})

// Nível e raiz saem do pai, calculados aqui — o cliente nunca manda
tagsRouter.post('/', async (req, res) => {
  const { error, data: tag } = validate(newTagSchema, req.body)
  if (error) return res.status(400).json({ error })

  try {
    if (!tag.parentId) {
      const result = await pool.query(
        `INSERT INTO tags (name, level) VALUES ($1, 1) RETURNING ${COLUMNS}`,
        [tag.name],
      )
      return res.status(201).json(result.rows[0])
    }

    const parent = await pool.query(
      'SELECT level, active FROM tags WHERE id = $1',
      [tag.parentId],
    )
    if (parent.rowCount === 0) {
      return res.status(400).json({ error: 'parentId não existe' })
    }
    if (!parent.rows[0].active) {
      return res
        .status(400)
        .json({ error: 'Não dá pra criar subtag de uma tag arquivada' })
    }

    const result = await pool.query(
      `INSERT INTO tags (name, level, parent_id, root_id)
       SELECT $1, level + 1, id, effective_root FROM tags WHERE id = $2
       RETURNING ${COLUMNS}`,
      [tag.name, tag.parentId],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (isDuplicateName(err)) return res.status(409).json({ error: DUPLICATE })
    if (err.code === '23514' && err.constraint === 'tags_level_range') {
      return res
        .status(400)
        .json({ error: 'O terceiro nível não pode ter subtag' })
    }
    throw err
  }
})

// Renomear, arquivar, reativar. Mover não existe: conceito novo = tag nova
// + arquivar a antiga. Arquivar desce pra subárvore inteira (nunca sobra
// filho ativo sob pai arquivado); reativar vale só pra própria tag, e só
// com o pai ativo
tagsRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  if (req.body && 'parentId' in req.body) {
    return res.status(400).json({
      error: 'Tag não muda de lugar: crie uma nova e arquive a antiga',
    })
  }
  const { error, data: changes } = validate(tagChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      `SELECT t.id, p.active AS "parentActive"
       FROM tags t LEFT JOIN tags p ON p.id = t.parent_id
       WHERE t.id = $1
       FOR UPDATE OF t`,
      [req.params.id],
    )
    if (current.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: NOT_FOUND })
    }
    if (changes.active === true && current.rows[0].parentActive === false) {
      await client.query('ROLLBACK')
      return res
        .status(400)
        .json({ error: 'Reative a tag-pai antes de reativar esta' })
    }

    const result = await client.query(
      `UPDATE tags
       SET name   = COALESCE($1, name),
           active = COALESCE($2, active)
       WHERE id = $3
       RETURNING ${COLUMNS}`,
      [changes.name ?? null, changes.active ?? null, req.params.id],
    )

    let archivedDescendants = []
    if (changes.active === false) {
      // Profundidade fixa: filhos (pai = ela) e netos (avô = ela)
      const cascade = await client.query(
        `UPDATE tags SET active = false
         WHERE active
           AND (parent_id = $1
                OR parent_id IN (SELECT id FROM tags WHERE parent_id = $1))
         RETURNING id`,
        [req.params.id],
      )
      archivedDescendants = cascade.rows.map((row) => row.id)
    }

    await client.query('COMMIT')
    res.json({ ...result.rows[0], archivedDescendants })
  } catch (err) {
    await client.query('ROLLBACK')
    if (isDuplicateName(err)) return res.status(409).json({ error: DUPLICATE })
    throw err
  } finally {
    client.release()
  }
})

// Só tag sem subtags e nunca usada em execução (o banco recusa as duas);
// o caminho pra tag usada é arquivar
tagsRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  try {
    const result = await pool.query('DELETE FROM tags WHERE id = $1', [
      req.params.id,
    ])
    if (result.rowCount === 0) {
      return res.status(404).json({ error: NOT_FOUND })
    }
    res.status(204).end()
  } catch (err) {
    // Usada: como raiz de uma execução, ou ligada a uma (migration 0005)
    if (
      err.code === '23503' &&
      (err.constraint === 'task_executions_root_tag_is_root' ||
        err.constraint?.startsWith('task_execution_tags_'))
    ) {
      return res.status(409).json({
        error: 'Esta tag está em uso em execuções: arquive em vez de apagar',
      })
    }
    if (err.code === '23503' && err.constraint?.startsWith('tags_')) {
      return res.status(409).json({
        error: 'Esta tag tem subtags: apague ou arquive as subtags antes',
      })
    }
    throw err
  }
})
