// run.mjs recusa rodar sem grupo explícito (o padrão antigo era "tudo", que roda tudo
// sem a trava de memória). O run.mjs roda como processo filho num ambiente montado do
// zero: sem DATABASE_URL, sem --env-file. Se a recusa falhar, o filho para em "DATABASE_URL
// ausente" (saída 2) e nenhuma bateria de verdade roda. Uso (em tests/):
//   node api/run-uso-test.mjs
// RUN_MJS: uma cópia do run.mjs, ao lado do config.mjs (mutação, sem mexer no real)
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = process.env.RUN_MJS ?? join(TESTS, 'run.mjs')
const GROUPS = ['tudo', 'banco', 'api', 'telas', 'layout']
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}

// Ambiente do filho: só o que o Node precisa pra iniciar no Windows e no Linux
const childEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
  if (process.env[key] !== undefined) childEnv[key] = process.env[key]
}
const run = (...args) => {
  const nodeArgs = [RUN, ...args]
  // a garantia: nunca --env-file, nunca DATABASE_URL, nem FILTRO_EXATO / NODE_OPTIONS
  if (nodeArgs.some((a) => a.startsWith('--env-file'))) throw new Error('--env-file no filho')
  if ('DATABASE_URL' in childEnv || 'NODE_OPTIONS' in childEnv || 'FILTRO_EXATO' in childEnv) {
    throw new Error('ambiente do filho não está limpo')
  }
  const r = spawnSync(process.execPath, nodeArgs, { cwd: TESTS, env: childEnv, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

check('ambiente do filho: sem DATABASE_URL, mesmo que o terminal tenha',
  !('DATABASE_URL' in childEnv) && !('NODE_OPTIONS' in childEnv) && !('FILTRO_EXATO' in childEnv))
check('ambiente do filho: o processo de teste não repassa nada além do mínimo',
  Object.keys(childEnv).every((k) => ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].includes(k)))

const usageOk = (r) =>
  r.code === 2 &&
  r.text.includes('USO:') &&
  GROUPS.every((g) => r.text.includes(g)) &&
  !r.text.includes('PRÉ-CONDIÇÃO') &&
  !/\bOK\b|FALHOU|rodando/.test(r.text)
const brief = (r) => `saída ${r.code}: ${r.text.slice(0, 200).replace(/\s+/g, ' ')}`

const none = run()
check('sem argumento: saída 2', none.code === 2, brief(none))
check('sem argumento: mostra o uso e os 5 grupos, sem chegar nas pré-condições', usageOk(none), brief(none))

const empty = run('')
check('grupo vazio: recusa com o uso (saída 2)', usageOk(empty), brief(empty))

const unknown = run('grupo-que-nao-existe')
check('grupo desconhecido: recusa com o uso (saída 2, não 1)', usageOk(unknown), brief(unknown))
check('grupo desconhecido: nomeia o grupo recusado', unknown.text.includes('grupo-que-nao-existe'), brief(unknown))

const proto = run('constructor')
check('nome herdado de Object ("constructor") não vale como grupo', usageOk(proto), brief(proto))

for (const group of GROUPS) {
  const r = run(group)
  check(`"${group}" explícito: aceito, para na pré-condição DATABASE_URL (saída 2)`,
    r.code === 2 && r.text.includes('PRÉ-CONDIÇÃO: DATABASE_URL ausente') && !r.text.includes('USO:'), brief(r))
}

check('total de checagens = 13', results.length === 13, `${results.length}`)
const passed = results.filter(Boolean).length
console.log(`\n${passed} de ${results.length}`)
process.exitCode = passed === results.length ? 0 : 1
