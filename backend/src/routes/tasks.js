import { Router } from 'express'
import { pool } from '../db.js'

export const tasksRouter = Router()

const COLUMNS = 'id, title, frequency, active'
const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly']
const FREQUENCY_ERROR = `frequency precisa ser um de: ${FREQUENCIES.join(', ')}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function validateNewTask(body) {
  const { title, frequency = 'none' } = body ?? {}
  if (!isNonEmptyString(title)) {
    return { error: 'title é obrigatório e não pode ser vazio' }
  }
  if (!FREQUENCIES.includes(frequency)) return { error: FREQUENCY_ERROR }
  return { task: { title: title.trim(), frequency } }
}

function validateTaskChanges(body) {
  const { title, frequency, active } = body ?? {}
  if (title === undefined && frequency === undefined && active === undefined) {
    return { error: 'Nenhum campo pra atualizar (title, frequency, active)' }
  }
  if (title !== undefined && !isNonEmptyString(title)) {
    return { error: 'title não pode ser vazio' }
  }
  if (frequency !== undefined && !FREQUENCIES.includes(frequency)) {
    return { error: FREQUENCY_ERROR }
  }
  if (active !== undefined && typeof active !== 'boolean') {
    return { error: 'active precisa ser true ou false' }
  }
  return { changes: { title: title?.trim(), frequency, active } }
}

tasksRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM tasks ORDER BY created_at`,
  )
  res.json(result.rows)
})

tasksRouter.post('/', async (req, res) => {
  const { error, task } = validateNewTask(req.body)
  if (error) return res.status(400).json({ error })

  const result = await pool.query(
    `INSERT INTO tasks (title, frequency) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [task.title, task.frequency],
  )
  res.status(201).json(result.rows[0])
})

tasksRouter.patch('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) {
    return res.status(404).json({ error: 'Tarefa não encontrada' })
  }
  const { error, changes } = validateTaskChanges(req.body)
  if (error) return res.status(400).json({ error })

  const result = await pool.query(
    `UPDATE tasks
     SET title     = COALESCE($1, title),
         frequency = COALESCE($2, frequency),
         active    = COALESCE($3, active)
     WHERE id = $4
     RETURNING ${COLUMNS}`,
    [
      changes.title ?? null,
      changes.frequency ?? null,
      changes.active ?? null,
      req.params.id,
    ],
  )
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Tarefa não encontrada' })
  }
  res.json(result.rows[0])
})
