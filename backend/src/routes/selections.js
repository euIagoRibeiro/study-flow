import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isUuid, validate } from '../validation.js'

// Seleções por contexto: lista fechada de opções, declarada numa tag (vale
// pros descendentes, SOMANDO) ou global (tagId null). Escolha única ou
// múltipla; as escolhas dos registros ficam em executions.js
export const selectionsRouter = Router()
export const selectionOptionsRouter = Router()

const NOT_FOUND = 'Seleção não encontrada'
const OPTION_NOT_FOUND = 'Opção não encontrada'
const DUPLICATE_OPTION = 'Opção repetida nesta seleção'

const label = (field) =>
  z
    .string(`${field} é obrigatório`)
    .trim()
    .min(1, `${field} não pode ser vazio`)
    .max(30, `${field} pode ter no máximo 30 caracteres`)

// tagId sem .optional(): a global exige o null explícito
const newSelectionSchema = z.object({
  tagId: z.uuid('tagId precisa ser um id válido ou null').nullable(),
  name: label('name'),
  multiple: z.boolean('multiple precisa ser true ou false').default(false),
  options: z
    .array(label('options'), 'options precisa ser uma lista')
    .min(1, 'A seleção precisa de pelo menos uma opção')
    .max(30, 'No máximo 30 opções'),
})

const selectionChangesSchema = z
  .object({
    name: label('name').optional(),
    multiple: z.boolean('multiple precisa ser true ou false').optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (name, multiple, active)',
  )

const newOptionSchema = z.object({
  selectionId: z.uuid('selectionId precisa ser um id válido'),
  name: label('name'),
})

const optionChangesSchema = z
  .object({
    name: label('name').optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (name, active)',
  )

const SELECT_SELECTION = `SELECT s.id, s.tag_id AS "tagId", s.name, s.multiple, s.active,
  COALESCE(
    (SELECT json_agg(json_build_object('id', o.id, 'name', o.name,
                                       'position', o.position, 'active', o.active)
                     ORDER BY o.position)
     FROM selection_options o WHERE o.selection_id = s.id),
    '[]'
  ) AS options
FROM selections s`

const OPTION_COLUMNS =
  'id, selection_id AS "selectionId", name, position, active'

async function findSelection(db, id) {
  const result = await db.query(`${SELECT_SELECTION} WHERE s.id = $1`, [id])
  return result.rows[0]
}

function isDuplicate(err, constraints) {
  return err.code === '23505' && constraints.includes(err.constraint)
}

// Nome único ao longo do CAMINHO (o banco garante só na mesma tag e entre as
// globais): ancestrais, a própria tag, descendentes e as globais; a global,
// contra qualquer uma. Arquivada conta (como no índice do banco). Quem chama
// já travou a tabela, então ninguém grava no meio da conferência
async function pathConflict(client, tagId, name, ownId = null) {
  const result = await client.query(
    `SELECT s.name, concat_ws(' › ', g.name, p.name, t.name) AS "tagPath"
     FROM selections s
     LEFT JOIN tags t ON t.id = s.tag_id
     LEFT JOIN tags p ON p.id = t.parent_id
     LEFT JOIN tags g ON g.id = p.parent_id
     WHERE lower(btrim(s.name)) = lower(btrim($2))
       AND s.id IS DISTINCT FROM $3
       AND ($1::uuid IS NULL
            OR s.tag_id IS NULL
            OR s.tag_id IN (
              SELECT x.id FROM tags x WHERE x.id = $1
              UNION SELECT x.parent_id FROM tags x WHERE x.id = $1
              UNION SELECT p.parent_id FROM tags x JOIN tags p ON p.id = x.parent_id WHERE x.id = $1
              UNION SELECT c.id FROM tags c WHERE c.parent_id = $1
              UNION SELECT n.id FROM tags n JOIN tags c ON c.id = n.parent_id WHERE c.parent_id = $1))
     LIMIT 1`,
    [tagId, name, ownId],
  )
  const other = result.rows[0]
  if (!other) return null
  return `Já existe a seleção "${other.name}" ${
    other.tagPath ? `em ${other.tagPath}` : 'global'
  }, no mesmo caminho`
}

const lockSelections = (client) =>
  client.query('LOCK TABLE selections IN SHARE ROW EXCLUSIVE MODE')

selectionsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `${SELECT_SELECTION} ORDER BY lower(s.name), s.id`,
  )
  res.json(result.rows)
})

// Seleção e opções juntas, ou nada; posições na ordem da lista
selectionsRouter.post('/', async (req, res) => {
  const { error, data: selection } = validate(newSelectionSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (selection.tagId) {
      const tag = await client.query('SELECT active FROM tags WHERE id = $1', [
        selection.tagId,
      ])
      if (tag.rowCount === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'tagId não existe' })
      }
      if (!tag.rows[0].active) {
        await client.query('ROLLBACK')
        return res
          .status(400)
          .json({ error: 'Tag arquivada não recebe seleção nova' })
      }
    }
    await lockSelections(client)
    const conflict = await pathConflict(client, selection.tagId, selection.name)
    if (conflict) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: conflict })
    }
    const result = await client.query(
      `INSERT INTO selections (tag_id, name, multiple) VALUES ($1, $2, $3)
       RETURNING id`,
      [selection.tagId, selection.name, selection.multiple],
    )
    const id = result.rows[0].id
    for (const [index, name] of selection.options.entries()) {
      await client.query(
        `INSERT INTO selection_options (selection_id, name, position)
         VALUES ($1, $2, $3)`,
        [id, name, index + 1],
      )
    }
    const created = await findSelection(client, id)
    await client.query('COMMIT')
    res.status(201).json(created)
  } catch (err) {
    await client.query('ROLLBACK')
    if (isDuplicate(err, ['selection_options_name_unique'])) {
      return res.status(409).json({ error: DUPLICATE_OPTION })
    }
    throw err
  } finally {
    client.release()
  }
})

