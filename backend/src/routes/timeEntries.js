import { Router } from 'express'
import { pool } from '../db.js'

export const timeEntriesRouter = Router()

const COLUMNS = `id,
  task_execution_id AS "taskExecutionId",
  started_at AS "startedAt",
  ended_at AS "endedAt"`

timeEntriesRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM time_entries ORDER BY started_at`,
  )
  res.json(result.rows)
})
