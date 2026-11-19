// Sessão das baterias: um login por processo com TEST_PASSWORD (do backend/.env,
// só dev; nunca a senha de produção). apiFetch é o fetch do lado Node com o
// cookie e o X-StudyFlow; launch abre o Chrome com o cookie já posto (a página
// manda o cookie sozinha). Login pelo navegador de verdade: tests/api/auth-test
import puppeteer from 'puppeteer-core'
import { API, APP } from './config.mjs'
import { createDiagnostico } from './diagnostico.mjs'

// Um cookie por API (a das baterias, ou um backend próprio como o da sonda-janela)
const cookies = new Map()

export async function sessionCookie(base = API) {
  if (cookies.has(base)) return cookies.get(base)
  if (!process.env.TEST_PASSWORD) {
    throw new Error('TEST_PASSWORD ausente: rode com --env-file=backend/.env')
  }
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.TEST_PASSWORD }),
  })
  const set = res.headers.get('set-cookie') ?? ''
  const value = /sf_session=([^;]+)/.exec(set)?.[1]
  if (res.status !== 204 || !value) {
    throw new Error(`login das baterias falhou: ${res.status} (TEST_PASSWORD confere com AUTH_PASSWORD_HASH?)`)
  }
  cookies.set(base, value)
  return value
}

export async function apiFetch(url, options = {}) {
  const base = String(url).startsWith(API) ? API : new URL(url).origin
  const value = await sessionCookie(base)
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Cookie: `sf_session=${value}`, 'X-StudyFlow': '1' },
  })
  // Limite geral (RATE_LIMIT_PER_MIN): todas as baterias saem do mesmo IP. Para
  // alto, em vez de virar uma checagem que falha sem dizer por quê
  if (res.status === 429) throw new Error(`limite geral da API atingido (429) em ${url}: subir RATE_LIMIT_PER_MIN?`)
  return res
}

// Diagnóstico de falha em TODA página aberta por launch(): só lê eventos e imprime, nunca espera nem
// repete nada. Imprime na 1ª linha "FALHOU…" do processo (as telas e o layout a escrevem assim) e, se o
// processo sair com código de falha sem ter impresso, na saída
let latestDiag = null
let hooked = false
function hookFailure() {
  if (hooked) return
  hooked = true
  const log = console.log
  console.log = (...args) => {
    log(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('FALH')) latestDiag?.print(args.slice(0, 2).join(' ').slice(0, 120))
  }
  process.on('exit', (code) => {
    if (code !== 0 || (process.exitCode ?? 0) !== 0) latestDiag?.print(`saída com código ${code || process.exitCode}`)
  })
}

export async function launch(options) {
  const value = await sessionCookie()
  const browser = await puppeteer.launch(options)
  const { hostname } = new URL(APP)
  await browser.setCookie({ name: 'sf_session', value, domain: hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' })
  const diag = createDiagnostico()
  latestDiag = diag
  hookFailure()
  const watched = new WeakSet()
  const watch = async (page) => {
    if (watched.has(page)) return
    watched.add(page)
    await diag.watch(page)
  }
  // Pela troca do newPage a página já nasce vigiada (sem corrida com o 1º pedido); o evento
  // cobre páginas abertas de outro jeito
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...args) => {
    const page = await newPage(...args)
    await watch(page)
    return page
  }
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return
    const page = await target.page().catch(() => null)
    if (page) await watch(page)
  })
  return browser
}
