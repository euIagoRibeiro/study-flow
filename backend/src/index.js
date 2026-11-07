import express from 'express'
import { dashboardRouter } from './routes/dashboard.js'
import { executionsRouter } from './routes/executions.js'
import { exercisesRouter } from './routes/exercises.js'
import { measureKindsRouter, measuresRouter } from './routes/measures.js'
import {
  selectionOptionsRouter,
  selectionsRouter,
} from './routes/selections.js'
import { tagsRouter } from './routes/tags.js'
import { tasksRouter } from './routes/tasks.js'
import { timeEntriesRouter } from './routes/timeEntries.js'
import { worksRouter } from './routes/works.js'

// Sem CORS: o site chama a API pela mesma origem (/api, o proxy do Vite em dev
// e o da Vercel na hospedagem), e uma página de outra origem não lê as respostas
const app = express()

app.use(express.json())
app.use('/tasks', tasksRouter)
app.use('/executions', executionsRouter)
app.use('/time-entries', timeEntriesRouter)
app.use('/tags', tagsRouter)
app.use('/measures', measuresRouter)
app.use('/measure-kinds', measureKindsRouter)
app.use('/exercises', exercisesRouter)
app.use('/selections', selectionsRouter)
app.use('/selection-options', selectionOptionsRouter)
app.use('/works', worksRouter)
app.use('/dashboard', dashboardRouter)

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
// Só na própria máquina por padrão: a API não tem login, e sem host o Node
// escutaria em todas as interfaces (a rede Wi-Fi inclusive). HOST sobrescreve
const host = process.env.HOST ?? '127.0.0.1'
app.listen(port, host, () =>
  console.log(`API rodando em http://${host}:${port}`),
)
