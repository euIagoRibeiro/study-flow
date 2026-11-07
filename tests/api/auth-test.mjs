// Trava da API (passo 2 da hospedagem): login, cookie, sessão sem tabela, falha
// fechada, 415 e 403, espera do login e o hash da senha. Partes:
// 1. funções puras do backend (validade e assinatura do cookie, teto da espera);
// 2. o backend de dev pelo proxy /api (login, flags do cookie, logout, cabeçalhos);
// 3. backends de teste na 3335 (não sobe sem a trava; trocar o SESSION_SECRET
//    derruba o cookie: o botão de pânico);
// 4. o app no próprio processo, com a espera em 25 ms por unidade e IPs forjados
//    (por IP, teto geral, a senha certa entra depois de esperar);
// 5. login pelo NAVEGADOR de verdade (Secure em http://localhost, /session 200);
// 6. scripts/hash-senha.mjs (recusa senha curta e a TEST_PASSWORD).
// Uso (raiz do repo): node --env-file=backend/.env tests/api/auth-test.mjs
// BACKEND_DIR: uma cópia do backend (mutação), sem mexer no de desenvolvimento
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'
import { sessionCookie } from '../sessao.mjs'

if (!process.env.TEST_PASSWORD || !process.env.DATABASE_URL) {
  console.error('TEST_PASSWORD ou DATABASE_URL ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const BACKEND = process.env.BACKEND_DIR ?? REAL
const DIRECT = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3333'
const PORT = '3335'
const PASSWORD = process.env.TEST_PASSWORD
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const mod = (file) => import(pathToFileURL(join(BACKEND, 'src', file)).href)
const H = { 'X-StudyFlow': '1' }
const JSONH = { 'Content-Type': 'application/json', 'X-StudyFlow': '1' }
const login = (base, password, extra = {}) =>
  fetch(`${base}/login`, { method: 'POST', headers: { ...JSONH, ...extra }, body: JSON.stringify({ password }) })
const cookieOf = (res) => /sf_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
const withCookie = (value) => ({ ...H, Cookie: `sf_session=${value}` })

async function spawned(env) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: BACKEND,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: process.env.DATABASE_URL, PORT, ...env },
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const exited = new Promise((r) => child.once('exit', (code) => r(code)))
  for (let i = 0; i < 40 && !out.includes('API rodando') && child.exitCode === null; i++) await pause(250)
  return {
    out: () => out,
    exitCode: () => child.exitCode,
    async stop() {
      if (child.exitCode === null) child.kill()
      await exited
    },
  }
}

