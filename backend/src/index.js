import cors from 'cors'
import express from 'express'
import { executionsRouter } from './routes/executions.js'
import { tasksRouter } from './routes/tasks.js'

// Sem origem configurada, o cors() liberaria qualquer site ('*')
if (!process.env.CORS_ORIGIN) {
  throw new Error('CORS_ORIGIN não definida no .env')
}

const app = express()

app.use(cors({ origin: process.env.CORS_ORIGIN }))
app.use(express.json())
app.use('/tasks', tasksRouter)
app.use('/executions', executionsRouter)

// Os 4 parâmetros são obrigatórios: é pela contagem que o Express
// reconhece um middleware de erro
app.use((err, req, res, next) => {
  const status = err.status ?? 500
  if (status >= 500) console.error(err)
  res
    .status(status)
    .json({ error: status >= 500 ? 'Erro interno' : 'Requisição inválida' })
})

const port = process.env.PORT ?? 3333
app.listen(port, () => console.log(`API rodando em http://localhost:${port}`))
