import { Router } from 'express'
import { pool } from '../db.js'

export const tasksRouter = Router()

tasksRouter.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT id, title, frequency, active FROM tasks ORDER BY created_at',
  )
  res.json(result.rows)
})