const servers = []
let browser
try {
  const auth = await mod('auth.js')
  const { createApp } = await mod('app.js')

  // ---------- 1. funções puras
  const secret = 'a'.repeat(64)
  const token = auth.newSession(secret)
  const [exp, sig] = token.split('.')
  check('cookie novo vale', auth.validSession(secret, token))
  check('cookie com a assinatura trocada não vale', !auth.validSession(secret, `${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`))
  check('cookie com a validade esticada não vale', !auth.validSession(secret, `${Number(exp) + 86400}.${sig}`))
  check('cookie de outro segredo não vale', !auth.validSession('b'.repeat(64), token))
  check('cookie vencido não vale (30 dias + 1 s depois)', !auth.validSession(secret, token, Date.now() + (auth.SESSION_SECONDS + 1) * 1000))
  check('cookie vale até perto do fim (30 dias − 1 min)', auth.validSession(secret, token, Date.now() + (auth.SESSION_SECONDS - 60) * 1000))
  check('lixo no cookie não vale', ['', 'x', `${exp}`, `${exp}.`, `.${sig}`, `${exp}.${sig}.x`].every((t) => !auth.validSession(secret, t)))
  check('validade de 30 dias fixos', auth.SESSION_SECONDS === 30 * 24 * 60 * 60)
  let worst = 0
  for (const ip of [0, 1, 5, 11, 12, 50, 1000, 1e6]) for (const g of [0, 20, 49, 50, 51, 1000, 1e6]) worst = Math.max(worst, auth.loginDelayMs(ip, g))
  check('espera nunca passa de 30 s (qualquer contagem)', worst === 30_000, String(worst))
  check('espera por IP cresce 0, 1, 2, 4 s', [0, 1, 2, 3].map((n) => auth.loginDelayMs(n, 0)).join() === '0,1000,2000,4000')
  check('teto geral começa depois de 20 erradas no total', auth.loginDelayMs(0, 20) === 0 && auth.loginDelayMs(0, 21) === 1000)

  // ---------- 2. o backend de dev, pelo proxy
  check('sem cookie: GET /session 401', (await fetch(`${API}/session`, { headers: H })).status === 401)
  const wrong = await login(API, `${PASSWORD}x`)
  check('senha errada: 401 sem cookie', wrong.status === 401 && !wrong.headers.get('set-cookie'), `${wrong.status} ${wrong.headers.get('set-cookie')}`)
  const right = await login(API, PASSWORD)
  const set = right.headers.get('set-cookie') ?? ''
  const value = cookieOf(right)
  check('senha certa: 204 com o cookie', right.status === 204 && !!value, String(right.status))
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`]) {
    check(`cookie com ${flag}`, set.split(';').map((p) => p.trim()).includes(flag), set.replace(/sf_session=[^;]*/, 'sf_session=…'))
  }
  check('com o cookie: GET /session 200', (await fetch(`${API}/session`, { headers: withCookie(value) })).status === 200)
  check('com o cookie: GET /tags 200', (await fetch(`${API}/tags`, { headers: withCookie(value) })).status === 200)
  const out = await fetch(`${API}/logout`, { method: 'POST', headers: H })
  check('logout: 204 e o cookie apagado (Max-Age=0)', out.status === 204 && /sf_session=;/.test(out.headers.get('set-cookie') ?? '') && /Max-Age=0/.test(out.headers.get('set-cookie') ?? ''))
  check('depois do logout, uma CÓPIA do cookie continua valendo (sem tabela; o pânico é trocar o SESSION_SECRET)',
    (await fetch(`${API}/session`, { headers: withCookie(value) })).status === 200)
  const textBody = await fetch(`${API}/tags`, { method: 'POST', headers: { ...withCookie(value), 'Content-Type': 'text/plain' }, body: '{"name":"x"}' })
  check('POST com corpo que não é JSON: 415', textBody.status === 415, String(textBody.status))
  const formLogin = await fetch(`${API}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(PASSWORD)}` })
  check('login por formulário (sem JSON): 415, sem cookie', formLogin.status === 415 && !formLogin.headers.get('set-cookie'), String(formLogin.status))
  const noBody = await fetch(`${API}/logout`, { method: 'POST' })
  check('POST sem corpo não pede JSON (logout 204)', noBody.status === 204, String(noBody.status))
  const ghost = '00000000-0000-4000-8000-000000000000'
  const delNo = await fetch(`${API}/tags/${ghost}`, { method: 'DELETE', headers: { Cookie: `sf_session=${value}` } })
  check('DELETE sem X-StudyFlow: 403', delNo.status === 403, String(delNo.status))
  const delYes = await fetch(`${API}/tags/${ghost}`, { method: 'DELETE', headers: withCookie(value) })
  check('DELETE com X-StudyFlow chega na rota (404 da tag)', delYes.status === 404, String(delYes.status))
  check('direto no backend (sem o proxy): o mesmo cookie vale', (await fetch(`${DIRECT}/session`, { headers: withCookie(value) })).status === 200)
  // A errada de cima conta pra este IP no backend de dev; a certa zerou. As
  // baterias entram sem esperar
  const t0 = Date.now()
  await login(API, PASSWORD)
  check('depois da senha certa, o próximo login não espera', Date.now() - t0 < 900, `${Date.now() - t0} ms`)

  // ---------- 3. backends de teste na 3335
  const goodHash = process.env.AUTH_PASSWORD_HASH
  const goodSecret = randomBytes(32).toString('hex')
  const refusals = [
    ['sem AUTH_PASSWORD_HASH', { SESSION_SECRET: goodSecret }],
    ['sem SESSION_SECRET', { AUTH_PASSWORD_HASH: goodHash }],
    ['SESSION_SECRET curto', { AUTH_PASSWORD_HASH: goodHash, SESSION_SECRET: 'curto' }],
    ['hash que não é argon2id', { AUTH_PASSWORD_HASH: '$2b$10$abcdefghijklmnopqrstuv', SESSION_SECRET: goodSecret }],
    ['TRUST_PROXY inválido', { AUTH_PASSWORD_HASH: goodHash, SESSION_SECRET: goodSecret, TRUST_PROXY: 'true' }],
  ]
  for (const [name, env] of refusals) {
    const s = await spawned(env)
    await s.stop()
    check(`não sobe ${name} (saída 1, sem escutar)`, s.exitCode() === 1 && !s.out().includes('API rodando') && s.out().includes('não sobe sem a trava'), s.out().trim().slice(0, 160))
  }
  const rotated = await spawned({ AUTH_PASSWORD_HASH: goodHash, SESSION_SECRET: goodSecret })
  servers.push(rotated)
  const ROT = `http://127.0.0.1:${PORT}`
  check('backend com outro SESSION_SECRET sobe', rotated.out().includes('API rodando'), rotated.out().slice(0, 160))
  check('segredo trocado: o cookie de antes não vale mais (401)', (await fetch(`${ROT}/session`, { headers: withCookie(value) })).status === 401)
  const fresh = cookieOf(await login(ROT, PASSWORD))
  check('segredo trocado: entrar de novo dá um cookie que vale', !!fresh && (await fetch(`${ROT}/session`, { headers: withCookie(fresh) })).status === 200)
  await rotated.stop()

  // ---------- 4. espera do login, no próprio processo (25 ms por unidade)
  const UNIT = 25
  const config = { passwordHash: goodHash, sessionSecret: goodSecret, trustProxy: 1 }
  const listen = async (cfg) => {
    const server = createApp(cfg, { loginUnitMs: UNIT }).listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    servers.push({ stop: () => new Promise((r) => server.close(r)) })
    return `http://127.0.0.1:${server.address().port}`
  }
  const timed = async (base, password, ip) => {
    const start = Date.now()
    const res = await login(base, password, ip ? { 'X-Forwarded-For': ip } : {})
    return { status: res.status, ms: Date.now() - start }
  }
  // Tempo de conferir uma senha sem espera: mediana de 5 IPs novos, num app à parte
  const probe = await listen(config)
  const samples = []
  for (let i = 0; i < 5; i++) samples.push((await timed(probe, 'errada', `10.8.0.${i}`)).ms)
  const base0 = samples.sort((a, b) => a - b)[2]
  let base = await listen(config)
  await timed(base, 'errada-1', '10.0.0.1')
  const ipTimes = []
  for (let i = 0; i < 4; i++) ipTimes.push((await timed(base, 'errada', '10.0.0.1')).ms - base0)
  check('por IP: a espera cresce (1, 2, 4, 8 unidades)', ipTimes[3] >= 6 * UNIT && ipTimes[3] > ipTimes[0] + 4 * UNIT, ipTimes.join())
  check('por IP: outro IP não herda a espera', (await timed(base, 'errada', '10.0.0.2')).ms - base0 < 2.5 * UNIT)
  const ok1 = await timed(base, PASSWORD, '10.0.0.1')
  check('por IP: depois de esperar, a senha certa entra', ok1.status === 204, String(ok1.status))
  check('por IP: a certa zera a contagem', (await timed(base, 'errada', '10.0.0.1')).ms - base0 < 2.5 * UNIT)

  base = await listen(config)
  let longest = 0
  for (let i = 0; i < 55; i++) longest = Math.max(longest, (await timed(base, 'errada', `10.1.${i}.1`)).ms - base0)
  const capped = await timed(base, PASSWORD, '10.9.9.9')
  check('teto geral: 55 erradas de 55 IPs forjados fazem um IP novo esperar o teto', capped.ms - base0 >= 26 * UNIT, `${capped.ms - base0} ms`)
  check('teto geral: a espera nunca passa do teto (30 unidades)', Math.max(longest, capped.ms - base0) <= 30 * UNIT + 150, `${Math.max(longest, capped.ms - base0)} ms`)
  check('teto geral: depois de esperar, a senha certa entra (nunca bloqueia)', capped.status === 204, String(capped.status))

  base = await listen({ ...config, trustProxy: false })
  await timed(base, 'errada', '10.2.0.1')
  await timed(base, 'errada', '10.2.0.2')
  const forged = (await timed(base, 'errada', '10.2.0.3')).ms - base0
  check('sem TRUST_PROXY (dev), X-Forwarded-For forjado não troca o IP (a espera acumula)', forged >= 1.4 * UNIT, `${forged} ms`)

  // ---------- 5. login pelo navegador de verdade
  browser = await puppeteer.launch({ executablePath: CHROME })
  const page = await browser.newPage()
  await page.goto(APP, { waitUntil: 'networkidle0' })
  const before = await page.evaluate(async () => (await fetch('/api/session', { headers: { 'X-StudyFlow': '1' } })).status)
  check('navegador sem cookie: /api/session 401', before === 401, String(before))
  const status = await page.evaluate(async (pw) => (await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StudyFlow': '1' }, body: JSON.stringify({ password: pw }),
  })).status, PASSWORD)
  const jar = (await browser.cookies()).find((c) => c.name === 'sf_session')
  check(`navegador: login 204 e o cookie Secure aceito em ${new URL(APP).origin}`, status === 204 && !!jar && jar.secure && jar.httpOnly && jar.sameSite === 'Strict', JSON.stringify(jar ? { ...jar, value: '…' } : null))
  check('navegador: o script da página não lê o cookie (HttpOnly)', !(await page.evaluate(() => document.cookie)).includes('sf_session'))
  const after = await page.evaluate(async () => (await fetch('/api/session', { headers: { 'X-StudyFlow': '1' } })).status)
  check('navegador: GET /api/session 200 depois do login', after === 200, String(after))
  const jarDays = jar ? (jar.expires * 1000 - Date.now()) / 86400000 : 0
  check('navegador: o cookie vence em 30 dias', jarDays > 29.9 && jarDays <= 30, jarDays.toFixed(3))
  await page.evaluate(async () => fetch('/api/logout', { method: 'POST', headers: { 'X-StudyFlow': '1' } }))
  const loggedOut = await page.evaluate(async () => (await fetch('/api/session', { headers: { 'X-StudyFlow': '1' } })).status)
  check('navegador: Sair apaga o cookie (/api/session 401)', loggedOut === 401 && !(await browser.cookies()).some((c) => c.name === 'sf_session'), String(loggedOut))

  // ---------- 6. scripts/hash-senha.mjs (pela entrada padrão)
  const hashOf = (input, env = {}) => spawnSync(process.execPath, ['scripts/hash-senha.mjs'], {
    cwd: BACKEND, input, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  })
  const short = hashOf('quinze-letras15\n')
  check('hash-senha: 15 caracteres recusada (saída 1, nada gerado)', short.status === 1 && !short.stdout.includes('$argon2'), `${short.status} ${short.stderr.trim()}`)
  const longPw = 'dezesseis-letras'
  const long = hashOf(`${longPw}\n`)
  const argon2 = createRequire(join(BACKEND, 'package.json'))('argon2')
  const hashLine = long.stdout.trim()
  check('hash-senha: 16 caracteres gera um argon2id que confere', long.status === 0 && hashLine.startsWith('$argon2id$') && (await argon2.verify(hashLine, longPw)), `${long.status} ${long.stderr.trim()}`)
  const same = hashOf(`${PASSWORD}\n`, { TEST_PASSWORD: PASSWORD })
  check('hash-senha: recusa a TEST_PASSWORD', same.status === 1 && !same.stdout.includes('$argon2'), `${same.status}`)
  check('hash-senha: a senha não sai na saída', !long.stdout.includes(longPw) && !long.stderr.includes(longPw))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  if (browser) await browser.close()
  for (const s of servers) await s.stop()
  // As baterias seguintes entram sem esperar: a senha certa zera a conta deste IP
  await sessionCookie().catch(() => {})
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
  process.exit()
}
