// Timeouts do servidor HTTP da API (a borda do Render reaproveita conexões: o servidor tem que segurá-las mais que ela).
// Sem rede nem banco: confere o módulo puro, um http.Server de verdade (sem escutar e escutando) e, por TEXTO, que o index.js
// chama applyServerTimeouts sobre o retorno do listen (o index.js sobe a API ao ser importado, então não dá pra rodá-lo aqui).
// Uso (raiz do repo): node tests/api/server-timeouts-test.mjs
// BACKEND_DIR: uma cópia do backend com src/serverTimeouts.js e src/index.js (mutação), sem mexer no de desenvolvimento
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const BACKEND = process.env.BACKEND_DIR ?? REAL
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

try {
  const { KEEP_ALIVE_MS, HEADERS_MS, applyServerTimeouts } = await import(pathToFileURL(join(BACKEND, 'src', 'serverTimeouts.js')).href)
  check('keepAliveTimeout de 120000 ms (o do tutorial do Render)', KEEP_ALIVE_MS === 120000, KEEP_ALIVE_MS)
  check('headersTimeout de 121000 ms', HEADERS_MS === 121000, HEADERS_MS)
  check('headersTimeout maior que keepAliveTimeout', HEADERS_MS > KEEP_ALIVE_MS, `${HEADERS_MS} x ${KEEP_ALIVE_MS}`)

  const plain = {}
  const back = applyServerTimeouts(plain)
  check('objeto simples: os dois valores atribuídos e o mesmo objeto devolvido', back === plain && plain.keepAliveTimeout === KEEP_ALIVE_MS && plain.headersTimeout === HEADERS_MS, JSON.stringify(plain))

  const server = http.createServer((req, res) => res.end('ok'))
  const before = [server.keepAliveTimeout, server.headersTimeout]
  check('http.Server de verdade: o padrão do Node muda (antes não era o nosso)', before[0] !== KEEP_ALIVE_MS && before[1] !== HEADERS_MS, before.join('/'))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const same = applyServerTimeouts(server)
  check('http.Server escutando: valores aplicados depois do listen e o mesmo servidor devolvido', same === server && server.keepAliveTimeout === KEEP_ALIVE_MS && server.headersTimeout === HEADERS_MS, `${server.keepAliveTimeout}/${server.headersTimeout}`)
  await new Promise((done) => server.close(done))

  // O index.js: aplica sobre o retorno do listen, uma vez, e não mexe nos timeouts por conta própria
  const index = readFileSync(join(BACKEND, 'src', 'index.js'), 'utf8')
  const name = /const (\w+) = createApp\(config\)\.listen\(/.exec(index)?.[1]
  check('index.js guarda o retorno de createApp(config).listen(...)', !!name)
  const calls = [...index.matchAll(/applyServerTimeouts\(([^)]*)\)/g)].map((m) => m[1])
  check('index.js importa applyServerTimeouts de ./serverTimeouts.js', /import \{ applyServerTimeouts \} from '\.\/serverTimeouts\.js'/.test(index))
  check('index.js chama applyServerTimeouts exatamente uma vez, sobre o retorno do listen', calls.length === 1 && calls[0] === name, JSON.stringify(calls))
  check('index.js não atribui os timeouts por conta própria', !/keepAliveTimeout|headersTimeout/.test(index))
} catch (err) {
  check('a bateria rodou até o fim', false, err.stack ?? String(err))
}

const passed = results.filter(Boolean).length
console.log(`\n${passed} de ${results.length}`)
process.exitCode = passed === results.length && passed > 0 ? 0 : 1
