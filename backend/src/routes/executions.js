import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isoDateTime, isUuid, validate } from '../validation.js'

export const executionsRouter = Router()

const COLUMNS = `id,
  task_id AS "taskId",
  description,
  completed_at AS "completedAt",
  task_title_at_time AS "taskTitleAtTime",
  task_frequency_at_time AS "taskFrequencyAtTime"`

const description = z
  .string('description precisa ser um texto ou null')
  .trim()
  .transform((text) => (text === '' ? null : text))
  .nullable()

const completedAt = isoDateTime(
  'completedAt precisa ser uma data ISO ou null',
).nullable()

// completedAt sem .optional(): pra iniciar aberta, o null tem que vir explícito
const newExecutionSchema = z.object({
  taskId: z.uuid('taskId precisa ser um uuid'),
  description: description.default(null),
  completedAt,
})

const executionChangesSchema = z.object({ description, completedAt })

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
  const { error, data: execution } = validate(newExecutionSchema, req.body)
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
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Execução não encontrada' })
  }
  const { error, data: changes } = validate(executionChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  // Finalizar também fecha a sessão rodando dessa execução: as duas
  // escritas acontecem juntas ou nenhuma acontece. Uma transação só existe
  // dentro de uma conexão, por isso pool.connect() e não pool.query()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE task_executions
       SET description = $1, completed_at = $2
       WHERE id = $3
       RETURNING ${COLUMNS}`,
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
    await client.query('COMMIT')
    res.json(result.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
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
