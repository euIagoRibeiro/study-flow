import { createHmac, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'

export const COOKIE = 'sf_session'
// 30 dias fixos, sem renovação: vencido, entra de novo
export const SESSION_SECONDS = 30 * 24 * 60 * 60

// Falha fechada: sem o hash ou sem o segredo, a API não sobe (nenhuma variável
// desliga a trava)
export function loadConfig(env) {
  const passwordHash = env.AUTH_PASSWORD_HASH ?? ''
  const sessionSecret = env.SESSION_SECRET ?? ''
  if (!passwordHash.startsWith('$argon2id$')) {
    throw new Error(
      'AUTH_PASSWORD_HASH ausente ou não é argon2id (gere com scripts/hash-senha.mjs)',
    )
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET ausente ou com menos de 32 caracteres')
  }
  const proxy = env.TRUST_PROXY ?? 'false'
  if (!/^(false|\d+)$/.test(proxy)) {
    throw new Error(
      'TRUST_PROXY: "false" ou o número de proxies na frente da API',
    )
  }
  const rate = Number(env.RATE_LIMIT_PER_MIN)
  return {
    passwordHash,
    sessionSecret,
    trustProxy: proxy === 'false' ? false : Number(proxy),
    // Teto fixo: a variável só ajusta dentro da faixa, nunca desliga o limite
    rateLimitPerMin:
      Number.isInteger(rate) && rate >= RATE_MIN && rate <= RATE_MAX
        ? rate
        : RATE_DEFAULT,
  }
}

// Limite geral por IP, em todas as rotas: uso humano fica bem abaixo de 300 por
// minuto. Janela fixa de 1 minuto; passou, 429 até a próxima (nunca mais que isso)
export const RATE_DEFAULT = 300
const RATE_MIN = 30
const RATE_MAX = 1500
const RATE_WINDOW_MS = 60 * 1000

// Uma linha por janela no máximo, com a contagem (e, no limite geral, o primeiro
// pedido: método e rota, sem query, sem caracteres de controle, até 80): nunca IP,
// cabeçalho ou corpo
const routeOf = (req) =>
  `${req.method} ${req.originalUrl.split('?')[0]}`
    .replace(/\p{Cc}/gu, '')
    .slice(0, 80)

function windowLog(log, schedule, line) {
  let pending = null
  return (first) => {
    if (pending) return void (pending.count += 1)
    pending = { count: 1, first }
    schedule(() => {
      log(line(pending))
      pending = null
    }, RATE_WINDOW_MS)
  }
}

const later = (fn, ms) => setTimeout(fn, ms).unref()

export function rateLimiter(
  perMin = RATE_DEFAULT,
  now = () => Date.now(),
  { log = console.warn, schedule = later } = {},
) {
  const byIp = new Map()
  const refused = windowLog(
    log,
    schedule,
    ({ count, first }) =>
      `Limite geral: ${count} pedido(s) recusado(s) com 429 em 1 minuto; o primeiro: ${first}`,
  )
  return function rateLimit(req, res, next) {
    const t = now()
    let entry = byIp.get(req.ip)
    if (!entry || t - entry.start >= RATE_WINDOW_MS) {
      byIp.delete(req.ip)
      entry = { start: t, count: 0 }
      byIp.set(req.ip, entry)
      if (byIp.size > 10_000) byIp.delete(byIp.keys().next().value)
    }
    entry.count += 1
    if (entry.count <= perMin) return next()
    const wait = Math.ceil((entry.start + RATE_WINDOW_MS - t) / 1000)
    refused(routeOf(req))
    res.set('Retry-After', String(Math.max(1, wait)))
    res.status(429).json({ error: 'Muitos pedidos. Espere um pouco.' })
  }
}

const sign = (secret, expires) =>
  createHmac('sha256', secret).update(`v1.${expires}`).digest('base64url')

// Sem tabela: o cookie carrega a validade e a assinatura dela. Logout só apaga o
// cookie do navegador; uma cópia vale até vencer ou até trocar o SESSION_SECRET
export function newSession(secret, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS
  return `${expires}.${sign(secret, expires)}`
}

export function validSession(secret, token, now = Date.now()) {
  const match = /^(\d{1,12})\.([\w-]{43})$/.exec(token ?? '')
  if (!match) return false
  const expected = Buffer.from(sign(secret, match[1]))
  const given = Buffer.from(match[2])
  return (
    given.length === expected.length &&
    timingSafeEqual(given, expected) &&
    Number(match[1]) > now / 1000
  )
}

export function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) {
      return part.slice(at + 1).trim()
    }
  }
  return undefined
}

export const sessionCookie = (token) =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`
export const clearedCookie = () =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`

// Espera antes de conferir a senha, crescendo com as erradas: por IP (1, 2, 4…
// segundos) e um teto geral somando todos os IPs (quem forja o IP cai nele).
// Nunca bloqueia: depois de esperar, a senha certa entra
const MAX_UNITS = 30
const WINDOW_MS = 15 * 60 * 1000
const GLOBAL_FREE = 20

export function loginDelayMs(ipFails, globalFails, unitMs = 1000) {
  const ip = ipFails > 0 ? 2 ** Math.min(ipFails - 1, 10) : 0
  const global = Math.max(0, globalFails - GLOBAL_FREE)
  return Math.min(MAX_UNITS, Math.max(ip, global)) * unitMs
}

export function loginLimiter({
  unitMs = 1000,
  now = () => Date.now(),
  log = console.warn,
  schedule = later,
} = {}) {
  const byIp = new Map()
  let globalFails = []
  // Só a contagem: o IP fica fora do log
  const wrong = windowLog(
    log,
    schedule,
    ({ count }) => `Login: ${count} senha(s) errada(s) em 1 minuto`,
  )
  const forget = () => {
    const since = now() - WINDOW_MS
    globalFails = globalFails.filter((t) => t > since)
    for (const [ip, entry] of byIp) if (entry.last <= since) byIp.delete(ip)
  }
  return {
    delayFor(ip) {
      forget()
      return loginDelayMs(byIp.get(ip)?.fails ?? 0, globalFails.length, unitMs)
    },
    failed(ip) {
      const entry = byIp.get(ip) ?? { fails: 0, last: 0 }
      byIp.delete(ip)
      byIp.set(ip, { fails: entry.fails + 1, last: now() })
      globalFails.push(now())
      wrong()
      // Memória limitada mesmo com IPs forjados: o teto já passou de 30 s bem antes
      if (globalFails.length > 1000) globalFails.shift()
      if (byIp.size > 10_000) byIp.delete(byIp.keys().next().value)
    },
    succeeded(ip) {
      byIp.delete(ip)
    },
  }
}

export const checkPassword = (hash, password) =>
  argon2.verify(hash, password).catch(() => false)
