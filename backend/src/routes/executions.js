import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isoDateTime, isUuid, validate } from '../validation.js'
import { TIME_ENTRY_COLUMNS } from './timeEntries.js'

export const executionsRouter = Router()

// tagIds = o que está gravado (o fechamento); quem mostra só as folhas é a tela
const SELECT_EXECUTION = `SELECT e.id,
  e.task_id AS "taskId",
  e.description,
  e.completed_at AS "completedAt",
  e.task_title_at_time AS "taskTitleAtTime",
  e.task_frequency_at_time AS "taskFrequencyAtTime",
  e.root_tag_id AS "rootTagId",
  e.phase,
  COALESCE(
    array_agg(et.tag_id ORDER BY et.tag_id) FILTER (WHERE et.tag_id IS NOT NULL),
    '{}'
  ) AS "tagIds",
  (SELECT json_build_object(
     'measureId', em.measure_id,
     'values', COALESCE(
       -- Pelo nome do tipo (o desempate por created_at caía no uuid aleatório:
       -- valores do mesmo pedido têm o mesmo now()). A tela reordena com a
       -- regra dela, sem depender da collation do banco
       (SELECT json_agg(json_build_object('kindId', v.kind_id, 'quantity', v.quantity::float8)
                        ORDER BY lower(k.name), v.kind_id)
        FROM execution_measure_values v
        LEFT JOIN measure_kinds k ON k.id = v.kind_id
        WHERE v.task_execution_id = e.id),
       '[]'))
   FROM execution_measures em WHERE em.task_execution_id = e.id) AS measure,
  (SELECT json_agg(json_build_object(
     'exerciseId', x.exercise_id,
     'sets', (SELECT json_agg(json_build_object('reps', s.reps, 'weightKg', s.weight_kg::float8)
                              ORDER BY s.position)
              FROM exercise_sets s WHERE s.execution_exercise_id = x.id))
     ORDER BY x.position)
   FROM execution_exercises x WHERE x.task_execution_id = e.id) AS workout
FROM task_executions e
LEFT JOIN task_execution_tags et ON et.task_execution_id = e.id`

async function findExecution(db, id) {
  const result = await db.query(
    `${SELECT_EXECUTION} WHERE e.id = $1 GROUP BY e.id`,
    [id],
  )
  return result.rows[0]
}

const description = z
  .string('description precisa ser um texto ou null')
  .trim()
  .transform((text) => (text === '' ? null : text))
  .nullable()

const completedAt = isoDateTime(
  'completedAt precisa ser uma data ISO ou null',
).nullable()

// Opcionais: ausentes, as tags não mudam (finalizar/desfazer não mandam)
const tagFields = {
  rootTagId: z
    .uuid('rootTagId precisa ser um uuid ou null')
    .nullable()
    .optional(),
  tagIds: z
    .array(
      z.uuid('tagIds precisa ser uma lista de uuids'),
      'tagIds precisa ser uma lista de uuids',
    )
    .max(20, 'No máximo 20 tags por execução')
    .optional(),
}

const PHASES = ['requisitos', 'prototipo', 'validacao', 'implementacao']

// Ausente: no POST, sem fase; no PUT, mantém. null limpa
const phase = z
  .enum(PHASES, `phase precisa ser um de: ${PHASES.join(', ')}, ou null`)
  .nullable()
  .optional()

// Duração estimada em minutos inteiros. Ausente: no POST, sem estimativa;
// no PUT, mantém (e acompanha o "Quando"). null remove
const estimatedMinutes = z
  .number('estimatedMinutes precisa ser um número de minutos ou null')
  .int('estimatedMinutes precisa ser um número inteiro de minutos')
  .min(1, 'estimatedMinutes precisa ser de 1 a 1440')
  .max(1440, 'estimatedMinutes precisa ser de 1 a 1440')
  .nullable()
  .optional()

