// Unidade: texto das medidas nas linhas do Painel (frontend/src/measureText.ts, módulo sem imports).
// Não usa banco, API, seed nem navegador: o Node lê o .ts direto (remoção de tipos).
// Uso (raiz de tests/): node unidade/medidas-texto.mjs   ou   npm run unidade
import { lowerLabel, measureLines } from '../../frontend/src/measureText.ts'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const same = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `obtido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`)
const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const kind = (name, quantity) => ({ name, quantity })

// ---- lowerLabel: minúsculas, exceto siglas
same('"Questões" vira "questões"', lowerLabel('Questões'), 'questões')
same('"Acertos" vira "acertos"', lowerLabel('Acertos'), 'acertos')
same('sigla de 4 letras fica: "ENEM"', lowerLabel('ENEM'), 'ENEM')
same('sigla de 3 letras fica: "USP"', lowerLabel('USP'), 'USP')
same('sigla de 2 letras fica: "EJ"', lowerLabel('EJ'), 'EJ')
same('palavra comum e sigla: "Prova ENEM" vira "prova ENEM"', lowerLabel('Prova ENEM'), 'prova ENEM')
same('sigla entre parênteses: "Vestibular (USP)"', lowerLabel('Vestibular (USP)'), 'vestibular (USP)')
same('sigla com barra: "Ação ENEM/FUVEST"', lowerLabel('Ação ENEM/FUVEST'), 'ação ENEM/FUVEST')
same('uma letra maiúscula sozinha não é sigla: "Parte A"', lowerLabel('Parte A'), 'parte a')
same('uma letra com acento: "Á"', lowerLabel('Á'), 'á')
same('acentos maiúsculos viram minúsculos: "São Paulo"', lowerLabel('São Paulo'), 'são paulo')
same('sigla com acento fica: "ÉPICO"', lowerLabel('ÉPICO'), 'ÉPICO')
same('misto não é sigla: "MiXed"', lowerLabel('MiXed'), 'mixed')
same('"ERROS" todo em maiúsculas é lido como sigla (consequência da regra)', lowerLabel('ERROS'), 'ERROS')
same('números e símbolos ficam: "5 km/h"', lowerLabel('5 Km/H'), '5 km/h')
same('texto vazio', lowerLabel(''), '')
same('espaços internos preservados: "Questões  de   prova"', lowerLabel('Questões  de   prova'), 'questões  de   prova')
same('escrita sem maiúscula/minúscula (japonês) fica como está', lowerLabel('日本語'), '日本語')

