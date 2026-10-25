import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { isoDateTime, isUuid, validate } from '../validation.js'

// Dashboard v1: tempo dedicado (somado das sessões, estimadas inclusive;
// sobrepostas somam de propósito). Uma rota por pergunta, cada SQL com a sua
// regra de contagem à vista. Consultas prototipadas no D-0
// (tests/banco/dashboard-cases.sql), com a conta à mão
export const dashboardRouter = Router()

const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000

// O período é [de, ate), em instantes: quem calcula a semana ou o mês é a
// tela, no fuso dela. O "até" é de verdade ("como estava até tal hora")
const periodSchema = z
  .object({
    de: isoDateTime(
      'de precisa ser uma data ISO com fuso (ex.: 2025-03-24T00:00:00-03:00)',
    ),
    ate: isoDateTime(
      'ate precisa ser uma data ISO com fuso (ex.: 2025-03-31T00:00:00-03:00)',
    ),
    fuso: z
      .string('fuso é obrigatório (ex.: America/Sao_Paulo)')
      .min(1, 'fuso é obrigatório (ex.: America/Sao_Paulo)'),
  })
  .refine((p) => p.de < p.ate, 'de precisa ser antes de ate')
  .refine(
    (p) => new Date(p.ate) - new Date(p.de) <= ONE_YEAR_MS,
    'O intervalo pode ter no máximo 1 ano',
  )

const contextSchema = z.object({
  contexto: z
    .string('contexto é obrigatório (o id de um contexto)')
    .refine(isUuid, 'contexto precisa ser um uuid'),
})

const periodBySchema = z.object({
  por: z.enum(['dia', 'semana'], 'por precisa ser dia ou semana'),
})
const unitOf = { dia: 'day', semana: 'week' }

// Os nomes que o Postgres conhece: validar contra eles, não só pelo formato
let zones = null
async function knownZone(name) {
  zones ??= new Set(
    (await pool.query('SELECT name FROM pg_timezone_names')).rows.map(
      (r) => r.name,
    ),
  )
  return zones.has(name)
}

// Valida o período (e o fuso) de qualquer rota; responde 400 sozinho
async function readPeriod(req, res) {
  const { error, data } = validate(periodSchema, req.query)
  if (error) {
    res.status(400).json({ error })
    return null
  }
  if (!(await knownZone(data.fuso))) {
    res.status(400).json({ error: `Fuso desconhecido: ${data.fuso}` })
    return null
  }
  return data
}

// O contexto (raiz) das rotas de detalhe; 404 se não existe, 400 se não é raiz
async function readContext(req, res) {
  const { error, data } = validate(contextSchema, req.query)
  if (error) {
    res.status(400).json({ error })
    return null
  }
  const found = await pool.query(
    'SELECT id, level, tracks_phase AS "tracksPhase" FROM tags WHERE id = $1',
    [data.contexto],
  )
  if (found.rowCount === 0) {
    res.status(404).json({ error: 'Contexto não encontrado' })
    return null
  }
  if (found.rows[0].level !== 1) {
    res
      .status(400)
      .json({ error: 'contexto precisa ser uma tag de nível 1 (um contexto)' })
    return null
  }
  return found.rows[0]
}

// Recorte comum ($1 = de, $2 = ate): só o pedaço de cada sessão dentro do
// período. A rodando conta até now(), e o LEAST(…, ate) a limita ao "até"
const RECORTE = `recorte AS (
    SELECT t.id AS sessao, t.task_execution_id AS execucao, t.started_at,
           GREATEST(t.started_at, $1::timestamptz) AS ini,
           LEAST(COALESCE(t.ended_at, now()), $2::timestamptz) AS fim,
           t.ended_at IS NULL AS rodando
    FROM time_entries t
    WHERE t.started_at < $2::timestamptz
      AND COALESCE(t.ended_at, now()) > $1::timestamptz
  )`
const seconds = (interval) => `round(extract(epoch FROM ${interval}))::int`

// Total = soma dos itens (fecha sempre, sem diferença de arredondamento)
const total = (items) => items.reduce((sum, item) => sum + item.seconds, 0)

// Por contexto: EXATO (uma raiz por registro; cada sessão é de um registro
// só). tagId null = "(sem tag)". Leva junto as sessões rodando (o aviso do
// cronômetro esquecido) e se há sobreposição (a nota "em paralelo")
dashboardRouter.get('/tempo-por-contexto', async (req, res) => {
  const period = await readPeriod(req, res)
  if (!period) return
  const params = [period.de, period.ate]
  const [items, running, overlap] = await Promise.all([
    pool.query(
      `WITH ${RECORTE}
       SELECT e.root_tag_id AS "tagId", ${seconds('sum(r.fim - r.ini)')} AS seconds
       FROM recorte r JOIN task_executions e ON e.id = r.execucao
       GROUP BY e.root_tag_id
       ORDER BY seconds DESC`,
      params,
    ),
    // "rodando há": desde o início dela, até o "até" (ou agora)
    pool.query(
      `WITH ${RECORTE}
       SELECT r.sessao AS "timeEntryId", r.execucao AS "executionId",
              e.task_title_at_time AS "taskTitle", r.started_at AS "startedAt",
              ${seconds('r.fim - r.started_at')} AS seconds
       FROM recorte r JOIN task_executions e ON e.id = r.execucao
       WHERE r.rodando`,
      params,
    ),
    pool.query(
      `WITH ${RECORTE}
       SELECT EXISTS (
         SELECT 1 FROM recorte a JOIN recorte b
           ON a.sessao < b.sessao AND a.ini < b.fim AND b.ini < a.fim
       ) AS overlap`,
      params,
    ),
  ])
  res.json({
    totalSeconds: total(items.rows),
    overlap: overlap.rows[0].overlap,
    running: running.rows,
    items: items.rows,
  })
})