// Medida por contexto: o servidor descobre QUAL medida pelo caminho; a
// tela manda só os valores. No PUT, ausente mantém e [] remove
const measureValues = z
  .array(
    z.object({
      kindId: z.uuid('kindId precisa ser um uuid ou null').nullable(),
      quantity: z
        .number('quantity precisa ser um número')
        .positive('quantity precisa ser maior que zero')
        .max(99999999.99, 'quantity pode ir até 99.999.999,99'),
    }),
    'measureValues precisa ser uma lista',
  )
  .max(20, 'No máximo 20 valores por registro')
  .optional()

// Treino (A3): a lista inteira, em ordem. Ausente mantém, [] remove, lista
// substitui tudo. Os tetos são de garantia, não regra de tela. O banco
// arredondaria a 3ª casa do peso em silêncio: recusar antes
const workout = z
  .array(
    z.object({
      exerciseId: z.uuid('exerciseId precisa ser um uuid'),
      sets: z
        .array(
          z.object({
            reps: z
              .number('reps precisa ser um número')
              .int('reps precisa ser um número inteiro')
              .min(1, 'reps precisa ser pelo menos 1')
              .max(1000, 'reps pode ir até 1000'),
            weightKg: z
              .number('weightKg precisa ser um número ou null')
              .positive(
                'weightKg precisa ser maior que zero (peso do corpo = null)',
              )
              .max(9999.99, 'weightKg pode ir até 9999,99')
              .refine(
                (kg) => Math.abs(kg * 100 - Math.round(kg * 100)) < 1e-6,
                'weightKg pode ter no máximo 2 casas decimais',
              )
              .nullable()
              .default(null),
          }),
          'sets precisa ser uma lista',
        )
        .min(1, 'Cada exercício precisa de pelo menos uma série')
        .max(50, 'No máximo 50 séries por exercício'),
    }),
    'workout precisa ser uma lista',
  )
  .max(30, 'No máximo 30 exercícios por registro')

const workoutSchema = z.object({ workout })

function withTagRule(schema) {
  return schema
    .refine(
      (data) => !(data.tagIds?.length > 0 && !data.rootTagId),
      'tagIds precisa de rootTagId',
    )
    .refine(
      (data) => !(data.estimatedMinutes && data.completedAt === null),
      'Duração estimada só em registro concluído',
    )
}

function hasTags(data) {
  return data.rootTagId !== undefined || data.tagIds !== undefined
}

// completedAt sem .optional(): pra iniciar aberta, o null tem que vir explícito
const newExecutionSchema = withTagRule(
  z.object({
    taskId: z.uuid('taskId precisa ser um uuid'),
    description: description.default(null),
    completedAt,
    phase,
    estimatedMinutes,
    measureValues,
    ...tagFields,
  }),
)

const executionChangesSchema = withTagRule(
  z.object({
    description,
    completedAt,
    phase,
    estimatedMinutes,
    measureValues,
    workout: workout.optional(),
    ...tagFields,
  }),
)

class MeasureError extends Error {}
class WorkoutError extends Error {}

// A marcadora do caminho GRAVADO: a tag mais funda que usa treino
async function nearestMarker(client, executionId) {
  const result = await client.query(
    `SELECT t.id FROM tags t
     WHERE t.tracks_workout AND t.id IN (
       SELECT root_tag_id FROM task_executions WHERE id = $1
       UNION SELECT tag_id FROM task_execution_tags WHERE task_execution_id = $1)
     ORDER BY t.level DESC, t.id
     LIMIT 1`,
    [executionId],
  )
  return result.rows[0]?.id ?? null
}

