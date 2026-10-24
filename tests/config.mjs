// Endereços, navegador e pasta de saída das baterias: o único lugar com isso.
// Cada um pode ser trocado por variável de ambiente (ex.: o backend de teste
// na 3334 apontado pra um banco restaurado: API_URL=http://localhost:3334)
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP = process.env.APP_URL ?? 'http://localhost:5173'
export const API = process.env.API_URL ?? 'http://localhost:3333'
// puppeteer-core usa o Chrome já instalado (não baixa um próprio)
export const CHROME =
  process.env.CHROME_PATH ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe'

// Prints e diffs: tests/out/ (fora do git)
export const TESTS = dirname(fileURLToPath(import.meta.url))
export const OUT = join(TESTS, 'out')
mkdirSync(OUT, { recursive: true })
export const out = (name) => join(OUT, name)
