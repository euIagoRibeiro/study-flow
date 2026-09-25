import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isUuid, validate } from '../validation.js'

export const tasksRouter = Router()

const COLUMNS = 'id, title, frequency, active'
const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly']

const frequency = z.enum(
  FREQUENCIES,
  `frequency precisa ser um de: ${FREQUENCIES.join(', ')}`,
)

function title(message) {
  return z.string(message).trim().min(1, message)
}

const newTaskSchema = z.object({
  title: title('title é obrigatório e não pode ser vazio'),
  frequency: frequency.default('none'),
})

const taskChangesSchema = z
  .object({
    title: title('title não pode ser vazio').optional(),
    frequency: frequency.optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (title, frequency, active)',
  )

tasksRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM tasks ORDER BY created_at`,
  )
  res.json(result.rows)
})

tasksRouter.post('/', async (req, res) => {
  const { error, data: task } = validate(newTaskSchema, req.body)
  if (error) return res.status(400).json({ error })

  const result = await pool.query(
    `INSERT INTO tasks (title, frequency) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [task.title, task.frequency],
  )
  res.status(201).json(result.rows[0])
})

tasksRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Tarefa não encontrada' })
  }
  const { error, data: changes } = validate(taskChangesSchema, req.body)
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
