// Regressão da API em volta de uma migration (substitui os regress-* de cada
// etapa): fotografa os GETs antes e compara depois.
// Uso: node ferramentas/api-snapshot.mjs antes
//      (aplicar a migration / mudar a API)
//      node ferramentas/api-snapshot.mjs depois [--ignorar=campo1,campo2]
// --ignorar: campos novos que a mudança acrescentou de propósito (ex.:
// --ignorar=tracksWorkout,workout na A3b). Rodar o "depois" LOGO depois da
// mudança: bateria que restaura dado pelo fluxo real devolve id novo
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { API, out } from '../config.mjs'

const label = process.argv[2]
if (!['antes', 'depois'].includes(label)) {
  throw new Error('uso: api-snapshot.mjs antes|depois [--ignorar=a,b]')
}
const ignored = (process.argv.find((a) => a.startsWith('--ignorar=')) ?? '')
  .replace('--ignorar=', '')
  .split(',')
  .filter(Boolean)
const endpoints = ['tasks', 'tags', 'executions', 'time-entries', 'measures', 'exercises']

const strip = (item) =>
  Object.fromEntries(Object.entries(item).filter(([key]) => !ignored.includes(key)))
// Por id: empate no campo de ordenação da API não tem ordem garantida
const byId = (list) => [...list].map(strip).sort((a, b) => (a.id < b.id ? -1 : 1))

const now = {}
for (const name of endpoints) {
  const res = await fetch(`${API}/${name}`)
  if (!res.ok) throw new Error(`GET /${name}: ${res.status}`)
  now[name] = await res.json()
}
writeFileSync(out(`snapshot-${label}.json`), JSON.stringify(now, null, 2))

if (label === 'antes') {
  console.log(`foto em out/snapshot-antes.json (${endpoints.map((n) => `${n} ${now[n].length}`).join(', ')})`)
} else {
  const file = out('snapshot-antes.json')
  if (!existsSync(file)) throw new Error('falta o "antes": rode com antes primeiro')
  const before = JSON.parse(readFileSync(file, 'utf8'))
  let failed = 0
  for (const name of endpoints) {
    const a = JSON.stringify(byId(before[name] ?? []))
    const b = JSON.stringify(byId(now[name]))
    const same = a === b
    if (!same) failed++
    console.log(`${same ? 'OK    ' : 'FALHOU'} GET /${name} igual ao de antes (${now[name].length} itens)`)
  }
  if (ignored.length) console.log(`(campos ignorados: ${ignored.join(', ')})`)
  console.log(`\n${endpoints.length - failed} de ${endpoints.length}`)
  process.exitCode = failed ? 1 : 0
}
