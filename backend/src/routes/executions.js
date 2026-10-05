import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isoDateTime, isUuid, validate } from '../validation.js'

export const executionsRouter = Router()

// tagIds = o que está gravado (o fechamento); quem mostra só as folhas é a tela
const SELECT_EXECUTION = `SELECT e.id,
  e.task_id AS "taskId",
  e.description,
  e.completed_at AS "completedAt",
  e.task_title_at_time AS "taskTitleAtTime",
  e.task_frequency_at_time AS "taskFrequencyAtTime",
  e.root_tag_id AS "rootTagId",
  COALESCE(
    array_agg(et.tag_id ORDER BY et.tag_id) FILTER (WHERE et.tag_id IS NOT NULL),
    '{}'
  ) AS "tagIds"
FROM task_executions e
LEFT JOIN task_execution_tags et ON et.task_execution_id = e.id`

async function findExecution(db, id) {
  const result = await db.query(
    `${SELECT_EXECUTION} WHERE e.id = $1 GROUP BY e.id`,
    [id],
  )
  return result.rows[0]
}

const description = z
  .string('description precisa ser um texto ou null')
  .trim()
  .transform((text) => (text === '' ? null : text))
  .nullable()

const completedAt = isoDateTime(
  'completedAt precisa ser uma data ISO ou null',
).nullable()

// Opcionais: ausentes, as tags não mudam (finalizar/desfazer não mandam)
const tagFields = {
  rootTagId: z
    .uuid('rootTagId precisa ser um uuid ou null')
    .nullable()
    .optional(),
  tagIds: z
    .array(
      z.uuid('tagIds precisa ser uma lista de uuids'),
      'tagIds precisa ser uma lista de uuids',
    )
    .max(20, 'No máximo 20 tags por execução')
    .optional(),
}

function withTagRule(schema) {
  return schema.refine(
    (data) => !(data.tagIds?.length > 0 && !data.rootTagId),
    'tagIds precisa de rootTagId',
  )
}

function hasTags(data) {
  return data.rootTagId !== undefined || data.tagIds !== undefined
}

// completedAt sem .optional(): pra iniciar aberta, o null tem que vir explícito
const newExecutionSchema = withTagRule(
  z.object({
    taskId: z.uuid('taskId precisa ser um uuid'),
    description: description.default(null),
    completedAt,
    ...tagFields,
  }),
)

const executionChangesSchema = withTagRule(
  z.object({ description, completedAt, ...tagFields }),
)

function isOpenExecutionConflict(err) {
  return (
    err.code === '23505' &&
    err.constraint === 'task_executions_one_open_per_task'
  )
}

const CONFLICT_ERROR = 'Essa tarefa já tem uma execução em andamento'

class TagError extends Error {}

// Valida e grava as tags de uma execução (já dentro de uma transação).
// Grava o fechamento: cada nível 3 escolhido leva o nível 2 pai junto.
// Tag arquivada só pode continuar se já estava; nova, não
async function applyTags(client, executionId, rootTagId, tagIds, previous) {
  if (rootTagId) {
    const root = (
      await client.query('SELECT level, active FROM tags WHERE id = $1', [
        rootTagId,
      ])
    ).rows[0]
    if (!root) throw new TagError('rootTagId não existe')
    if (root.level !== 1) {
      throw new TagError('rootTagId precisa ser uma tag raiz (nível 1)')
    }
    if (!root.active && previous.rootTagId !== rootTagId) {
      throw new TagError('Tag arquivada não pode ser adicionada')
    }
  }

  const ids = [...new Set(tagIds)].filter((id) => id !== rootTagId)
  const found = ids.length
    ? (
        await client.query(
          `SELECT id, level, parent_id AS "parentId",
                  effective_root AS "rootId", active
           FROM tags WHERE id = ANY($1)`,
          [ids],
        )
      ).rows
    : []
  if (found.length !== ids.length) {
    throw new TagError('Uma das tags não existe')
  }

  const before = new Set(previous.tagIds)
  const closure = new Set()
  for (const tag of found) {
    if (tag.rootId !== rootTagId) {
      throw new TagError('Tag não pertence a esse contexto')
    }
    if (!tag.active && !before.has(tag.id)) {
      throw new TagError('Tag arquivada não pode ser adicionada')
    }
    closure.add(tag.id)
    if (tag.level === 3) closure.add(tag.parentId)
  }
  if (closure.size > 20) throw new TagError('No máximo 20 tags por execução')

  // Ordem exigida pelas FKs: soltar as ligações, trocar a raiz, religar
  await client.query(
    'DELETE FROM task_execution_tags WHERE task_execution_id = $1',
    [executionId],
  )
  await client.query(
    'UPDATE task_executions SET root_tag_id = $1 WHERE id = $2',
    [rootTagId, executionId],
  )
  if (closure.size > 0) {
    await client.query(
      `INSERT INTO task_execution_tags
         (task_execution_id, tag_id, tag_parent_id, root_tag_id)
       SELECT $1, id, parent_id, $2 FROM tags WHERE id = ANY($3)`,
      [executionId, rootTagId, [...closure]],
    )
  }
}

executionsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `${SELECT_EXECUTION} GROUP BY e.id ORDER BY e.created_at`,
  )
  res.json(result.rows)
})

executionsRouter.post('/', async (req, res) => {
  const { error, data: execution } = validate(newExecutionSchema, req.body)
  if (error) return res.status(400).json({ error })

  // Execução + tags juntas, ou nada
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Snapshot copiado da própria tarefa, na mesma query — o cliente não manda
    const result = await client.query(
      `INSERT INTO task_executions
         (task_id, description, completed_at, task_title_at_time, task_frequency_at_time)
       SELECT id, $2, $3, title, frequency
       FROM tasks
       WHERE id = $1 AND active
       RETURNING id`,
      [execution.taskId, execution.description, execution.completedAt],
    )
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res
        .status(400)
        .json({ error: 'Tarefa não encontrada ou arquivada' })
    }
    const id = result.rows[0].id
    if (hasTags(execution)) {
      await applyTags(
        client,
        id,
        execution.rootTagId ?? null,
        execution.tagIds ?? [],
        { rootTagId: null, tagIds: [] },
      )
    }
    const created = await findExecution(client, id)
    await client.query('COMMIT')
    res.status(201).json(created)
  } catch (err) {
    await client.query('ROLLBACK')
    if (err instanceof TagError) {
      return res.status(400).json({ error: err.message })
    }
    if (isOpenExecutionConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    throw err
  } finally {
    client.release()
  }
})

executionsRouter.put('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Execução não encontrada' })
  }
  const { error, data: changes } = validate(executionChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  // Finalizar também fecha a sessão rodando dessa execução, e as tags (se
  // vieram) trocam junto: tudo acontece ou nada acontece. Uma transação só
  // existe dentro de uma conexão, por isso pool.connect() e não pool.query()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE task_executions
       SET description = $1, completed_at = $2
       WHERE id = $3
       RETURNING id, root_tag_id AS "rootTagId"`,
      [changes.description, changes.completedAt, req.params.id],
    )
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Execução não encontrada' })
    }
    if (changes.completedAt !== null) {
      await client.query(
        `UPDATE time_entries
         SET ended_at = $1
         WHERE task_execution_id = $2 AND ended_at IS NULL`,
        [changes.completedAt, req.params.id],
      )
    }
    if (hasTags(changes)) {
      const previousTags = await client.query(
        'SELECT tag_id FROM task_execution_tags WHERE task_execution_id = $1',
        [req.params.id],
      )
      await applyTags(
        client,
        req.params.id,
        changes.rootTagId ?? null,
        changes.tagIds ?? [],
        {
          rootTagId: result.rows[0].rootTagId,
          tagIds: previousTags.rows.map((row) => row.tag_id),
        },
      )
    }
    const updated = await findExecution(client, req.params.id)
    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    if (err instanceof TagError) {
      return res.status(400).json({ error: err.message })
    }
    if (isOpenExecutionConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    if (err.code === '23514' && err.constraint === 'time_entries_check') {
      return res.status(400).json({
        error:
          'completedAt não pode ser antes do início da sessão em andamento',
      })
    }
    throw err
  } finally {
    // Sem isso, cada requisição prenderia uma conexão, e o pool (10) se
    // esgotaria
    client.release()
  }
})
