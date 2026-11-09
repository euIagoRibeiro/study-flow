// Enumeração das rotas da API, comum às baterias que pedem TODAS (rotas-fechadas,
// cache): cada par método + caminho dos roteiros de dados de backend/src/app.js
// (os :parâmetros trocados por um uuid que não existe), mais /session e duas rotas
// que não existem
export const GHOST = '00000000-0000-4000-8000-000000000000'
export const EXTRAS = [
  { method: 'GET', path: '/session' },
  { method: 'GET', path: '/nao-existe' },
  { method: 'DELETE', path: `/nao-existe/${GHOST}` },
]

// soltos: middlewares fora de rota dentro de um roteiro (nenhum é esperado)
export function dataRoutes(mounts) {
  const routes = []
  const soltos = []
  for (const [base, router] of mounts) {
    for (const layer of router.stack) {
      if (!layer.route) {
        soltos.push(`${base}: ${layer.name}`)
        continue
      }
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({
          method: method.toUpperCase(),
          path: `${base}${layer.route.path === '/' ? '' : layer.route.path}`.replace(/:\w+/g, GHOST),
        })
      }
    }
  }
  return { routes, soltos }
}

// Pedido com cabeçalhos válidos (JSON no corpo e X-StudyFlow): o 415 e o 403
// vêm antes da trava
export function ask(base, { method, path }, cookie) {
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined
  const headers = { 'X-StudyFlow': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }
  return fetch(`${base}${path}`, { method, headers, body })
}
