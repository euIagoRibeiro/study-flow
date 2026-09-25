import { Router } from 'express'
import { pool } from '../db.js'

export const executionsRouter = Router()

const COLUMNS = `id,
  task_id AS "taskId",
  description,
  completed_at AS "completedAt",
  task_title_at_time AS "taskTitleAtTime",
  task_frequency_at_time AS "taskFrequencyAtTime"`

executionsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM task_executions ORDER BY created_at`,
  )
  res.json(result.rows)
})
