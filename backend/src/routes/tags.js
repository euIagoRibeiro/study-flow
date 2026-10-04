import { Router } from 'express'
import { pool } from '../db.js'

export const tagsRouter = Router()

// Árvore achatada: cada raiz, logo depois os filhos dela, e depois de cada
// filho os netos — ordem feita aqui, o frontend só monta. Profundidade
// fixa (3): dois LEFT JOIN bastam, sem WITH RECURSIVE
tagsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT t.id, t.name, t.parent_id AS "parentId", t.level, t.active
     FROM tags t
     LEFT JOIN tags p ON p.id = t.parent_id
     LEFT JOIN tags g ON g.id = p.parent_id
     ORDER BY
       lower(CASE t.level WHEN 1 THEN t.name WHEN 2 THEN p.name ELSE g.name END),
       lower(CASE t.level WHEN 1 THEN '' WHEN 2 THEN t.name ELSE p.name END),
       lower(CASE t.level WHEN 3 THEN t.name ELSE '' END)`,
  )
  res.json(result.rows)
})
