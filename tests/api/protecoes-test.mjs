// Proteções gerais da API (passo 2 da hospedagem, commit A2). Partes:
// 1. cabeçalhos do helmet, pelo proxy /api (também na resposta 401 da trava);
// 2. limite de corpo de 100 kB: 102400 bytes passam, 102401 dão 413 em JSON;
// 3. RATE_LIMIT_PER_MIN: só de 30 a 1500, fora disso o padrão 300 (nunca desliga);
//    a partida diz o limite em vigor;
// 4. limite geral por IP, no próprio processo com relógio falso: o pedido N+1 dá
//    429 com Retry-After, conta antes da trava, por IP só com TRUST_PROXY, volta
//    na janela nova; os 429 viram UMA linha de log por janela, com a contagem e o
//    primeiro pedido (método e rota), sem IP, query, cabeçalhos nem corpo;
// 5. log do erro 500: o erro do Postgres sai sem message, detail, where nem a
//    query string; um erro que não é do Postgres sai com a mensagem.
// Uso (raiz do repo): node --env-file=backend/.env tests/api/protecoes-test.mjs
// BACKEND_DIR: uma cópia do backend (mutação), sem mexer no de desenvolvimento
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'

if (!process.env.TEST_PASSWORD || !process.env.DATABASE_URL) {
  console.error('TEST_PASSWORD ou DATABASE_URL ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const BACKEND = process.env.BACKEND_DIR ?? REAL
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const mod = (file) => import(pathToFileURL(join(BACKEND, 'src', file)).href)
const JSONH = { 'Content-Type': 'application/json' }

const servers = []
try {
  const auth = await mod('auth.js')
  const { createApp, errorHandler } = await mod('app.js')

  // ---------- 1. helmet
  for (const [label, res] of [
    ['/health', await fetch(`${API}/health`)],
    ['401 da trava', await fetch(`${API}/tags`, { headers: { 'X-StudyFlow': '1' } })],
    ['rota com sessão', await apiFetch(`${API}/tags`)],
  ]) {
    const h = res.headers
    check(
      `helmet em ${label}: nosniff, frame, CSP e sem X-Powered-By`,
      h.get('x-content-type-options') === 'nosniff' &&
        !!h.get('x-frame-options') &&
        !!h.get('content-security-policy') &&
        h.get('x-powered-by') === null,
      [...h.keys()].join(','),
    )
  }

  // ---------- 2. limite de corpo (100 kB = 102400 bytes)
  const body = (size) => {
    const head = '{"name":"'
    const tail = '"}'
    return head + 'x'.repeat(size - head.length - tail.length) + tail
  }
  const atLimit = await apiFetch(`${API}/tags`, { method: 'POST', headers: JSONH, body: body(102400) })
  check('corpo de 102400 bytes passa do limite (a validação recusa o nome: 400)', atLimit.status === 400, String(atLimit.status))
  const over = await apiFetch(`${API}/tags`, { method: 'POST', headers: JSONH, body: body(102401) })
  const overBody = await over.json().catch(() => null)
  check('corpo de 102401 bytes: 413 em JSON "Corpo grande demais."', over.status === 413 && overBody?.error === 'Corpo grande demais.', `${over.status} ${JSON.stringify(overBody)}`)
  const tags = await (await apiFetch(`${API}/tags`)).json()
  check('nenhuma tag criada pelos corpos grandes', !tags.some((t) => /^x{100}/.test(t.name)))

  // ---------- 3. a variável
  const cfg = (value) => {
    const env = { AUTH_PASSWORD_HASH: process.env.AUTH_PASSWORD_HASH, SESSION_SECRET: 'a'.repeat(64) }
    if (value !== undefined) env.RATE_LIMIT_PER_MIN = value
    return auth.loadConfig(env).rateLimitPerMin
  }
  const cases = [[undefined, 300], ['30', 30], ['1500', 1500], ['601', 601], ['450', 450], ['29', 300], ['1501', 300], ['0', 300], ['-1', 300], ['45.5', 300], ['abc', 300], ['', 300], ['100000', 300]]
  const wrong = cases.filter(([v, want]) => cfg(v) !== want).map(([v]) => String(v))
  check('RATE_LIMIT_PER_MIN: de 30 a 1500 vale; ausente ou fora da faixa = 300', wrong.length === 0, `erradas: ${wrong.join(',')}`)
  check('o padrão de produção é 300', auth.RATE_DEFAULT === 300, String(auth.RATE_DEFAULT))
  // A partida diz o limite em vigor (backend de teste na 3336, sem nada do .env além do necessário)
  const started = async (value) => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: process.env.DATABASE_URL, PORT: '3336', AUTH_PASSWORD_HASH: process.env.AUTH_PASSWORD_HASH, SESSION_SECRET: 'a'.repeat(64) }
    if (value !== undefined) env.RATE_LIMIT_PER_MIN = value
    const child = spawn(process.execPath, ['src/index.js'], { cwd: BACKEND, env })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    const exited = new Promise((r) => child.once('exit', r))
    for (let i = 0; i < 40 && !out.includes('API rodando') && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 250))
    if (child.exitCode === null) child.kill()
    await exited
    return out.split('\n').find((l) => l.includes('API rodando')) ?? out.trim().slice(0, 160)
  }
  for (const [value, want] of [[undefined, 300], ['45', 45], ['1501', 300]]) {
    const line = await started(value)
    check(`partida com RATE_LIMIT_PER_MIN=${value ?? '(ausente)'}: o log diz ${want} pedidos por minuto`, line.includes(`limite geral: ${want} pedidos por minuto por IP`), line)
  }

  // ---------- 4. limite geral, no próprio processo (relógio falso)
  let clock = 1_000_000
  const now = () => clock
  const base = { passwordHash: process.env.AUTH_PASSWORD_HASH, sessionSecret: 'a'.repeat(64) }
  const listen = async (config) => {
    const server = createApp(config, { now }).listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    servers.push(server)
    return `http://127.0.0.1:${server.address().port}`
  }
  const statuses = async (url, n, headers = {}) => {
    const out = []
    for (let i = 0; i < n; i++) out.push((await fetch(url, { headers })).status)
    return out
  }

  let A = await listen({ ...base, trustProxy: false, rateLimitPerMin: 30 })
  const first = await statuses(`${A}/health`, 30)
  const blocked = await fetch(`${A}/health`)
  const blockedBody = await blocked.json().catch(() => null)
  check('limite 30: os 30 primeiros passam', first.every((s) => s === 200), first.join())
  check('limite 30: o 31º dá 429 em JSON', blocked.status === 429 && typeof blockedBody?.error === 'string', String(blocked.status))
  const retry = Number(blocked.headers.get('retry-after'))
  check('429 com Retry-After entre 1 e 60 s', retry >= 1 && retry <= 60, String(blocked.headers.get('retry-after')))
  check('429 também com os cabeçalhos do helmet', blocked.headers.get('x-content-type-options') === 'nosniff')
  clock += 30_000
  check('ainda na mesma janela (30 s depois): 429', (await fetch(`${A}/health`)).status === 429)
  clock += 30_000
  check('janela nova (60 s depois): passa de novo', (await fetch(`${A}/health`)).status === 200)

  clock += 60_000
  const noCookie = await statuses(`${A}/tags`, 30, { 'X-StudyFlow': '1' })
  check('pedidos sem cookie contam (30 × 401)', noCookie.every((s) => s === 401), noCookie.join())
  check('depois de 30 × 401, o 31º dá 429 (o limite vem antes da trava)', (await fetch(`${A}/health`)).status === 429)
  const loginBlocked = await fetch(`${A}/login`, { method: 'POST', headers: JSONH, body: '{"password":"x"}' })
  check('o login também está sob o limite geral (429, sem conferir a senha)', loginBlocked.status === 429, String(loginBlocked.status))

  clock += 60_000
  const forged = await statuses(`${A}/health`, 31)
  const forgedIps = []
  for (let i = 0; i < 31; i++) forgedIps.push((await fetch(`${A}/health`, { headers: { 'X-Forwarded-For': `10.9.0.${i}` } })).status)
  check('sem TRUST_PROXY, X-Forwarded-For forjado não escapa do limite', forged[30] === 429 && forgedIps.every((s) => s === 429), `${forged[30]} ${forgedIps.slice(0, 3).join()}`)

  const P = await listen({ ...base, trustProxy: 1, rateLimitPerMin: 30 })
  const ipA = await statuses(`${P}/health`, 31, { 'X-Forwarded-For': '10.1.0.1' })
  check('com TRUST_PROXY: o IP A passa 30 e para no 31º', ipA.slice(0, 30).every((s) => s === 200) && ipA[30] === 429, ipA.slice(28).join())
  const ipB = await fetch(`${P}/health`, { headers: { 'X-Forwarded-For': '10.1.0.2' } })
  check('com TRUST_PROXY: o IP B não herda o limite do A', ipB.status === 200, String(ipB.status))

  clock += 60_000
  const D = await listen({ ...base, trustProxy: false })
  const def = await statuses(`${D}/health`, 301)
  check('config sem o campo: limite 300 (o 300º passa, o 301º dá 429)', def[299] === 200 && def[300] === 429, `${def[299]} ${def[300]}`)

  // ---------- 4b. log dos 429: agregado, uma linha por janela, sem dados do pedido
  const lines = []
  const timers = []
  const limiter = auth.rateLimiter(2, now, { log: (l) => lines.push(l), schedule: (fn, ms) => timers.push({ fn, ms }) })
  const hit = (url, headers = {}) => {
    let status = 200
    const res = { set: () => res, status: (c) => ((status = c), res), json: () => res }
    limiter({ ip: '10.7.7.7', method: 'GET', originalUrl: url, headers }, res, () => {})
    return status
  }
  const MARKS = { 'X-Forwarded-For': '10.66.66.66', 'X-Marca': 'MARCA-CABECALHO', Cookie: 'sid=MARCA-COOKIE' }
  clock += 60_000
  const ok2 = [hit('/tags', MARKS), hit('/tags', MARKS)]
  check('log do 429: pedidos aceitos não deixam linha nem abrem janela', ok2.every((s) => s === 200) && lines.length === 0 && timers.length === 0, `${ok2} ${lines.length} ${timers.length}`)
  const refusedNow = [hit('/tags?q=MARCA-QUERY', MARKS), hit('/works', MARKS), hit('/works', MARKS), hit('/tags', MARKS), hit('/tags', MARKS)]
  check('log do 429: 5 recusados na janela, nenhuma linha antes de ela fechar, um agendamento de 60 s', refusedNow.every((s) => s === 429) && lines.length === 0 && timers.length === 1 && timers[0].ms === 60_000, `${refusedNow} ${lines.length} ${JSON.stringify(timers.map((t) => t.ms))}`)
  timers.shift()?.fn()
  check('log do 429: a janela fecha com UMA linha, a contagem 5 e o primeiro pedido', lines.length === 1 && /\b5 pedido/.test(lines[0]) && lines[0].includes('GET /tags'), JSON.stringify(lines))
  check('log do 429: sem query, IP, X-Forwarded-For, cabeçalho nem cookie', lines.length === 1 && !/MARCA|10\.7\.7\.7|10\.66\.66\.66/.test(lines[0]), JSON.stringify(lines))
  clock += 60_000
  hit('/a', MARKS)
  hit('/a', MARKS)
  hit('/tags\r\nFORJADO: ' + 'z'.repeat(200), MARKS)
  hit('/b', MARKS)
  check('log do 429: janela nova abre um agendamento novo', timers.length === 1 && lines.length === 1, `${timers.length} ${lines.length}`)
  timers.shift()?.fn()
  const first2 = lines[1]?.split('o primeiro: ')[1] ?? ''
  check('log do 429: nova janela, nova linha, com a contagem dela (2)', lines.length === 2 && /\b2 pedido/.test(lines[1]), JSON.stringify(lines))
  check('log do 429: o primeiro pedido sem caracteres de controle e com até 80 caracteres', first2.startsWith('GET /tagsFORJADO') && first2.length <= 80 && !/\p{Cc}/u.test(lines[1]), JSON.stringify(first2))

  // ---------- 5. log do erro 500
  const capture = (fn) => {
    const lines = []
    const original = console.error
    console.error = (...args) => lines.push(args.map((a) => (a instanceof Error ? `${a.stack}` : String(a))).join(' '))
    try {
      fn()
    } finally {
      console.error = original
    }
    return lines.join('\n')
  }
  const fakeRes = () => {
    const r = { code: 0, body: null }
    r.status = (c) => ((r.code = c), r)
    r.json = (b) => ((r.body = b), r)
    return r
  }
  const pgErr = Object.assign(new Error('duplicate key value violates unique constraint MARCA-MSG'), {
    code: '23505',
    detail: 'Key (lower(btrim(name)))=(MARCA-DETAIL) already exists.',
    where: 'MARCA-WHERE',
    constraint: 'tags_root_name_unique',
    table: 'tags',
    routine: '_bt_check_unique',
  })
  const res1 = fakeRes()
  const logged = capture(() => errorHandler(pgErr, { method: 'POST', originalUrl: '/tags?q=MARCA-QUERY' }, res1, () => {}))
  check('log do Postgres sem message, detail, where nem query string', !/MARCA/.test(logged), logged.slice(0, 200))
  check('log do Postgres com rota, code, constraint, table e routine', ['POST /tags', 'code=23505', 'constraint=tags_root_name_unique', 'table=tags', 'routine=_bt_check_unique'].every((s) => logged.includes(s)), logged.slice(0, 200))
  check('log do Postgres com a pilha (onde foi)', /\n\s+at /.test(logged), logged.slice(0, 200))
  check('resposta do 500: "Erro interno", sem nada do erro', res1.code === 500 && res1.body?.error === 'Erro interno' && !/MARCA/.test(JSON.stringify(res1.body)))
  const res2 = fakeRes()
  const loggedJs = capture(() => errorHandler(new TypeError('falha-de-codigo'), { method: 'GET', originalUrl: '/works' }, res2, () => {}))
  check('erro que não é do Postgres: o log traz a mensagem', loggedJs.includes('falha-de-codigo') && loggedJs.includes('GET /works'), loggedJs.slice(0, 160))
  const res3 = fakeRes()
  const quiet = capture(() => errorHandler(Object.assign(new Error('x'), { status: 400 }), { method: 'GET', originalUrl: '/x' }, res3, () => {}))
  check('400 não vai para o log', quiet === '' && res3.code === 400 && res3.body?.error === 'Requisição inválida')
} catch (err) {
  check('a bateria rodou até o fim', false, err.stack ?? String(err))
} finally {
  for (const s of servers) await new Promise((r) => s.close(r))
}

const passed = results.filter(Boolean).length
console.log(`\n${passed} de ${results.length}`)
process.exitCode = passed === results.length ? 0 : 1
process.exit()