// tagId não muda (mover = apagar e criar outra; usada, o banco recusa)
selectionsRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const { error, data: changes } = validate(selectionChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (changes.name !== undefined) await lockSelections(client)
    const current = await client.query(
      'SELECT tag_id AS "tagId", multiple FROM selections WHERE id = $1 FOR UPDATE',
      [req.params.id],
    )
    if (current.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: NOT_FOUND })
    }
    if (changes.name !== undefined) {
      const conflict = await pathConflict(
        client,
        current.rows[0].tagId,
        changes.name,
        req.params.id,
      )
      if (conflict) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: conflict })
      }
    }
    // Múltipla → única: o índice do banco recusaria; aqui, com a contagem
    if (changes.multiple === false && current.rows[0].multiple) {
      const doubled = await client.query(
        `SELECT count(*)::int AS n FROM (
           SELECT 1 FROM execution_selections WHERE selection_id = $1
           GROUP BY task_execution_id HAVING count(*) > 1) d`,
        [req.params.id],
      )
      const n = doubled.rows[0].n
      if (n > 0) {
        await client.query('ROLLBACK')
        return res.status(409).json({
          error: `${n} ${n === 1 ? 'registro tem' : 'registros têm'} mais de uma opção nesta seleção: deixe uma só em cada antes de passar para escolha única`,
        })
      }
    }
    // A cópia de "múltipla" nas escolhas acompanha (ON UPDATE CASCADE, 0013)
    await client.query(
      `UPDATE selections
       SET name     = COALESCE($1, name),
           multiple = COALESCE($2, multiple),
           active   = COALESCE($3, active)
       WHERE id = $4`,
      [
        changes.name ?? null,
        changes.multiple ?? null,
        changes.active ?? null,
        req.params.id,
      ],
    )
    const updated = await findSelection(client, req.params.id)
    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    // Rede de segurança: alguém gravou duas opções entre a contagem e o UPDATE
    if (isDuplicate(err, ['execution_selections_one_per_single'])) {
      return res.status(409).json({
        error:
          'Há registros com mais de uma opção nesta seleção: deixe uma só em cada antes de passar para escolha única',
      })
    }
    if (
      isDuplicate(err, [
        'selections_tag_name_unique',
        'selections_global_name_unique',
      ])
    ) {
      return res
        .status(409)
        .json({ error: 'Já existe uma seleção com esse nome no mesmo caminho' })
    }
    throw err
  } finally {
    client.release()
  }
})

// Só nunca usada; as opções (também nunca usadas) vão junto. Usada: arquivar
selectionsRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'DELETE FROM selection_options WHERE selection_id = $1',
      [req.params.id],
    )
    const result = await client.query('DELETE FROM selections WHERE id = $1', [
      req.params.id,
    ])
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: NOT_FOUND })
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (err) {
    await client.query('ROLLBACK')
    // Qualquer FK das escolhas (0013) pode ser a primeira a recusar
    if (
      err.code === '23503' &&
      err.constraint?.startsWith('execution_selections_')
    ) {
      return res.status(409).json({
        error:
          'Esta seleção está em uso em registros: arquive em vez de apagar',
      })
    }
    throw err
  } finally {
    client.release()
  }
})

// Opção nova no fim da lista (maior posição + 1); a seleção travada evita
// duas criações com a mesma posição
selectionOptionsRouter.post('/', async (req, res) => {
  const { error, data: option } = validate(newOptionSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const selection = await client.query(
      'SELECT 1 FROM selections WHERE id = $1 FOR UPDATE',
      [option.selectionId],
    )
    if (selection.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'selectionId não existe' })
    }
    const result = await client.query(
      `INSERT INTO selection_options (selection_id, name, position)
       SELECT $1, $2, COALESCE(max(position), 0) + 1
       FROM selection_options WHERE selection_id = $1
       RETURNING ${OPTION_COLUMNS}`,
      [option.selectionId, option.name],
    )
    await client.query('COMMIT')
    res.status(201).json(result.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    if (isDuplicate(err, ['selection_options_name_unique'])) {
      return res.status(409).json({ error: DUPLICATE_OPTION })
    }
    throw err
  } finally {
    client.release()
  }
})

selectionOptionsRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: OPTION_NOT_FOUND })
  }
  const { error, data: changes } = validate(optionChangesSchema, req.body)
  if (error) return res.status(400).json({ error })
  try {
    const result = await pool.query(
      `UPDATE selection_options
       SET name = COALESCE($1, name), active = COALESCE($2, active)
       WHERE id = $3
       RETURNING ${OPTION_COLUMNS}`,
      [changes.name ?? null, changes.active ?? null, req.params.id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: OPTION_NOT_FOUND })
    }
    res.json(result.rows[0])
  } catch (err) {
    if (isDuplicate(err, ['selection_options_name_unique'])) {
      return res.status(409).json({ error: DUPLICATE_OPTION })
    }
    throw err
  }
})

selectionOptionsRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: OPTION_NOT_FOUND })
  }
  try {
    const result = await pool.query(
      'DELETE FROM selection_options WHERE id = $1',
      [req.params.id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: OPTION_NOT_FOUND })
    }
    res.status(204).end()
  } catch (err) {
    if (
      err.code === '23503' &&
      err.constraint === 'execution_selections_option_in_selection'
    ) {
      return res.status(409).json({
        error: 'Esta opção está em uso em registros: arquive em vez de apagar',
      })
    }
    throw err
  }
})
