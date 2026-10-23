import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isUuid, validate } from '../validation.js'

// Medidas por contexto: a tag declara o que se mede nos registros dela
// (descendentes herdam; subtag substitui). Treino fica fora (A3)
export const measuresRouter = Router()
export const measureKindsRouter = Router()

const NOT_FOUND = 'Medida não encontrada'
const KIND_NOT_FOUND = 'Tipo não encontrado'

const label = (field) =>
  z
    .string(`${field} é obrigatório`)
    .trim()
    .min(1, `${field} não pode ser vazio`)
    .max(30, `${field} pode ter no máximo 30 caracteres`)

const newMeasureSchema = z.object({
  tagId: z.uuid('tagId precisa ser um id válido'),
  name: label('name'),
  singular: label('singular'),
  allowsDecimal: z
    .boolean('allowsDecimal precisa ser true ou false')
    .default(false),
  kinds: z
    .array(label('kinds'), 'kinds precisa ser uma lista')
    .max(20)
    .default([]),
})

const measureChangesSchema = z
  .object({
    name: label('name').optional(),
    singular: label('singular').optional(),
    allowsDecimal: z
      .boolean('allowsDecimal precisa ser true ou false')
      .optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (name, singular, allowsDecimal, active)',
  )

const kindSchema = z.object({ name: label('name') })

const kindChangesSchema = z
  .object({
    name: label('name').optional(),
    active: z.boolean('active precisa ser true ou false').optional(),
  })
  .refine(
    (changes) => Object.keys(changes).length > 0,
    'Nenhum campo pra atualizar (name, active)',
  )

// Tipos em ordem alfabética (a tela ordena em português; aqui é estável)
const SELECT_MEASURE = `SELECT m.id, m.tag_id AS "tagId", m.name, m.singular,
  m.allows_decimal AS "allowsDecimal", m.active,
  COALESCE(
    (SELECT json_agg(json_build_object('id', k.id, 'name', k.name, 'active', k.active)
                     ORDER BY lower(k.name))
     FROM measure_kinds k WHERE k.measure_id = m.id),
    '[]'
  ) AS kinds
FROM measures m`

async function findMeasure(db, id) {
  const result = await db.query(`${SELECT_MEASURE} WHERE m.id = $1`, [id])
  return result.rows[0]
}

const KIND_COLUMNS = 'id, name, active'

function isDuplicate(err, constraint) {
  return err.code === '23505' && err.constraint === constraint
}

measuresRouter.get('/', async (req, res) => {
  const result = await pool.query(`${SELECT_MEASURE} ORDER BY lower(m.name)`)
  res.json(result.rows)
})

// Medida e tipos juntos, ou nada
measuresRouter.post('/', async (req, res) => {
  const { error, data: measure } = validate(newMeasureSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tag = await client.query('SELECT active FROM tags WHERE id = $1', [
      measure.tagId,
    ])
    if (tag.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'tagId não existe' })
    }
    if (!tag.rows[0].active) {
      await client.query('ROLLBACK')
      return res
        .status(400)
        .json({ error: 'Tag arquivada não recebe medida nova' })
    }
    const result = await client.query(
      `INSERT INTO measures (tag_id, name, singular, allows_decimal)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [measure.tagId, measure.name, measure.singular, measure.allowsDecimal],
    )
    const id = result.rows[0].id
    for (const name of measure.kinds) {
      await client.query(
        'INSERT INTO measure_kinds (measure_id, name) VALUES ($1, $2)',
        [id, name],
      )
    }
    const created = await findMeasure(client, id)
    await client.query('COMMIT')
    res.status(201).json(created)
  } catch (err) {
    await client.query('ROLLBACK')
    if (isDuplicate(err, 'measures_tag_id_key')) {
      return res.status(409).json({ error: 'Esta tag já tem uma medida' })
    }
    if (isDuplicate(err, 'measure_kinds_name_unique')) {
      return res.status(409).json({ error: 'Tipo repetido nesta medida' })
    }
    throw err
  } finally {
    client.release()
  }
})

measuresRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const { error, data: changes } = validate(measureChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  // Desligar o decimal com valor decimal gravado: recusar, nunca arredondar
  if (changes.allowsDecimal === false) {
    const decimals = await pool.query(
      `SELECT 1 FROM execution_measure_values
       WHERE measure_id = $1 AND quantity <> trunc(quantity) LIMIT 1`,
      [req.params.id],
    )
    if (decimals.rowCount > 0) {
      return res.status(409).json({
        error: 'Há registros com decimal nesta medida: corrija-os antes',
      })
    }
  }
  const result = await pool.query(
    `UPDATE measures
     SET name           = COALESCE($1, name),
         singular       = COALESCE($2, singular),
         allows_decimal = COALESCE($3, allows_decimal),
         active         = COALESCE($4, active)
     WHERE id = $5
     RETURNING id`,
    [
      changes.name ?? null,
      changes.singular ?? null,
      changes.allowsDecimal ?? null,
      changes.active ?? null,
      req.params.id,
    ],
  )
  if (result.rowCount === 0) return res.status(404).json({ error: NOT_FOUND })
  res.json(await findMeasure(pool, req.params.id))
})

// Só nunca usada; os tipos (também nunca usados) vão junto. Usada: arquivar
measuresRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM measure_kinds WHERE measure_id = $1', [
      req.params.id,
    ])
    const result = await client.query('DELETE FROM measures WHERE id = $1', [
      req.params.id,
    ])
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: NOT_FOUND })
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (err) {
    await client.query('ROLLBACK')
    // Usada: pela linha de medida de um registro, ou um tipo dela por um valor
    if (
      err.code === '23503' &&
      [
        'execution_measures_measure_tag',
        'execution_measure_values_kind_of_measure',
      ].includes(err.constraint)
    ) {
      return res.status(409).json({
        error: 'Esta medida está em uso em registros: arquive em vez de apagar',
      })
    }
    throw err
  } finally {
    client.release()
  }
})

measuresRouter.post('/:id/kinds', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: NOT_FOUND })
  }
  const { error, data: kind } = validate(kindSchema, req.body)
  if (error) return res.status(400).json({ error })
  try {
    const result = await pool.query(
      `INSERT INTO measure_kinds (measure_id, name) VALUES ($1, $2)
       RETURNING ${KIND_COLUMNS}`,
      [req.params.id, kind.name],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (isDuplicate(err, 'measure_kinds_name_unique')) {
      return res.status(409).json({ error: 'Tipo repetido nesta medida' })
    }
    if (err.code === '23503' && err.constraint === 'measure_kinds_measure') {
      return res.status(404).json({ error: NOT_FOUND })
    }
    throw err
  }
})

measureKindsRouter.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: KIND_NOT_FOUND })
  }
  const { error, data: changes } = validate(kindChangesSchema, req.body)
  if (error) return res.status(400).json({ error })
  try {
    const result = await pool.query(
      `UPDATE measure_kinds
       SET name = COALESCE($1, name), active = COALESCE($2, active)
       WHERE id = $3
       RETURNING ${KIND_COLUMNS}`,
      [changes.name ?? null, changes.active ?? null, req.params.id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: KIND_NOT_FOUND })
    }
    res.json(result.rows[0])
  } catch (err) {
    if (isDuplicate(err, 'measure_kinds_name_unique')) {
      return res.status(409).json({ error: 'Tipo repetido nesta medida' })
    }
    throw err
  }
})

measureKindsRouter.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: KIND_NOT_FOUND })
  }
  try {
    const result = await pool.query('DELETE FROM measure_kinds WHERE id = $1', [
      req.params.id,
    ])
    if (result.rowCount === 0) {
      return res.status(404).json({ error: KIND_NOT_FOUND })
    }
    res.status(204).end()
  } catch (err) {
    if (
      err.code === '23503' &&
      err.constraint === 'execution_measure_values_kind_of_measure'
    ) {
      return res.status(409).json({
        error: 'Este tipo está em uso em registros: arquive em vez de apagar',
      })
    }
    throw err
  }
})
