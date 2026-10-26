// Roda as baterias por grupo (banco, api, telas, layout) ou todas, depois de
// conferir as pré-condições. Nunca faz reseed sozinho: se o seed não for de
// hoje, para e diz o comando. Uso: npm run tudo | banco | api | telas | layout
// (com filtro: npm run telas -- a3e1)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { API, APP, TESTS } from './config.mjs'

// Ordem dentro de cada grupo = a das etapas. Argumento extra = outra rodada
// (a3e1 com o navegador em inglês; minutes-fix e m5-forms já rodam os dois)
const groups = {
  banco: ['phase-cases.sql', 'a1-cases.sql', 'm1-cases.sql', 'a3-cases.sql', 'dashboard-cases.sql', 'tags-cases.sql',
    'seed-dashboard.sql'],
  api: ['p2-test.mjs', 'a1b-test.mjs', 'm2-test.mjs', 'a3b-test.mjs', 'dashboard-test.mjs'],
  telas: [
    'p4a-tags.mjs', 'p4b-forms.mjs', 'a1d-forms.mjs', 'minutes-fix.mjs',
    'm4-tags.mjs', 'm5-forms.mjs', 'chip-fix.mjs', 'a3d-tags.mjs', 'a3e1.mjs',
    ['a3e1.mjs', 'en-US'], 'a3e2.mjs', 'a3f.mjs', 'chips-medida.mjs', 'painel.mjs',
    'painel-graficos.mjs', 'painel-periodos.mjs', 'painel-comparacao.mjs', 'painel-tags.mjs',
    'cronometro-inicio.mjs', 'cronometro-escolha.mjs',
  ],
  layout: [
    'overflow.mjs', 'p4b-layout.mjs', 'a1d-layout.mjs', 'm4-layout.mjs',
    'm5-layout.mjs', 'a3d-layout.mjs', 'a3e-layout.mjs', 'a3f-layout.mjs', 'topo.mjs',
    'painel-layout.mjs', 'painel-contraste.mjs',
  ],
}
const PG_CONTAINER = process.env.PG_CONTAINER ?? 'study-flow-postgres-1'

const which = process.argv[2] ?? 'tudo'
// Filtro opcional: só as baterias cujo nome contém o texto (npm run telas -- a3e1)
const only = process.argv[3]
const chosen = which === 'tudo' ? Object.keys(groups) : [which]
if (!chosen.every((g) => groups[g])) {
  throw new Error(`grupo desconhecido: ${which} (tudo, ${Object.keys(groups).join(', ')})`)
}

// ---- pré-condições: para no primeiro problema, com o que fazer
function stop(message) {
  console.error(`\nPRÉ-CONDIÇÃO: ${message}`)
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  stop('DATABASE_URL ausente. Rode pelo npm (npm run tudo), que lê ../backend/.env')
}
const needsApi = chosen.some((g) => g !== 'banco')
const needsApp = chosen.some((g) => g === 'telas' || g === 'layout')
async function reachable(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}
if (needsApi && !(await reachable(`${API}/tags`))) {
  stop(`a API não responde em ${API}. Suba o backend (cd backend && npm run dev)`)
}
if (needsApp && !(await reachable(APP))) {
  stop(`o frontend não responde em ${APP}. Suba o Vite (cd frontend && npm run dev)`)
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
// Os registros do seed nascem com o now() do seed (as tarefas têm created_at
// relativo, de propósito: não servem pra isso)
const seed = await pool.query(
  `SELECT (min(created_at) AT TIME ZONE 'America/Sao_Paulo')::date =
          (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today
   FROM task_executions WHERE id::text LIKE '5eed%'
   HAVING count(*) > 0`,
)
await pool.end()
if (seed.rowCount === 0) {
  stop('o seed não está aplicado. Rode (na raiz): docker exec -i ' +
    `${PG_CONTAINER} psql -U studyflow -d studyflow -v ON_ERROR_STOP=1 < backend/seeds/dev_seed.sql`)
}
if (!seed.rows[0].today) {
  stop('o seed não é de hoje: os registros "de hoje" viraram "ontem" e baterias ' +
    'falham sem bug. Refaça o seed (unseed + seed, comandos no README)')
}

// ---- execução
const results = []
// "N de M" da própria bateria; as de layout antigas não imprimem: aí conta
// as linhas OK / FALHOU (uma por medição)
function summary(output) {
  const lines = output.trim().split('\n')
  const total = lines.filter((l) => /\d+ de \d+/.test(l)).at(-1)?.trim()
  if (total) return total
  const ok = lines.filter((l) => /^OK\s/.test(l)).length
  const failed = lines.filter((l) => /^FALH(OU|A)\b/.test(l)).length
  return ok + failed > 0 ? `${ok} de ${ok + failed} (linhas OK/FALHOU)` : ''
}
function runSql(file) {
  // Cada arquivo numa transação desfeita: nada do caso sobra no banco
  let sql = readFileSync(join(TESTS, 'banco', file), 'utf8')
  if (!/^BEGIN;/m.test(sql)) sql = `BEGIN;\n${sql}\nROLLBACK;\n`
  const user = new URL(process.env.DATABASE_URL)
  return spawnSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U',
    decodeURIComponent(user.username), '-d', user.pathname.slice(1), '-v', 'ON_ERROR_STOP=1', '-X'],
  { input: sql, encoding: 'utf8' })
}
for (const group of chosen) {
  console.log(`\n== ${group}`)
  for (const entry of groups[group]) {
    const [file, ...args] = [].concat(entry)
    if (only && !file.includes(only)) continue
    const name = [file, ...args].join(' ')
    const started = Date.now()
    const r = group === 'banco'
      ? runSql(file)
      : spawnSync(process.execPath, [join(TESTS, group, file), ...args],
          { cwd: TESTS, encoding: 'utf8', env: process.env })
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`
    const total = summary(output)
    const [ok, of] = (total.match(/(\d+) de (\d+)/) ?? []).slice(1).map(Number)
    // Passa só com saída 0 E "N de N" com N > 0: bateria que não achou o
    // que medir (0 de 0) ou que terminou sem resumo é falha
    const passed = r.status === 0 && of > 0 && ok === of
    const seconds = ((Date.now() - started) / 1000).toFixed(0)
    console.log(`${passed ? 'OK    ' : 'FALHOU'} ${name.padEnd(26)} ${total || '(sem resumo)'}  ${seconds}s`)
    if (!passed) {
      console.log(output.split('\n').filter((l) => /FALH|Error|erro/i.test(l)).slice(0, 8).map((l) => `         ${l}`).join('\n'))
    }
    results.push({ name: `${group}/${name}`, passed })
  }
}
const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length} de ${results.length} baterias passaram`)
if (failed.length) console.log(`falharam: ${failed.map((r) => r.name).join(', ')}`)
process.exitCode = failed.length ? 1 : 0
