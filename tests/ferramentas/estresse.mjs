// Tenta reproduzir as intermitências da m5-forms e da a3d-tags (2026-10-31):
// as duas, nessa ordem, 5 rodadas, com a CPU da página 4× mais lenta. Manual,
// fora do npm run tudo; precisa do seed de hoje. Só relata: nunca ajusta nada.
// Uso (em tests/): node --env-file=../backend/.env ferramentas/estresse.mjs
import { spawnSync } from 'node:child_process'
import { freemem } from 'node:os'
import { join } from 'node:path'
import { TESTS } from '../config.mjs'

const ROUNDS = 5
const CPU = '4'
const BATTERIES = ['telas/m5-forms.mjs', 'telas/a3d-tags.mjs']

let failed = 0
for (let round = 1; round <= ROUNDS; round++) {
  for (const file of BATTERIES) {
    const free = (freemem() / 1024 ** 3).toFixed(2)
    const started = Date.now()
    const r = spawnSync(process.execPath, [join(TESTS, file)], {
      cwd: TESTS, encoding: 'utf8', env: { ...process.env, ESTRESSE_CPU: CPU },
    })
    const lines = (r.stdout ?? '').trim().split('\n')
    const seconds = ((Date.now() - started) / 1000).toFixed(0)
    console.log(`rodada ${round} ${file}: ${lines.at(-1)}, saída ${r.status}, ${seconds}s, ${free} GB livres`)
    if (r.status !== 0) {
      failed++
      console.log(lines.filter((l) => /^(FALHOU|DIAGNÓSTICO|  -)/.test(l)).join('\n'))
      if (r.stderr) console.log(r.stderr.trim().split('\n').slice(0, 6).join('\n'))
    }
  }
}
console.log(`\n${failed === 0 ? 'não reproduziu' : `${failed} execuções falharam`}: ${ROUNDS * BATTERIES.length} execuções, CPU ${CPU}×`)