// Grava o treino inteiro (dentro de uma transação, com o caminho gravado e
// a linha do registro travada). [] remove. Arquivado: só se já estava
async function setWorkout(client, executionId, exercises) {
  const previous = await client.query(
    'SELECT exercise_id FROM execution_exercises WHERE task_execution_id = $1',
    [executionId],
  )
  const kept = new Set(previous.rows.map((row) => row.exercise_id))
  await dropWorkout(client, executionId)
  if (exercises.length === 0) return

  const marker = await nearestMarker(client, executionId)
  if (!marker) throw new WorkoutError('Este caminho não usa treino')
  const ids = exercises.map((item) => item.exerciseId)
  if (new Set(ids).size !== ids.length) {
    throw new WorkoutError(
      'Exercício repetido no mesmo registro: junte as séries num só',
    )
  }
  const found = new Map(
    (
      await client.query(
        'SELECT id, active FROM exercises WHERE id = ANY($1::uuid[])',
        [ids],
      )
    ).rows.map((row) => [row.id, row.active]),
  )
  for (const id of ids) {
    if (!found.has(id)) throw new WorkoutError('Exercício não encontrado')
    if (!found.get(id) && !kept.has(id)) {
      throw new WorkoutError('Exercício arquivado não pode ser adicionado')
    }
  }

  await client.query(
    `INSERT INTO execution_workouts (task_execution_id, tag_id, root_tag_id)
     SELECT id, $2, root_tag_id FROM task_executions WHERE id = $1`,
    [executionId, marker],
  )
  for (const [index, item] of exercises.entries()) {
    const inserted = await client.query(
      `INSERT INTO execution_exercises (task_execution_id, exercise_id, position)
       VALUES ($1, $2, $3) RETURNING id`,
      [executionId, item.exerciseId, index + 1],
    )
    for (const [setIndex, set] of item.sets.entries()) {
      await client.query(
        `INSERT INTO exercise_sets (execution_exercise_id, position, reps, weight_kg)
         VALUES ($1, $2, $3, $4)`,
        [inserted.rows[0].id, setIndex + 1, set.reps, set.weightKg],
      )
    }
  }
}

async function dropWorkout(client, executionId) {
  await client.query(
    `DELETE FROM exercise_sets WHERE execution_exercise_id IN
       (SELECT id FROM execution_exercises WHERE task_execution_id = $1)`,
    [executionId],
  )
  await client.query(
    'DELETE FROM execution_exercises WHERE task_execution_id = $1',
    [executionId],
  )
  await client.query(
    'DELETE FROM execution_workouts WHERE task_execution_id = $1',
    [executionId],
  )
}

// Caminho trocado sem mandar o treino: sai o treino cuja marcadora deixou
// o caminho (a tela avisa antes; aqui é a garantia)
async function dropWorkoutIfOffPath(client, executionId) {
  const off = await client.query(
    `SELECT 1 FROM execution_workouts w
     WHERE w.task_execution_id = $1
       AND w.tag_id <> w.root_tag_id
       AND NOT EXISTS (SELECT 1 FROM task_execution_tags et
                       WHERE et.task_execution_id = w.task_execution_id
                         AND et.tag_id = w.tag_id)`,
    [executionId],
  )
  if (off.rowCount > 0) await dropWorkout(client, executionId)
}

// Rede de segurança: recusas do banco (migration 0012), pelo nome
function workoutConstraintError(err) {
  return (
    ['23503', '23505', '23514'].includes(err.code) &&
    ['execution_workouts_', 'execution_exercises_', 'exercise_sets_'].some(
      (prefix) => err.constraint?.startsWith(prefix),
    )
  )
}

// A medida que vale pro caminho GRAVADO: a da tag mais funda que declara
// uma. Arquivada continua sendo a mais próxima (não volta pro ancestral:
// a subtag substituiu de propósito)
async function nearestMeasure(client, executionId) {
  const result = await client.query(
    `SELECT m.id, m.tag_id AS "tagId", m.active, m.allows_decimal AS "allowsDecimal", t.level
     FROM measures m JOIN tags t ON t.id = m.tag_id
     WHERE m.tag_id IN (
       SELECT root_tag_id FROM task_executions WHERE id = $1
       UNION SELECT tag_id FROM task_execution_tags WHERE task_execution_id = $1)
     ORDER BY t.level DESC`,
    [executionId],
  )
  const [first, second] = result.rows
  // Registro antigo com 2 temas no mesmo nível, cada um com medida
  if (second && second.level === first.level) {
    throw new MeasureError('Registro com mais de um tema não tem medida')
  }
  return first ?? null
}