// ---- measureLines: total com unidade e linha de tipos
const questoes = { name: 'Questões', singular: 'questão', total: 120, kinds: [kind('Acertos', 100), kind('Erros', 20)] }
same('total com unidade no plural e tipos "rótulo: número"', measureLines([questoes], fmt), [{ total: '120 questões', kinds: 'acertos: 100 · erros: 20', kindItems: ['acertos: 100', 'erros: 20'] }])
same('singular com o total 1', measureLines([{ ...questoes, total: 1, kinds: [kind('Acertos', 1)] }], fmt), [{ total: '1 questão', kinds: 'acertos: 1', kindItems: ['acertos: 1'] }])
same('decimal 1,5 não é singular', measureLines([{ name: 'Km', singular: 'km', total: 1.5, kinds: [] }], fmt), [{ total: '1,5 km' }])
same('só o 1 exato é singular: 0,5 fica no plural', measureLines([{ name: 'Quilômetros', singular: 'quilômetro', total: 0.5, kinds: [] }], fmt), [{ total: '0,5 quilômetros' }])
same('1,5 também fica no plural', measureLines([{ name: 'Quilômetros', singular: 'quilômetro', total: 1.5, kinds: [] }], fmt), [{ total: '1,5 quilômetros' }])
same('total 1,00 decimal é singular', measureLines([{ name: 'Quilômetros', singular: 'quilômetro', total: 1, kinds: [] }], fmt), [{ total: '1 quilômetro' }])
same('só sem tipo (kinds vazio): só o total, sem linha de tipos', measureLines([{ name: 'Capítulos', singular: 'capítulo', total: 3, kinds: [] }], fmt), [{ total: '3 capítulos' }])
same('"sem tipo: N" entra na linha de tipos, por último como veio', measureLines([{ ...questoes, total: 125, kinds: [kind('Acertos', 100), kind('Erros', 20), kind(null, 5)] }], fmt), [{ total: '125 questões', kinds: 'acertos: 100 · erros: 20 · sem tipo: 5', kindItems: ['acertos: 100', 'erros: 20', 'sem tipo: 5'] }])
same('sem tipo maior que os tipos mantém a ordem recebida (a ordem é da API)', measureLines([{ ...questoes, total: 30, kinds: [kind('Erros', 9), kind(null, 20)] }], fmt), [{ total: '30 questões', kinds: 'erros: 9 · sem tipo: 20', kindItems: ['erros: 9', 'sem tipo: 20'] }])
same('milhar e decimal no formato pt-BR', measureLines([{ name: 'Páginas', singular: 'página', total: 1001.5, kinds: [kind('Lidas', 1000), kind(null, 1.5)] }], fmt), [{ total: '1.001,5 páginas', kinds: 'lidas: 1.000 · sem tipo: 1,5', kindItems: ['lidas: 1.000', 'sem tipo: 1,5'] }])
same('sigla na unidade e no tipo fica', measureLines([{ name: 'Questões ENEM', singular: 'questão ENEM', total: 2, kinds: [kind('Acertos ENEM', 2)] }], fmt), [{ total: '2 questões ENEM', kinds: 'acertos ENEM: 2', kindItems: ['acertos ENEM: 2'] }])
same('singular com sigla fica: "1 questão ENEM"', measureLines([{ name: 'Questões ENEM', singular: 'Questão ENEM', total: 1, kinds: [] }], fmt), [{ total: '1 questão ENEM' }])
same('várias medidas: uma linha cada, na ordem recebida', measureLines([questoes, { name: 'Km', singular: 'km', total: 8.75, kinds: [] }], fmt).map((l) => l.total), ['120 questões', '8,75 km'])
same('lista vazia: nenhuma linha', measureLines([], fmt), [])
// cada item é uma unidade ("rótulo: número") que a tela não quebra no meio
const three = measureLines([{ ...questoes, total: 125, kinds: [kind('Acertos', 100), kind('Erros', 20), kind(null, 5)] }], fmt)[0]
same('kindItems: um item por tipo, na ordem recebida, sem o separador', three.kindItems, ['acertos: 100', 'erros: 20', 'sem tipo: 5'])
check('kinds é exatamente os kindItems juntos por " · "', three.kinds === three.kindItems.join(' · '))
check('nenhum item contém o separador nem termina em ponto médio', three.kindItems.every((item) => !item.includes('·')))
check('"sem tipo: 5" é UM item (o espaço de "sem tipo" não é separador de item)', three.kindItems.includes('sem tipo: 5') && three.kindItems.length === 3)
check('sem tipos: nem kinds nem kindItems', (() => { const l = measureLines([{ name: 'Km', singular: 'km', total: 2, kinds: [] }], fmt)[0]; return !('kinds' in l) && !('kindItems' in l) })())
check('a linha de tipos não existe como propriedade quando não há tipos', !('kinds' in measureLines([{ name: 'Km', singular: 'km', total: 2, kinds: [] }], fmt)[0]))
check('o separador é " · " (ponto médio com espaços)', measureLines([questoes], fmt)[0].kinds.includes(' · '))
check('o número é formatado pela função recebida (injeção)', measureLines([{ name: 'X', singular: 'x', total: 7, kinds: [] }], (n) => `<${n}>`)[0].total === '<7> x')

const ok = results.filter(Boolean).length
console.log(`\n${ok} de ${results.length}`)
process.exitCode = ok === results.length ? 0 : 1
