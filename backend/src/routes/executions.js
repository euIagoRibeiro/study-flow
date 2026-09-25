import { Router } from 'express'
import { pool } from '../db.js'

export const executionsRouter = Router()

const COLUMNS = `id,
  task_id AS "taskId",
  description,
  completed_at AS "completedAt",
  task_title_at_time AS "taskTitleAtTime",
  task_frequency_at_time AS "taskFrequencyAtTime"`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseDescription(value) {
  if (value === null) return { value: null }
  if (typeof value !== 'string') {
    return { error: 'description precisa ser um texto ou null' }
  }
  const trimmed = value.trim()
  return { value: trimmed === '' ? null : trimmed }
}

function parseCompletedAt(value) {
  if (value === null) return { value: null }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return { error: 'completedAt precisa ser uma data ISO ou null' }
  }
  return { value: new Date(value).toISOString() }
}

function validateNewExecution(body) {
  const { taskId, description = null, completedAt } = body ?? {}
  if (typeof taskId !== 'string' || !UUID.test(taskId)) {
    return { error: 'taskId precisa ser um uuid' }
  }
  if (completedAt === undefined) {
    return {
      error: 'completedAt é obrigatório (data ISO, ou null pra iniciar aberta)',
    }
  }
  const parsedDescription = parseDescription(description)
  if (parsedDescription.error) return parsedDescription
  const parsedCompletedAt = parseCompletedAt(completedAt)
  if (parsedCompletedAt.error) return parsedCompletedAt

  return {
    execution: {
      taskId,
      description: parsedDescription.value,
      completedAt: parsedCompletedAt.value,
    },
  }
}

function validateExecutionChanges(body) {
  const { description, completedAt } = body ?? {}
  if (description === undefined || completedAt === undefined) {
    return {
      error: 'description e completedAt são obrigatórios (podem ser null)',
    }
  }
  const parsedDescription = parseDescription(description)
  if (parsedDescription.error) return parsedDescription
  const parsedCompletedAt = parseCompletedAt(completedAt)
  if (parsedCompletedAt.error) return parsedCompletedAt

  return {
    changes: {
      description: parsedDescription.value,
      completedAt: parsedCompletedAt.value,
    },
  }
}

function isOpenExecutionConflict(err) {
  return (
    err.code === '23505' &&
    err.constraint === 'task_executions_one_open_per_task'
  )
}

const CONFLICT_ERROR = 'Essa tarefa já tem uma execução em andamento'

executionsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM task_executions ORDER BY created_at`,
  )
  res.json(result.rows)
})

executionsRouter.post('/', async (req, res) => {
  const { error, execution } = validateNewExecution(req.body)
  if (error) return res.status(400).json({ error })

  try {
    // Snapshot copiado da própria tarefa, na mesma query — o cliente não manda
    const result = await pool.query(
      `INSERT INTO task_executions
         (task_id, description, completed_at, task_title_at_time, task_frequency_at_time)
       SELECT id, $2, $3, title, frequency
       FROM tasks
       WHERE id = $1 AND active
       RETURNING ${COLUMNS}`,
      [execution.taskId, execution.description, execution.completedAt],
    )
    if (result.rowCount === 0) {
      return res
        .status(400)
        .json({ error: 'Tarefa não encontrada ou arquivada' })
    }
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (isOpenExecutionConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    throw err
  }
})

executionsRouter.put('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) {
    return res.status(404).json({ error: 'Execução não encontrada' })
  }
  const { error, changes } = validateExecutionChanges(req.body)
  if (error) return res.status(400).json({ error })

  try {
    const result = await pool.query(
      `UPDATE task_executions
       SET description = $1, completed_at = $2
       WHERE id = $3
       RETURNING ${COLUMNS}`,
      [changes.description, changes.completedAt, req.params.id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Execução não encontrada' })
    }
    res.json(result.rows[0])
  } catch (err) {
    if (isOpenExecutionConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    throw err
  }
})
