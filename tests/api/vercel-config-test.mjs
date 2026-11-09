// frontend/vercel.json (hospedagem): só o fallback da SPA. A reescrita /api pro
// Render mora no PAINEL da Vercel (Routing Rules), fora do git, pra o endereço não
// entrar no repositório público (CLAUDE.md, "Hospedagem"): esta bateria confere o
// fallback e GUARDA que nenhum destino externo nem o endereço do Render entrem no
// arquivo. Sem Vercel nem rede: o padrão "/:path(<regex>)" vira a regex que o casa
// (a forma do lookahead é a da documentação da Vercel, "/:path((?!uk/).*)").
// Arquivos estáticos ganham das reescritas na Vercel ("precedence is given to the
// filesystem prior to rewrites"), mas um /assets/ que não existe não pode virar
// index.html. Uso (raiz do repo): node tests/api/vercel-config-test.mjs
// VERCEL_JSON: uma cópia do arquivo (mutação)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = process.env.VERCEL_JSON ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'vercel.json')
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

try {
  const raw = readFileSync(FILE, 'utf8')
  const config = JSON.parse(raw)
  const { $schema, ...rest } = config
  check('$schema da Vercel', $schema === 'https://openapi.vercel.sh/vercel.json', String($schema))

  // ---- guarda: o endereço do Render e qualquer destino externo ficam fora do arquivo
  const body = JSON.stringify(rest)
  check('nenhum endereço externo no arquivo (http:, https:, //)', !/https?:|\/\//i.test(body), body.slice(0, 200))
  check('nenhum "onrender" no arquivo', !/onrender/i.test(raw))
  check('só a chave rewrites (nada de routes, redirects, headers)', JSON.stringify(Object.keys(rest)) === '["rewrites"]',
    Object.keys(rest).join(','))

  // ---- o fallback
  const rewrites = rest.rewrites ?? []
  check('uma reescrita só (o fallback da SPA)', rewrites.length === 1, `${rewrites.length}`)
  const [fallback] = rewrites
  check('destino /index.html', fallback?.destination === '/index.html', fallback?.destination)
  const m = /^\/:path\((.*)\)$/.exec(fallback?.source ?? '')
  check('source no formato /:path(<regex>)', !!m, fallback?.source)
  const re = new RegExp(`^/(${m?.[1] ?? '$^'})$`)
  const hits = (path) => re.test(path.split('?')[0])
  for (const path of ['/', '/historico', '/painel?periodo=mes&inicio=2026-11-01', '/tags', '/executar?tarefa=x', '/apiario', '/api-docs', '/assetsx']) {
    check(`${path} vai pro index.html`, hits(path))
  }
  for (const path of ['/api', '/api/', '/api/tags', '/api/dashboard/tempo-por-contexto?de=1', '/assets/index-abc123.js', '/assets/']) {
    check(`${path} NÃO cai no fallback`, !hits(path))
  }
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
