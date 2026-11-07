// Toda rota de dados fecha sem sessão. Lê a pilha do app (backend/src/app.js):
// a trava (requireSession) vem antes de todo roteiro de dados, e antes dela só
// as rotas liberadas (/health, /login, /logout). Depois pede CADA rota de cada
// roteiro sem cookie e com cookie adulterado, com cabeçalhos válidos (JSON no
// corpo e X-StudyFlow: o 415 e o 403 vêm antes da trava), pelo proxy /api e direto
// no backend: tudo 401. Controle: com a sessão das baterias, as mesmas rotas
// passam da trava. Uso (raiz do repo):
//   node --env-file=backend/.env tests/api/rotas-fechadas-test.mjs
// BACKEND_DIR: uma cópia do backend (mutação, com o backend dela na API_PROXY_TARGET)
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'

const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const BACKEND = process.env.BACKEND_DIR ?? REAL
const DIRECT = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3333'
// Pares método + caminho nos roteiros de dados: rota nova muda este número de
// propósito (e confere que ela entrou fechada)
const EXPECTED_ROUTES = 42
const PUBLIC = ['get /health', 'post /login', 'post /logout']
const GHOST = '00000000-0000-4000-8000-000000000000'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

try {
  const { createApp, mounts } = await import(pathToFileURL(join(BACKEND, 'src', 'app.js')).href)
  const app = createApp({ passwordHash: '$argon2id$', sessionSecret: 'x'.repeat(32), trustProxy: false })
  const stack = app.router.stack
  const gate = stack.findIndex((l) => l.name === 'requireSession')
  check('a trava está na pilha', gate > 0, stack.map((l) => l.name).join(' '))
  const before = stack.slice(0, gate)
  const openRoutes = before.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m} ${l.route.path}`))
  check('antes da trava, só as rotas liberadas', JSON.stringify(openRoutes.sort()) === JSON.stringify([...PUBLIC].sort()), openRoutes.join(', '))
  check('nenhum roteiro antes da trava', !before.some((l) => l.name === 'router'), before.map((l) => l.name).join(' '))
  const routers = stack.slice(gate + 1).filter((l) => l.name === 'router')
  check(`os ${mounts.length} roteiros de dados montados depois da trava`, routers.length === mounts.length, `${routers.length}`)

  const routes = []
  for (const [base, router] of mounts) {
    for (const layer of router.stack) {
      if (!layer.route) {
        check(`roteiro ${base}: só rotas, nenhum middleware solto`, false, layer.name)
        continue
      }
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method: method.toUpperCase(), path: `${base}${layer.route.path === '/' ? '' : layer.route.path}`.replace(/:\w+/g, GHOST) })
      }
    }
  }
  routes.push({ method: 'GET', path: '/session' }, { method: 'GET', path: '/nao-existe' }, { method: 'DELETE', path: `/nao-existe/${GHOST}` })
  check(`${EXPECTED_ROUTES} rotas de dados (+ /session e duas inexistentes)`, routes.length === EXPECTED_ROUTES + 3, `${routes.length - 3}`)

  const ask = (base, { method, path }, cookie) => {
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined
    const headers = { 'X-StudyFlow': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }
    return fetch(`${base}${path}`, { method, headers, body })
  }
  const bad = 'sf_session=9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  for (const [label, base, cookie] of [['pelo proxy, sem cookie', API, null], ['direto, sem cookie', DIRECT, null], ['direto, cookie adulterado', DIRECT, bad]]) {
    const open = []
    for (const route of routes) {
      const res = await ask(base, route, cookie)
      const body = await res.json().catch(() => null)
      if (res.status !== 401 || body?.error !== 'Entre para continuar.') open.push(`${route.method} ${route.path} ${res.status}`)
    }
    check(`${label}: as ${routes.length} rotas dão 401`, open.length === 0, open.slice(0, 6).join('; '))
  }
  const health = await fetch(`${API}/health`)
  check('/health responde sem sessão', health.status === 200, String(health.status))
  const logout = await fetch(`${API}/logout`, { method: 'POST', headers: { 'X-StudyFlow': '1' } })
  check('/logout responde sem sessão (só apaga o cookie)', logout.status === 204, String(logout.status))

  // Controle: com a sessão, as mesmas rotas passam da trava (nenhum 401)
  const closed = []
  for (const route of routes.filter((r) => r.method === 'GET')) {
    const res = await apiFetch(`${API}${route.path}`)
    if (res.status === 401) closed.push(route.path)
  }
  check('controle: com a sessão, nenhum GET dá 401', closed.length === 0, closed.join(', '))
  check('controle: com a sessão, GET /tags e /session 200',
    (await apiFetch(`${API}/tags`)).status === 200 && (await apiFetch(`${API}/session`)).status === 200)
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
  process.exit()
}
