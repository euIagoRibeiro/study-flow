import express from 'express'
import helmet from 'helmet'
import {
  checkPassword,
  clearedCookie,
  COOKIE,
  loginLimiter,
  newSession,
  rateLimiter,
  readCookie,
  sessionCookie,
  validSession,
} from './auth.js'
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

// Toda rota de dados mora aqui, montada DEPOIS da trava
// (tests/api/rotas-fechadas-test.mjs percorre esta lista)
export const mounts = [
  ['/tasks', tasksRouter],
  ['/executions', executionsRouter],
  ['/time-entries', timeEntriesRouter],
  ['/tags', tagsRouter],
  ['/measures', measuresRouter],
  ['/measure-kinds', measureKindsRouter],
  ['/exercises', exercisesRouter],
  ['/selections', selectionsRouter],
  ['/selection-options', selectionOptionsRouter],
  ['/works', worksRouter],
  ['/dashboard', dashboardRouter],
]

const hasBody = (req) =>
  req.headers['transfer-encoding'] !== undefined ||
  Number(req.headers['content-length'] ?? 0) > 0

const isPostgres = (err) =>
  typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)

// Erro do Postgres sem message, detail nem where: eles trazem valores da linha
// (nome, descrição). Fica o que diz onde foi, não o que estava gravado
export function errorHandler(err, req, res, next) {
  const status = err.status ?? 500
  if (status >= 500) {
    const where = `${req.method} ${req.originalUrl.split('?')[0]}`
    if (isPostgres(err)) {
      const fields = ['code', 'constraint', 'table', 'column', 'routine']
        .filter((k) => err[k])
        .map((k) => `${k}=${err[k]}`)
        .join(' ')
      const stack = (err.stack ?? '').split('\n').slice(1).join('\n')
      console.error(`Erro 500 em ${where}: Postgres ${fields}\n${stack}`)
    } else {
      console.error(`Erro 500 em ${where}:`, err)
    }
  }
  const message =
    status >= 500
      ? 'Erro interno'
      : status === 413
        ? 'Corpo grande demais.'
        : 'Requisição inválida'
  res.status(status).json({ error: message })
}

// Sem CORS: o site chama a API pela mesma origem (/api, o proxy do Vite em dev
// e o da Vercel na hospedagem), e uma página de outra origem não lê as respostas.
// Ordem: cabeçalhos de segurança, cache, limite geral, cabeçalhos (415, 403),
// corpo, rotas liberadas, trava, dados, erro

// Toda resposta: private (CDN e proxy não guardam) e no-cache (o navegador confere
// antes de reusar). Entrar, sair e a sessão nem ficam guardados (no-store). O
// Express aceita /LOGIN e /login/ como /login: a comparação também
const NO_STORE = new Set(['/login', '/session', '/logout'])
function cacheControl(req, res, next) {
  const path = req.path.toLowerCase().replace(/\/+$/, '')
  res.set(
    'Cache-Control',
    NO_STORE.has(path) ? 'no-store' : 'private, no-cache',
  )
  next()
}

export function createApp(config, { loginUnitMs, now } = {}) {
  const app = express()
  const limiter = loginLimiter({ unitMs: loginUnitMs })
  app.set('trust proxy', config.trustProxy)
  app.use(helmet())
  // Antes de tudo que responde: os 429, 415, 403 e 401 também levam o cabeçalho
  app.use(cacheControl)
  // Antes da trava: pedidos sem cookie também contam
  app.use(rateLimiter(config.rateLimitPerMin, now))

  // Um formulário de outra origem só manda corpo que não é JSON sem preflight
  app.use(function requireJson(req, res, next) {
    if (
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      hasBody(req) &&
      !req.is('application/json')
    ) {
      return res.status(415).json({ error: 'Mande o corpo em JSON.' })
    }
    next()
  })
  // DELETE não tem corpo: o cabeçalho próprio exige um pedido feito por script da
  // mesma origem (de outra origem, ele pediria preflight, que a API não aceita)
  app.use(function requireDeleteHeader(req, res, next) {
    if (req.method === 'DELETE' && req.get('X-StudyFlow') === undefined) {
      return res.status(403).json({ error: 'Pedido recusado.' })
    }
    next()
  })
  app.use(express.json({ limit: '100kb' }))

  app.get('/health', (req, res) => res.json({ ok: true }))
  app.post('/login', async (req, res) => {
    const delay = limiter.delayFor(req.ip)
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    const password =
      typeof req.body?.password === 'string' ? req.body.password : ''
    if (!(await checkPassword(config.passwordHash, password))) {
      limiter.failed(req.ip)
      return res.status(401).json({ error: 'Senha incorreta.' })
    }
    limiter.succeeded(req.ip)
    res.set('Set-Cookie', sessionCookie(newSession(config.sessionSecret)))
    res.status(204).end()
  })
  app.post('/logout', (req, res) => {
    res.set('Set-Cookie', clearedCookie())
    res.status(204).end()
  })

  app.use(function requireSession(req, res, next) {
    if (
      validSession(config.sessionSecret, readCookie(req.headers.cookie, COOKIE))
    ) {
      return next()
    }
    res.status(401).json({ error: 'Entre para continuar.' })
  })

  app.get('/session', (req, res) => res.json({ ok: true }))
  for (const [path, router] of mounts) app.use(path, router)

  // Os 4 parâmetros do errorHandler são obrigatórios: é pela contagem que o
  // Express reconhece um middleware de erro
  app.use(errorHandler)
  return app
}