// Grava os valores (já dentro de uma transação, com o caminho gravado).
// [] remove a medida do registro. Tipo/medida arquivados: só se já estavam
async function setMeasure(client, executionId, values) {
  const previous = await client.query(
    `SELECT em.measure_id AS "measureId",
            array_remove(array_agg(v.kind_id), NULL) AS "kindIds"
     FROM execution_measures em
     LEFT JOIN execution_measure_values v ON v.task_execution_id = em.task_execution_id
     WHERE em.task_execution_id = $1
     GROUP BY em.measure_id`,
    [executionId],
  )
  const before = previous.rows[0]
  await dropMeasure(client, executionId)
  if (values.length === 0) return

  const measure = await nearestMeasure(client, executionId)
  if (!measure) throw new MeasureError('Este caminho não tem medida')
  const keeps = before?.measureId === measure.id
  if (!measure.active && !keeps) {
    throw new MeasureError('A medida deste caminho está arquivada')
  }
  const kinds = new Map(
    (
      await client.query(
        'SELECT id, active FROM measure_kinds WHERE measure_id = $1',
        [measure.id],
      )
    ).rows.map((kind) => [kind.id, kind.active]),
  )
  const keptKinds = new Set(keeps ? before.kindIds : [])
  const seen = new Set()
  for (const value of values) {
    if (kinds.size > 0) {
      if (value.kindId === null) {
        throw new MeasureError(
          'Esta medida tem tipos: escolha o tipo de cada valor',
        )
      }
      if (!kinds.has(value.kindId)) {
        throw new MeasureError('Tipo que não é desta medida')
      }
      if (!kinds.get(value.kindId) && !keptKinds.has(value.kindId)) {
        throw new MeasureError('Tipo arquivado não pode ser adicionado')
      }
    } else {
      if (value.kindId !== null) {
        throw new MeasureError('Esta medida não tem tipos')
      }
      if (values.length > 1) {
        throw new MeasureError('Esta medida tem um valor só')
      }
    }
    if (seen.has(value.kindId)) {
      throw new MeasureError('Tipo repetido no mesmo registro')
    }
    seen.add(value.kindId)
    // O banco arredondaria a 3ª casa em silêncio; a tolerância cobre
    // 5,55 * 100 = 554,999… em ponto flutuante
    const hundredths =
      Math.abs(value.quantity * 100 - Math.round(value.quantity * 100)) < 1e-6
    if (
      measure.allowsDecimal ? !hundredths : !Number.isInteger(value.quantity)
    ) {
      throw new MeasureError(
        measure.allowsDecimal
          ? 'Quantidade com no máximo 2 casas decimais'
          : 'Esta medida aceita só números inteiros',
      )
    }
  }

  await client.query(
    `INSERT INTO execution_measures (task_execution_id, measure_id, tag_id, root_tag_id)
     SELECT id, $2, $3, root_tag_id FROM task_executions WHERE id = $1`,
    [executionId, measure.id, measure.tagId],
  )
  for (const value of values) {
    await client.query(
      `INSERT INTO execution_measure_values (task_execution_id, measure_id, kind_id, quantity)
       VALUES ($1, $2, $3, $4)`,
      [executionId, measure.id, value.kindId, value.quantity],
    )
  }
}

async function dropMeasure(client, executionId) {
  await client.query(
    'DELETE FROM execution_measure_values WHERE task_execution_id = $1',
    [executionId],
  )
  await client.query(
    'DELETE FROM execution_measures WHERE task_execution_id = $1',
    [executionId],
  )
}

// Caminho trocado sem mandar medidas: sai a medida cuja declarante deixou
// o caminho (a tela avisa antes; aqui é a garantia)
async function dropMeasureIfOffPath(client, executionId) {
  const off = await client.query(
    `SELECT 1 FROM execution_measures em
     WHERE em.task_execution_id = $1
       AND em.tag_id <> em.root_tag_id
       AND NOT EXISTS (SELECT 1 FROM task_execution_tags et
                       WHERE et.task_execution_id = em.task_execution_id
                         AND et.tag_id = em.tag_id)`,
    [executionId],
  )
  if (off.rowCount > 0) await dropMeasure(client, executionId)
}

// Rede de segurança: recusas do banco (migration 0010), pelo nome
function measureConstraintError(err) {
  return (
    ['23503', '23505', '23514'].includes(err.code) &&
    (err.constraint?.startsWith('execution_measures_') ||
      err.constraint?.startsWith('execution_measure_values_'))
  )
}

