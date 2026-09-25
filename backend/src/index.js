import express from 'express'
import { pool } from './db.js'

const app = express()

app.get('/tasks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, frequency, active FROM tasks ORDER BY created_at',
    )
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao buscar tarefas' })
  }
})

const port = process.env.PORT ?? 3333
app.listen(port, () => console.log(`API rodando em http://localhost:${port}`))
