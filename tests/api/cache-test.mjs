// Cache-Control (hospedagem, item 2): toda resposta da API sai com "private,
// no-cache" (CDN e proxy não guardam; o navegador confere antes de reusar), e
// /login, /session e /logout com "no-store". O cabeçalho vem logo depois do
// helmet: as recusas (429, 415, 403, 413, 401) também o levam. Num app no próprio
// processo (createApp, porta livre), com a enumeração comum de tests/rotas.mjs:
// todas as rotas sem sessão e as GET com sessão; e pelo proxy /api do dev, pra
// conferir que o proxy entrega o cabeçalho. Uso (raiz do repo):
//   node --env-file=backend/.env tests/api/cache-test.mjs
// BACKEND_DIR: uma cópia do backend (mutação), sem mexer no de desenvolvimento
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { API } from '../config.mjs'
import { ask, dataRoutes, EXTRAS } from '../rotas.mjs'
import { apiFetch } from '../sessao.mjs'

if (!process.env.TEST_PASSWORD || !process.env.AUTH_PASSWORD_HASH || !process.env.DATABASE_URL) {
  console.error('TEST_PASSWORD, AUTH_PASSWORD_HASH ou DATABASE_URL ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const BACKEND = process.env.BACKEND_DIR ?? REAL
const PRIVATE = 'private, no-cache'
const NO_STORE = 'no-store'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const mod = (file) => import(pathToFileURL(join(BACKEND, 'src', file)).href)
const cc = (res) => res.headers.get('cache-control')
const JSONH = { 'Content-Type': 'application/json', 'X-StudyFlow': '1' }

const servers = []
async function serve(app) {
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

try {
  const auth = await mod('auth.js')
  const { createApp, mounts } = await mod('app.js')
  const secret = 'c'.repeat(32)
  const config = { passwordHash: process.env.AUTH_PASSWORD_HASH, sessionSecret: secret, trustProxy: false, rateLimitPerMin: 1500 }
  const app = createApp(config, { loginUnitMs: 1 })
  const base = await serve(app)
  const cookie = `${auth.COOKIE}=${auth.newSession(secret)}`

  // ---- posição na pilha: logo depois do helmet, antes de tudo que responde
  const names = app.router.stack.map((l) => l.name)
  const at = (n) => names.indexOf(n)
  check('cacheControl logo depois do helmet', at('cacheControl') === at('helmetMiddleware') + 1, names.join(' '))
  check('cacheControl antes do limite, do 415, do 403 e da trava',
    ['rateLimit', 'requireJson', 'requireDeleteHeader', 'requireSession'].every((n) => at(n) > at('cacheControl')), names.join(' '))

  // ---- a enumeração comum, sem sessão (todas 401) e com sessão (as GET)
  const { routes, soltos } = dataRoutes(mounts)
  check('enumeração: rotas achadas, nenhum middleware solto', routes.length > 0 && soltos.length === 0, soltos.join(', '))
  const all = [...routes, ...EXTRAS]
  const expected = (path) => (path === '/session' ? NO_STORE : PRIVATE)
  const wrong = []
  for (const route of all) {
    const res = await ask(base, route, null)
    if (res.status !== 401 || cc(res) !== expected(route.path)) wrong.push(`${route.method} ${route.path} ${res.status} ${cc(res)}`)
  }
  check(`sem sessão: as ${all.length} rotas dão 401 com o cabeçalho (/session no-store, o resto private, no-cache)`,
    wrong.length === 0, wrong.slice(0, 5).join('; '))
  const wrongIn = []
  const gets = all.filter((r) => r.method === 'GET')
  for (const route of gets) {
    const res = await ask(base, route, cookie)
    if (res.status === 401 || cc(res) !== expected(route.path)) wrongIn.push(`${route.path} ${res.status} ${cc(res)}`)
  }
  check(`com sessão: os ${gets.length} GET (200, 400, 404) com o cabeçalho`, wrongIn.length === 0, wrongIn.slice(0, 5).join('; '))
  const tags = await ask(base, { method: 'GET', path: '/tags' }, cookie)
  check('com sessão: GET /tags 200 e private, no-cache', tags.status === 200 && cc(tags) === PRIVATE, `${tags.status} ${cc(tags)}`)

  // ---- rotas liberadas
  const health = await fetch(`${base}/health`)
  check('/health: private, no-cache', health.status === 200 && cc(health) === PRIVATE, `${health.status} ${cc(health)}`)
  const login = (path, password) => fetch(`${base}${path}`, { method: 'POST', headers: JSONH, body: JSON.stringify({ password }) })
  const bad = await login('/login', 'senha-errada-do-teste')
  check('/login errado (401): no-store', bad.status === 401 && cc(bad) === NO_STORE, `${bad.status} ${cc(bad)}`)
  const good = await login('/login', process.env.TEST_PASSWORD)
  check('/login certo (204 com o cookie): no-store',
    good.status === 204 && cc(good) === NO_STORE && !!good.headers.get('set-cookie'), `${good.status} ${cc(good)}`)
  const session = await ask(base, { method: 'GET', path: '/session' }, cookie)
  check('/session com sessão (200): no-store', session.status === 200 && cc(session) === NO_STORE, `${session.status} ${cc(session)}`)
  const logout = await fetch(`${base}/logout`, { method: 'POST', headers: { 'X-StudyFlow': '1' } })
  check('/logout (204): no-store', logout.status === 204 && cc(logout) === NO_STORE, `${logout.status} ${cc(logout)}`)
  // O Express aceita maiúsculas e a barra no fim como a mesma rota
  const upper = await login('/LOGIN', 'senha-errada-do-teste')
  check('/LOGIN (o Express trata como /login): no-store', upper.status === 401 && cc(upper) === NO_STORE, `${upper.status} ${cc(upper)}`)
  const slash = await ask(base, { method: 'GET', path: '/session/' }, cookie)
  check('/session/ (barra no fim): no-store', slash.status === 200 && cc(slash) === NO_STORE, `${slash.status} ${cc(slash)}`)
  const out = await fetch(`${base}/Logout/`, { method: 'POST', headers: { 'X-StudyFlow': '1' } })
  check('/Logout/: no-store', out.status === 204 && cc(out) === NO_STORE, `${out.status} ${cc(out)}`)

  // ---- recusas antes da trava
  const r415 = await fetch(`${base}/tags`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: 'x' })
  check('415 (corpo que não é JSON): private, no-cache', r415.status === 415 && cc(r415) === PRIVATE, `${r415.status} ${cc(r415)}`)
  const r403 = await fetch(`${base}/tags/${EXTRAS[2].path.split('/').at(-1)}`, { method: 'DELETE', headers: { Cookie: cookie } })
  check('403 (DELETE sem X-StudyFlow): private, no-cache', r403.status === 403 && cc(r403) === PRIVATE, `${r403.status} ${cc(r403)}`)
  const r413 = await fetch(`${base}/tags`, { method: 'POST', headers: { ...JSONH, Cookie: cookie }, body: `{"name":"${'x'.repeat(110000)}"}` })
  check('413 (corpo grande, pelo errorHandler): private, no-cache', r413.status === 413 && cc(r413) === PRIVATE, `${r413.status} ${cc(r413)}`)
  const r413login = await fetch(`${base}/login`, { method: 'POST', headers: JSONH, body: `{"password":"${'x'.repeat(110000)}"}` })
  check('413 no /login: no-store', r413login.status === 413 && cc(r413login) === NO_STORE, `${r413login.status} ${cc(r413login)}`)

  // ---- 429: outro app com o limite baixo (o config vai direto, sem a faixa do loadConfig)
  const tight = await serve(createApp({ ...config, rateLimitPerMin: 30 }, { loginUnitMs: 1 }))
  let last
  for (let i = 0; i < 31; i++) last = await fetch(`${tight}/health`)
  check('429 (limite geral): private, no-cache', last.status === 429 && cc(last) === PRIVATE, `${last.status} ${cc(last)}`)
  const tightLogin = await fetch(`${tight}/login`, { method: 'POST', headers: JSONH, body: '{}' })
  check('429 no /login: no-store', tightLogin.status === 429 && cc(tightLogin) === NO_STORE, `${tightLogin.status} ${cc(tightLogin)}`)

  // ---- pelo proxy /api do dev (o backend de desenvolvimento, não a cópia)
  const viaHealth = await fetch(`${API}/health`)
  const viaTags = await apiFetch(`${API}/tags`)
  const viaSession = await apiFetch(`${API}/session`)
  const viaClosed = await fetch(`${API}/tags`, { headers: { 'X-StudyFlow': '1' } })
  check('pelo proxy: /health e /tags private, no-cache; /session no-store; 401 private, no-cache',
    cc(viaHealth) === PRIVATE && cc(viaTags) === PRIVATE && cc(viaSession) === NO_STORE && viaClosed.status === 401 && cc(viaClosed) === PRIVATE,
    `${cc(viaHealth)} | ${cc(viaTags)} | ${cc(viaSession)} | ${viaClosed.status} ${cc(viaClosed)}`)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  for (const s of servers) s.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
  process.exit()
}
