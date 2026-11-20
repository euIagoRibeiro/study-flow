// Unidade: o texto da lista de campos do aviso do "Iniciar cronômetro" (frontend/src/manualFields.ts, módulo
// sem imports). Sem banco, API, seed nem navegador. Uso (raiz de tests/): node unidade/manual-campos.mjs
import { joinFields, MANUAL_FIELDS } from '../../frontend/src/manualFields.ts'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const same = (name, got, want) => check(name, got === want, `obtido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`)

same('os rótulos dos campos que o Iniciar não leva', Object.values(MANUAL_FIELDS).join('|'), 'Quando|Duração estimada|Medida')
same('um campo: sem conectivo', joinFields(['Quando']), 'Quando')
same('dois campos: "A e B"', joinFields(['Quando', 'Duração estimada']), 'Quando e Duração estimada')
same('três campos: "A, B e C"', joinFields(['Quando', 'Duração estimada', 'Medida']), 'Quando, Duração estimada e Medida')
same('a ordem recebida é mantida', joinFields(['Medida', 'Quando']), 'Medida e Quando')
same('nenhum campo: texto vazio (o aviso nem abre)', joinFields([]), '')
same('não usa vírgula antes do "e" (português)', joinFields(['A', 'B', 'C']).includes(', e '), false)
same('não muda o array recebido', (() => { const f = ['A', 'B', 'C']; joinFields(f); return f.join() })(), 'A,B,C')
same('só 3 campos existem (descrição, caminho, fase, obra e link vão para o cronômetro e não entram)', Object.keys(MANUAL_FIELDS).length, 3)

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
