import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isUuid, urlField, validate } from '../validation.js'

// Obras (O2a): catálogo do que se acompanha em vários registros. O tipo é o
// caminho padrão; status manual, sem arquivar: quem filtra é a tela
export const worksRouter = Router()

const NOT_FOUND = 'Obra não encontrada'
const DUPLICATE = 'Já existe uma obra com esse título nesse caminho'
const SELECT_WORK = `SELECT w.id, w.title, w.status,
  w.default_tag_id AS "defaultTagId", w.default_task_id AS "defaultTaskId",
  w.measure_id AS "measureId", w.total::float8 AS total, w.url,
  tag.active AS "defaultTagActive", task.active AS "defaultTaskActive"
FROM works w
JOIN tags tag ON tag.id = w.default_tag_id
JOIN tasks task ON task.id = w.default_task_id`

const title = z
  .string('title é obrigatório')
  .trim()
  .min(1, 'title é obrigatório')
  .max(100, 'title pode ter no máximo 100 caracteres')
const status = z.enum(
  ['em_andamento', 'concluido', 'pausado', 'abandonado'],
  'status inválido',
)
const total = z
  .number('total precisa ser um número')
  .positive('total precisa ser maior que zero')
  .max(99999999.99, 'total grande demais')
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'total aceita no máximo 2 casas decimais',
  )
  .nullable()
const measureId = z.uuid('measureId precisa ser um uuid').nullable()

const newWorkSchema = z.object({
  title,
  status: status.optional(),
  defaultTagId: z.uuid('defaultTagId precisa ser um uuid'),
  defaultTaskId: z.uuid('defaultTaskId precisa ser um uuid'),
  measureId: measureId.optional(),
  total: total.optional(),
  url: urlField('url').optional(),
})

const workChangesSchema = z
  .object({
    title: title.optional(),
    status: status.optional(),
    defaultTagId: z.uuid('defaultTagId precisa ser um uuid').optional(),
    defaultTaskId: z.uuid('defaultTaskId precisa ser um uuid').optional(),
    measureId: measureId.optional(),
    total: total.optional(),
    url: urlField('url').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar',
  )

class WorkError extends Error {}

// A medida que vale pro caminho padrão: a da tag mais funda que declara uma,
// a mesma regra dos registros (arquivada continua sendo a mais próxima)
async function nearestMeasure(db, tagId) {
  const result = await db.query(
    `SELECT m.id, m.active, m.allows_decimal AS "allowsDecimal"
     FROM measures m JOIN tags t ON t.id = m.tag_id
     WHERE t.id = $1
        OR t.id = (SELECT parent_id FROM tags WHERE id = $1)
        OR t.id = (SELECT p.parent_id FROM tags c
                   JOIN tags p ON p.id = c.parent_id WHERE c.id = $1)
     ORDER BY t.level DESC
     LIMIT 1`,
    [tagId],
  )
  return result.rows[0] ?? null
}

// Tag e tarefa novas: precisam existir ativas. Já na obra, ficam mesmo arquivadas
async function checkChoice(db, table, id, label) {
  const found = await db.query(`SELECT active FROM ${table} WHERE id = $1`, [
    id,
  ])
  if (found.rowCount === 0) throw new WorkError(`${label} não existe`)
  if (!found.rows[0].active) throw new WorkError(`${label} está arquivada`)
}

// Soma só a medida que os registros desse caminho usam. Sem total, sem medida
// a conferir além dela; total decimal só em medida que aceita decimal
async function checkMeasure(db, work, measureChanged) {
  if (work.total !== null && work.measureId === null) {
    throw new WorkError('total precisa de uma medida')
  }
  if (work.measureId === null) return
  const nearest = await nearestMeasure(db, work.defaultTagId)
  if (nearest?.id !== work.measureId) {
    throw new WorkError('A medida precisa ser a mais próxima do caminho padrão')
  }
  if (measureChanged && !nearest.active) {
    throw new WorkError('Essa medida está arquivada')
  }
  if (
    work.total !== null &&
    !nearest.allowsDecimal &&
    !Number.isInteger(work.total)
  ) {
    throw new WorkError('Essa medida não aceita decimal')
  }
}

function writeError(err) {
  if (err instanceof WorkError) return { status: 400, error: err.message }
  if (err.code === '23505' && err.constraint === 'works_title_unique') {
    return { status: 409, error: DUPLICATE }
  }
  // Rede: tag, tarefa ou medida apagada entre a conferência e a escrita, ou
  // texto que a validação deixou passar e o banco recusa
  if (err.code === '23503' && err.constraint?.startsWith('works_')) {
    return { status: 400, error: 'A tag, a tarefa ou a medida não existe mais' }
  }
  if (err.code === '23514' && err.constraint?.startsWith('works_')) {
    return { status: 400, error: 'Título ou URL inválido' }
  }
  return null
}

const findWork = async (db, id) =>
  (await db.query(`${SELECT_WORK} WHERE w.id = $1`, [id])).rows[0]

worksRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `${SELECT_WORK} ORDER BY lower(w.title), w.id`,
  )
  res.json(result.rows)
})

