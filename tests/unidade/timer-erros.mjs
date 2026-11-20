// Unidade: as frases do servidor sobre o cronômetro e o fim do registro, no texto da tela
// (frontend/src/timerErrors.ts, módulo sem imports). Sem banco, API, seed nem navegador.
// Uso (raiz de tests/): node unidade/timer-erros.mjs   ou   npm run unidade
import { ALREADY_FINISHED, RESUMED_AFTER_END, timerErrorMessage } from '../../frontend/src/timerErrors.ts'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const same = (name, got, want) => check(name, got === want, `obtido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`)

const SERVER_RESUME = 'Execução não encontrada ou já finalizada'
const SERVER_END = 'O registro não pode terminar antes do início da sessão em andamento.'

same('Retomar: "Execução não encontrada ou já finalizada" vira a frase da tela', timerErrorMessage(SERVER_RESUME), 'Este registro já foi finalizado.')
same('Finalizar: a recusa do fim vira a frase da tela', timerErrorMessage(SERVER_END), 'Uma sessão foi retomada depois do horário que você escolheu para terminar. Pause o cronômetro e finalize de novo.')
same('as constantes exportadas são as mesmas frases', [ALREADY_FINISHED, RESUMED_AFTER_END].join('|'), ['Este registro já foi finalizado.', 'Uma sessão foi retomada depois do horário que você escolheu para terminar. Pause o cronômetro e finalize de novo.'].join('|'))
same('as duas frases são diferentes (uma não se confunde com a outra)', ALREADY_FINISHED === RESUMED_AFTER_END, false)
same('mensagem desconhecida: null', timerErrorMessage('A sessão não pode terminar no futuro.'), null)
same('texto vazio: null', timerErrorMessage(''), null)
same('só o texto exato: sem o ponto final, não casa (Finalizar)', timerErrorMessage(SERVER_END.slice(0, -1)), null)
same('só o texto exato: com ponto final a mais, não casa (Retomar)', timerErrorMessage(`${SERVER_RESUME}.`), null)
same('só o texto exato: caixa diferente não casa', timerErrorMessage(SERVER_RESUME.toLowerCase()), null)
same('só o texto exato: espaço no começo não casa', timerErrorMessage(` ${SERVER_RESUME}`), null)
same('frase do servidor de outro tema (obra) não é tocada', timerErrorMessage('Obra não encontrada'), null)
check('a frase da tela não repete o texto técnico do servidor', !ALREADY_FINISHED.includes('Execução') && !RESUMED_AFTER_END.includes('em andamento'))
check('as frases não usam o padrão "PALAVRA — fragmento"', ![ALREADY_FINISHED, RESUMED_AFTER_END].some((text) => text.includes('—')))

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
