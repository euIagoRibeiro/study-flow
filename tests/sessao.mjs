// Sessão das baterias: um login por processo com TEST_PASSWORD (do backend/.env,
// só dev; nunca a senha de produção). apiFetch é o fetch do lado Node com o
// cookie e o X-StudyFlow; launch abre o Chrome com o cookie já posto (a página
// manda o cookie sozinha). Login pelo navegador de verdade: tests/api/auth-test
import puppeteer from 'puppeteer-core'
import { API, APP } from './config.mjs'

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

export async function launch(options) {
  const value = await sessionCookie()
  const browser = await puppeteer.launch(options)
  const { hostname } = new URL(APP)
  await browser.setCookie({ name: 'sf_session', value, domain: hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' })
  return browser
}
