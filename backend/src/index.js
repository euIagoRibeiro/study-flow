import express from 'express'
import { tasksRouter } from './routes/tasks.js'

const app = express()

app.use(express.json())
app.use('/tasks', tasksRouter)

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
