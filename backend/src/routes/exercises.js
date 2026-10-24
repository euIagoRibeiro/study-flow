import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isUuid, validate } from '../validation.js'

// Catálogo único de exercícios (A3). O equipamento faz parte do nome:
// "Rosca direta barra" e "Rosca direta halteres" são dois exercícios
export const exercisesRouter = Router()

const NOT_FOUND = 'Exercício não encontrado'
const COLUMNS = 'id, name, active'

const name = z
  .string('name é obrigatório')
  .trim()
  .min(1, 'name não pode ser vazio')
  .max(60, 'name pode ter no máximo 60 caracteres')

const newExerciseSchema = z.object({ name })

const exerciseChangesSchema = z
  .object({
    name: name.optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (name, active)',
  )

function isDuplicateName(err) {
  return err.code === '23505' && err.constraint === 'exercises_name_unique'
}

// O que já existe com esse nome (sem diferenciar maiúscula nem espaço)
async function sameName(text) {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM exercises WHERE lower(btrim(name)) = lower(btrim($1))`,
    [text],
  )
  return result.rows[0]
}

exercisesRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM exercises ORDER BY lower(name)`,
  )
  res.json(result.rows)
})

// Nome repetido: 409 com o existente, pra tela usar ele no meio do treino
exercisesRouter.post('/', async (req, res) => {
  const { error, data } = validate(newExerciseSchema, req.body)
  if (error) return res.status(400).json({ error })
  try {
    const result = await pool.query(
      `INSERT INTO exercises (name) VALUES ($1) RETURNING ${COLUMNS}`,
      [data.name],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (isDuplicateName(err)) {
      return res.status(409).json({
        error: 'Já existe um exercício com esse nome',
        exercise: await sameName(data.name),
      })
    }
    throw err
  }
})

exercisesRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const { error, data: changes } = validate(exerciseChangesSchema, req.body)
  if (error) return res.status(400).json({ error })
  try {
    const result = await pool.query(
      `UPDATE exercises
       SET name   = COALESCE($1, name),
           active = COALESCE($2, active)
       WHERE id = $3
       RETURNING ${COLUMNS}`,
      [changes.name ?? null, changes.active ?? null, req.params.id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: NOT_FOUND })
    }
    res.json(result.rows[0])
  } catch (err) {
    if (isDuplicateName(err)) {
      return res.status(409).json({
        error: 'Já existe um exercício com esse nome',
        exercise: await sameName(changes.name),
      })
    }
    throw err
  }
})

// Só nunca usado; usado: arquivar
exercisesRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  try {
    const result = await pool.query('DELETE FROM exercises WHERE id = $1', [
      req.params.id,
    ])
    if (result.rowCount === 0) {
      return res.status(404).json({ error: NOT_FOUND })
    }
    res.status(204).end()
  } catch (err) {
    if (
      err.code === '23503' &&
      err.constraint === 'execution_exercises_exercise'
    ) {
      return res.status(409).json({
        error:
          'Este exercício está em uso em registros: arquive em vez de apagar',
      })
    }
    throw err
  }
})