// Por subtag (nível 2) dentro de um contexto. A mesma sessão chega por duas
// ligações quando o caminho tem nível 3 (o fechamento traz o pai), e um
// registro antigo pode ter dois temas: DISTINCT por sessão e subtag.
// tagId null = "(sem subtag)"
dashboardRouter.get('/tempo-por-subtag', async (req, res) => {
  const period = await readPeriod(req, res)
  if (!period) return
  const context = await readContext(req, res)
  if (!context) return
  const items = await pool.query(
    `WITH ${RECORTE},
     r AS (
       SELECT r.* FROM recorte r
       JOIN task_executions e ON e.id = r.execucao AND e.root_tag_id = $3
     ),
     por_sessao AS (
       SELECT DISTINCT r.sessao, r.ini, r.fim,
              CASE WHEN t.level = 2 THEN t.id ELSE t.parent_id END AS subtag
       FROM r
       JOIN task_execution_tags et ON et.task_execution_id = r.execucao
       JOIN tags t ON t.id = et.tag_id
       UNION ALL
       SELECT r.sessao, r.ini, r.fim, NULL FROM r
       WHERE NOT EXISTS (
         SELECT 1 FROM task_execution_tags et WHERE et.task_execution_id = r.execucao
       )
     )
     SELECT subtag AS "tagId", ${seconds('sum(fim - ini)')} AS seconds
     FROM por_sessao GROUP BY subtag ORDER BY seconds DESC`,
    [period.de, period.ate, context.id],
  )
  res.json({ items: items.rows })
})

// Por fase, só em contexto que usa fases: EXATO (uma fase por registro).
// phase null = "(sem fase)"
dashboardRouter.get('/tempo-por-fase', async (req, res) => {
  const period = await readPeriod(req, res)
  if (!period) return
  const context = await readContext(req, res)
  if (!context) return
  if (!context.tracksPhase) {
    return res.status(400).json({ error: 'Esse contexto não usa fases' })
  }
  const items = await pool.query(
    `WITH ${RECORTE}
     SELECT e.phase AS phase, ${seconds('sum(r.fim - r.ini)')} AS seconds
     FROM recorte r
     JOIN task_executions e ON e.id = r.execucao AND e.root_tag_id = $3
     GROUP BY e.phase ORDER BY seconds DESC`,
    [period.de, period.ate, context.id],
  )
  res.json({ items: items.rows })
})

// Por período: faixas de 1 dia ou 1 semana (segunda) NO FUSO pedido, cada
// sessão dividida entre as faixas que cruza. Faixa sem sessão vem do LEFT
// JOIN com r.* nulo, e LEAST/GREATEST IGNORAM NULL (LEAST(NULL, f.fim) =
// f.fim): sem o FILTER, dia vazio daria o dia inteiro (achado no D-0)
dashboardRouter.get('/tempo-por-periodo', async (req, res) => {
  const period = await readPeriod(req, res)
  if (!period) return
  const { error, data } = validate(periodBySchema, req.query)
  if (error) return res.status(400).json({ error })
  const items = await pool.query(
    `WITH ${RECORTE},
     faixas AS (
       SELECT f::date AS inicio,
              f AT TIME ZONE $3::text AS ini,
              (f + ('1 ' || $4::text)::interval) AT TIME ZONE $3::text AS fim
       FROM generate_series(
         date_trunc($4::text, $1::timestamptz AT TIME ZONE $3::text),
         $2::timestamptz AT TIME ZONE $3::text - interval '1 microsecond',
         ('1 ' || $4::text)::interval) f
     )
     SELECT to_char(f.inicio, 'YYYY-MM-DD') AS start,
            COALESCE(${seconds(
              'sum(LEAST(r.fim, f.fim) - GREATEST(r.ini, f.ini)) FILTER (WHERE r.sessao IS NOT NULL)',
            )}, 0) AS seconds
     FROM faixas f
     LEFT JOIN recorte r ON r.ini < f.fim AND r.fim > f.ini
     GROUP BY f.inicio ORDER BY f.inicio`,
    [period.de, period.ate, period.fuso, unitOf[data.por]],
  )
  res.json({ items: items.rows })
})