// A estimativa é uma sessão marcada: termina no "Quando" do registro e
// começa X minutos antes. Trocar = apagar e criar (nunca duas ao mesmo tempo)
async function setEstimate(client, executionId, minutes) {
  await client.query(
    'DELETE FROM time_entries WHERE task_execution_id = $1 AND estimated',
    [executionId],
  )
  if (minutes === null) return
  await client.query(
    `INSERT INTO time_entries (task_execution_id, started_at, ended_at, estimated)
     SELECT id, completed_at - make_interval(mins => $2), completed_at, true
     FROM task_executions WHERE id = $1`,
    [executionId, minutes],
  )
}

// "Quando" mudou: a estimativa vai junto, mantendo a duração. As sessões
// de cronômetro não se movem (são horários reais)
async function followCompletedAt(client, executionId) {
  await client.query(
    `UPDATE time_entries te
     SET started_at = e.completed_at - (te.ended_at - te.started_at),
         ended_at = e.completed_at
     FROM task_executions e
     WHERE e.id = te.task_execution_id
       AND te.task_execution_id = $1
       AND te.estimated`,
    [executionId],
  )
}

// A tela guarda as sessões separadas: a resposta leva as do registro
async function entriesOf(client, executionId) {
  const result = await client.query(
    `SELECT ${TIME_ENTRY_COLUMNS} FROM time_entries
     WHERE task_execution_id = $1 ORDER BY started_at`,
    [executionId],
  )
  return result.rows
}

// Recusas da fase (migration 0007), pelo nome da regra
function phaseError(err) {
  if (
    err.code === '23514' &&
    err.constraint === 'task_executions_phase_needs_root'
  ) {
    return 'Fase precisa de um contexto'
  }
  if (
    err.code === '23503' &&
    err.constraint === 'task_executions_phase_root_tracks'
  ) {
    return 'Esse contexto não usa fase'
  }
  return null
}

async function setPhase(client, executionId, newPhase) {
  await client.query('UPDATE task_executions SET phase = $1 WHERE id = $2', [
    newPhase,
    executionId,
  ])
}

function isOpenExecutionConflict(err) {
  return (
    err.code === '23505' &&
    err.constraint === 'task_executions_one_open_per_task'
  )
}

const CONFLICT_ERROR = 'Essa tarefa já tem uma execução em andamento'

class TagError extends Error {}

// Valida e grava as tags de uma execução (já dentro de uma transação).
// Grava o fechamento: cada nível 3 escolhido leva o nível 2 pai junto.
// Tag arquivada só pode continuar se já estava; nova, não.
// A fase troca na mesma instrução que a raiz (o banco recusa separado)
async function applyTags(
  client,
  executionId,
  rootTagId,
  tagIds,
  previous,
  newPhase,
) {
  if (rootTagId) {
    const root = (
      await client.query('SELECT level, active FROM tags WHERE id = $1', [
        rootTagId,
      ])
    ).rows[0]
    if (!root) throw new TagError('rootTagId não existe')
    if (root.level !== 1) {
      throw new TagError('rootTagId precisa ser uma tag raiz (nível 1)')
    }
    if (!root.active && previous.rootTagId !== rootTagId) {
      throw new TagError('Tag arquivada não pode ser adicionada')
    }
  }

  const ids = [...new Set(tagIds)].filter((id) => id !== rootTagId)
  const found = ids.length
    ? (
        await client.query(
          `SELECT id, level, parent_id AS "parentId",
                  effective_root AS "rootId", active
           FROM tags WHERE id = ANY($1)`,
          [ids],
        )
      ).rows
    : []
  if (found.length !== ids.length) {
    throw new TagError('Uma das tags não existe')
  }

  const before = new Set(previous.tagIds)
  const closure = new Set()
  for (const tag of found) {
    if (tag.rootId !== rootTagId) {
      throw new TagError('Tag não pertence a esse contexto')
    }
    if (!tag.active && !before.has(tag.id)) {
      throw new TagError('Tag arquivada não pode ser adicionada')
    }
    closure.add(tag.id)
    if (tag.level === 3) closure.add(tag.parentId)
  }
  if (closure.size > 20) throw new TagError('No máximo 20 tags por execução')

  // Ordem exigida pelas FKs: soltar as ligações, trocar a raiz, religar
  await client.query(
    'DELETE FROM task_execution_tags WHERE task_execution_id = $1',
    [executionId],
  )
  await client.query(
    'UPDATE task_executions SET root_tag_id = $1, phase = $2 WHERE id = $3',
    [rootTagId, newPhase, executionId],
  )
  if (closure.size > 0) {
    await client.query(
      `INSERT INTO task_execution_tags
         (task_execution_id, tag_id, tag_parent_id, root_tag_id)
       SELECT $1, id, parent_id, $2 FROM tags WHERE id = ANY($3)`,
      [executionId, rootTagId, [...closure]],
    )
  }
}

executionsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `${SELECT_EXECUTION} GROUP BY e.id ORDER BY e.created_at`,
  )
  res.json(result.rows)
})

executionsRouter.post('/', async (req, res) => {
  const { error, data: execution } = validate(newExecutionSchema, req.body)
  if (error) return res.status(400).json({ error })

  // Execução + tags juntas, ou nada
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Snapshot copiado da própria tarefa, na mesma query — o cliente não manda
    const result = await client.query(
      `INSERT INTO task_executions
         (task_id, description, completed_at, task_title_at_time, task_frequency_at_time)
       SELECT id, $2, $3, title, frequency
       FROM tasks
       WHERE id = $1 AND active
       RETURNING id`,
      [execution.taskId, execution.description, execution.completedAt],
    )
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res
        .status(400)
        .json({ error: 'Tarefa não encontrada ou arquivada' })
    }
    const id = result.rows[0].id
    if (hasTags(execution)) {
      await applyTags(
        client,
        id,
        execution.rootTagId ?? null,
        execution.tagIds ?? [],
        { rootTagId: null, tagIds: [] },
        execution.phase ?? null,
      )
    } else if (execution.phase) {
      // Sem tag: o banco recusa (fase precisa de contexto)
      await setPhase(client, id, execution.phase)
    }
    if (execution.estimatedMinutes) {
      await setEstimate(client, id, execution.estimatedMinutes)
    }
    // Depois das tags: a medida sai do caminho já gravado
    if (execution.measureValues?.length) {
      await setMeasure(client, id, execution.measureValues)
    }
    const created = await findExecution(client, id)
    const timeEntries = await entriesOf(client, id)
    await client.query('COMMIT')
    res.status(201).json({ ...created, timeEntries })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err instanceof TagError || err instanceof MeasureError) {
      return res.status(400).json({ error: err.message })
    }
    if (measureConstraintError(err)) {
      return res.status(400).json({ error: 'Medida não confere com o caminho' })
    }
    if (phaseError(err)) return res.status(400).json({ error: phaseError(err) })
    if (isOpenExecutionConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    throw err
  } finally {
    client.release()
  }
})

