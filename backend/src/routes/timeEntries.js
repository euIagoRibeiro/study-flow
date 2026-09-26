import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isoDateTime, isUuid, validate } from '../validation.js'

export const timeEntriesRouter = Router()

const COLUMNS = `id,
  task_execution_id AS "taskExecutionId",
  started_at AS "startedAt",
  ended_at AS "endedAt"`

const startedAt = isoDateTime('startedAt precisa ser uma data ISO')

const newTimeEntrySchema = z.object({
  taskExecutionId: z.uuid('taskExecutionId precisa ser um uuid'),
  startedAt,
})

// Comparar as strings funciona porque as duas já saem normalizadas pelo
// toISOString(), no mesmo formato e em UTC
const timeEntryChangesSchema = z
  .object({
    startedAt,
    endedAt: isoDateTime('endedAt precisa ser uma data ISO ou null').nullable(),
  })
  .refine(
    ({ startedAt, endedAt }) => endedAt === null || endedAt >= startedAt,
    'endedAt não pode ser antes de startedAt',
  )

function isRunningConflict(err) {
  return err.code === '23505' && err.constraint === 'time_entries_one_running'
}

const CONFLICT_ERROR = 'Já existe um cronômetro rodando'

timeEntriesRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM time_entries ORDER BY started_at`,
  )
  res.json(result.rows)
})

// Sessão nova sempre nasce rodando, e só em execução aberta
timeEntriesRouter.post('/', async (req, res) => {
  const { error, data: entry } = validate(newTimeEntrySchema, req.body)
  if (error) return res.status(400).json({ error })

  try {
    const result = await pool.query(
      `INSERT INTO time_entries (task_execution_id, started_at)
       SELECT id, $2
       FROM task_executions
       WHERE id = $1 AND completed_at IS NULL
       RETURNING ${COLUMNS}`,
      [entry.taskExecutionId, entry.startedAt],
    )
    if (result.rowCount === 0) {
      return res
        .status(400)
        .json({ error: 'Execução não encontrada ou já finalizada' })
    }
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (isRunningConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    throw err
  }
})

timeEntriesRouter.put('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Sessão não encontrada' })
  }
  const { error, data: changes } = validate(timeEntryChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  try {
    // Reabrir (endedAt null) só se a execução dela estiver aberta: senão
    // sobraria uma sessão rodando dentro de uma execução concluída.
    // O cast é obrigatório: sozinho no IS NOT NULL, o Postgres não deduz o
    // tipo de $2 (erro 42P08, testado)
    const result = await pool.query(
      `UPDATE time_entries
       SET started_at = $1, ended_at = $2
       WHERE id = $3
         AND ($2::timestamptz IS NOT NULL OR EXISTS (
           SELECT 1 FROM task_executions
           WHERE id = time_entries.task_execution_id AND completed_at IS NULL
         ))
       RETURNING ${COLUMNS}`,
      [changes.startedAt, changes.endedAt, req.params.id],
    )
    if (result.rowCount === 0) {
      const exists = await pool.query(
        'SELECT 1 FROM time_entries WHERE id = $1',
        [req.params.id],
      )
      if (exists.rowCount === 0) {
        return res.status(404).json({ error: 'Sessão não encontrada' })
      }
      return res.status(400).json({
        error: 'Só dá pra reabrir sessão de uma execução em andamento',
      })
    }
    res.json(result.rows[0])
  } catch (err) {
    if (isRunningConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    throw err
  }
})