worksRouter.post('/', async (req, res) => {
  const { error, data } = validate(newWorkSchema, req.body)
  if (error) return res.status(400).json({ error })
  const work = { measureId: null, total: null, url: null, ...data }

  try {
    await checkChoice(pool, 'tags', work.defaultTagId, 'A tag')
    await checkChoice(pool, 'tasks', work.defaultTaskId, 'A tarefa')
    await checkMeasure(pool, work, true)
    const result = await pool.query(
      `INSERT INTO works
         (title, status, default_tag_id, default_task_id, measure_id, total, url)
       VALUES ($1, COALESCE($2::work_status, 'em_andamento'), $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        work.title,
        work.status ?? null,
        work.defaultTagId,
        work.defaultTaskId,
        work.measureId,
        work.total,
        work.url,
      ],
    )
    res.status(201).json(await findWork(pool, result.rows[0].id))
  } catch (err) {
    const known = writeError(err)
    if (known) return res.status(known.status).json({ error: known.error })
    throw err
  }
})

worksRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const { error, data: changes } = validate(workChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT default_tag_id AS "defaultTagId", default_task_id AS "defaultTaskId",
              measure_id AS "measureId", total::float8 AS total
       FROM works WHERE id = $1 FOR NO KEY UPDATE`,
      [req.params.id],
    )
    if (found.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: NOT_FOUND })
    }
    const current = found.rows[0]
    const next = { ...current, ...changes }
    if (next.defaultTagId !== current.defaultTagId) {
      await checkChoice(client, 'tags', next.defaultTagId, 'A tag')
    }
    if (next.defaultTaskId !== current.defaultTaskId) {
      await checkChoice(client, 'tasks', next.defaultTaskId, 'A tarefa')
    }
    await checkMeasure(client, next, next.measureId !== current.measureId)
    await client.query(
      `UPDATE works
       SET title = COALESCE($1, title),
           status = COALESCE($2::work_status, status),
           default_tag_id = $3, default_task_id = $4, measure_id = $5, total = $6,
           url = CASE WHEN $7 THEN $8 ELSE url END
       WHERE id = $9`,
      [
        changes.title ?? null,
        changes.status ?? null,
        next.defaultTagId,
        next.defaultTaskId,
        next.measureId,
        next.total,
        changes.url !== undefined,
        changes.url ?? null,
        req.params.id,
      ],
    )
    const updated = await findWork(client, req.params.id)
    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    const known = writeError(err)
    if (known) return res.status(known.status).json({ error: known.error })
    throw err
  } finally {
    client.release()
  }
})

// Só sem registro; com registro, o caminho é mudar o status
worksRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  try {
    const result = await pool.query('DELETE FROM works WHERE id = $1', [
      req.params.id,
    ])
    if (result.rowCount === 0) {
      return res.status(404).json({ error: NOT_FOUND })
    }
    res.status(204).end()
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'task_executions_work') {
      return res.status(409).json({
        error: 'Esta obra tem registros: mude o status em vez de apagar',
      })
    }
    throw err
  }
})