executionsRouter.put('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Execução não encontrada' })
  }
  const { error, data: changes } = validate(executionChangesSchema, req.body)
  if (error) return res.status(400).json({ error })

  // Finalizar também fecha a sessão rodando dessa execução, e as tags (se
  // vieram) trocam junto: tudo acontece ou nada acontece. Uma transação só
  // existe dentro de uma conexão, por isso pool.connect() e não pool.query()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE task_executions
       SET description = $1, completed_at = $2
       WHERE id = $3
       RETURNING id, root_tag_id AS "rootTagId", phase`,
      [changes.description, changes.completedAt, req.params.id],
    )
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Execução não encontrada' })
    }
    if (changes.completedAt === null) {
      // Reabrir deixaria a estimativa sem âncora (o "Quando")
      const estimate = await client.query(
        'SELECT 1 FROM time_entries WHERE task_execution_id = $1 AND estimated',
        [req.params.id],
      )
      if (estimate.rowCount > 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({
          error: 'Registro com duração estimada não pode ser reaberto',
        })
      }
    }
    if (changes.completedAt !== null) {
      await client.query(
        `UPDATE time_entries
         SET ended_at = $1
         WHERE task_execution_id = $2 AND ended_at IS NULL`,
        [changes.completedAt, req.params.id],
      )
    }
    const current = result.rows[0]
    if (hasTags(changes)) {
      const previousTags = await client.query(
        'SELECT tag_id FROM task_execution_tags WHERE task_execution_id = $1',
        [req.params.id],
      )
      const rootTagId = changes.rootTagId ?? null
      // Sem phase no pedido: mantém, a não ser que a raiz troque (a fase era
      // do projeto antigo)
      const newPhase =
        changes.phase !== undefined
          ? changes.phase
          : rootTagId === current.rootTagId
            ? current.phase
            : null
      // Raiz nova: medida e treino saem ANTES (a FK da raiz não é adiável)
      if (rootTagId !== current.rootTagId) {
        await dropMeasure(client, req.params.id)
        await dropWorkout(client, req.params.id)
      }
      await applyTags(
        client,
        req.params.id,
        rootTagId,
        changes.tagIds ?? [],
        {
          rootTagId: current.rootTagId,
          tagIds: previousTags.rows.map((row) => row.tag_id),
        },
        newPhase,
      )
      // Subtag saiu sem mandar medidas: a medida dela sai junto (a FK do
      // caminho é adiável, então dá pra conferir depois do applyTags)
      if (changes.measureValues === undefined) {
        await dropMeasureIfOffPath(client, req.params.id)
      }
      if (changes.workout === undefined) {
        await dropWorkoutIfOffPath(client, req.params.id)
      }
    } else if (changes.phase !== undefined) {
      await setPhase(client, req.params.id, changes.phase)
    }
    if (changes.estimatedMinutes !== undefined) {
      await setEstimate(client, req.params.id, changes.estimatedMinutes)
    } else {
      await followCompletedAt(client, req.params.id)
    }
    if (changes.measureValues !== undefined) {
      await setMeasure(client, req.params.id, changes.measureValues)
    }
    if (changes.workout !== undefined) {
      await setWorkout(client, req.params.id, changes.workout)
    }
    const updated = {
      ...(await findExecution(client, req.params.id)),
      timeEntries: await entriesOf(client, req.params.id),
    }
    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    if (
      err instanceof TagError ||
      err instanceof MeasureError ||
      err instanceof WorkoutError
    ) {
      return res.status(400).json({ error: err.message })
    }
    // Inclui as FKs adiáveis do caminho, que só são conferidas no COMMIT
    if (measureConstraintError(err)) {
      return res.status(400).json({ error: 'Medida não confere com o caminho' })
    }
    if (workoutConstraintError(err)) {
      return res.status(400).json({ error: 'Treino não confere com o caminho' })
    }
    if (isOpenExecutionConflict(err)) {
      return res.status(409).json({ error: CONFLICT_ERROR })
    }
    if (phaseError(err)) return res.status(400).json({ error: phaseError(err) })
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

// Treino ao vivo, série a série: só o treino (o PUT do registro regravaria a
// descrição que ainda está sendo digitada). Mesmo contrato: a lista inteira
executionsRouter.put('/:id/workout', async (req, res) => {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Execução não encontrada' })
  }
  const { error, data } = validate(workoutSchema, req.body)
  if (error) return res.status(400).json({ error })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Trava a linha: dois salvamentos ao mesmo tempo esperam um o outro, em
    // vez de apagar e regravar juntos
    const locked = await client.query(
      'SELECT id FROM task_executions WHERE id = $1 FOR UPDATE',
      [req.params.id],
    )
    if (locked.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Execução não encontrada' })
    }
    await setWorkout(client, req.params.id, data.workout)
    const updated = {
      ...(await findExecution(client, req.params.id)),
      timeEntries: await entriesOf(client, req.params.id),
    }
    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    if (err instanceof WorkoutError) {
      return res.status(400).json({ error: err.message })
    }
    if (workoutConstraintError(err)) {
      return res.status(400).json({ error: 'Treino não confere com o caminho' })
    }
    throw err
  } finally {
    client.release()
  }
})
