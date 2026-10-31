// Sugestões das seleções (S2c) sobre o seed do S3a, contra a conta à mão do
// comentário do dev_seed.sql. Só lê. Uso (raiz do repo): node <este arquivo>
import { API } from '../config.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
const get = async (path) => {
  const res = await fetch(API + path)
  return { status: res.status, body: await res.json() }
}
const tag = (n) => `5eed0000-0000-4000-9000-000000000${n}`
try {
  const names = new Map()
  for (const s of (await get('/selections')).body) {
    if (!s.id.startsWith('5eed')) continue
    names.set(s.id, s.name)
    for (const o of s.options) names.set(o.id, o.name)
  }
  check('as 7 seleções do seed (21 opções) vêm da API', names.size === 28, `${names.size} nomes`)
  const shape = (items) => items.map((i) => `${names.get(i.selectionId)}:${i.optionIds.map((id) => names.get(id)).join(',')}@${i.from}`).sort().join('|')
  const cases = [
    ['Desenho › Fundamentos › Perspectiva: do próprio caminho (2203)', '600', '622', 'Meio:tradicional@path|Natureza:estudo@path'],
    ['Desenho › Fundamentos › Luz e sombra (sem registro): cai pra raiz, o mais recente (2202)', '600', '621', 'Meio:digital@root|Natureza:criação@root'],
    ['Desenho › Inktober: o de ontem (2202)', '600', '610', 'Meio:digital@path|Natureza:criação@path'],
    ['Música: guitarra do 2207; Natureza do 2206 (o 2207 não escolheu); violão arquivado nunca', '800', null, 'Instrumento:guitarra@path|Natureza:prática@path'],
    ['Tecnologia › IA: o de ontem (2205)', '700', '710', 'Abordagem:vibecode@path|Natureza:criação@path'],
    ['Tecnologia só a raiz (nenhum registro sem subtag): cai pra raiz', '700', null, 'Abordagem:vibecode@root|Natureza:criação@root'],
    ['Vestibular › Redação: prática do 2210', '100', '140', 'Natureza:prática@path'],
    ['Vestibular › Matemática: Natureza cai pra raiz (Redação, 2210)', '100', '110', 'Natureza:prática@root'],
    ['Exercícios só a raiz (nenhum registro sem subtag com Local): cai pra raiz, o mais recente (601)', '300', null, 'Local:rua@root'],
    ['Exercícios › Corrida: rua do 601', '300', '330', 'Local:rua@path'],
    ['Treino, sem grupo: academia do 602', '300', '310', 'Local:academia@path'],
    ['Treino › Costas: academia do 1401', '300', '312', 'Local:academia@path'],
    ['Treino › Perna: casa do 1402', '300', '313', 'Local:casa@path'],
    ['Treino › Abdômen (sem registro): cai pra raiz (601)', '300', '314', 'Local:rua@root'],
    ['Idiomas › Inglês: escuta + raw do 1301, não as duas do 1701, mais antigo', '500', '510', 'Habilidade:escuta@path|Tipo de input:raw@path'],
    ['Idiomas › Japonês (sem registro): cai pra raiz (1301)', '500', '520', 'Habilidade:escuta@root|Tipo de input:raw@root'],
  ]
  for (const [name, root, leaf, expected] of cases) {
    const q = new URLSearchParams({ rootTagId: tag(root), ...(leaf ? { tagId: tag(leaf) } : {}) })
    const r = await get(`/selections/sugestao?${q}`)
    const got = r.status === 200 ? shape(r.body.items) : `status ${r.status}`
    check(name, got === expected, got || '(vazio)')
  }
  const executions = (await get('/executions')).body
  const e2208 = executions.find((e) => e.id === '5eed0000-0000-4000-8000-000000002208')
  check('2208 continua com o violão (arquivado) no GET do registro',
    shape((e2208?.selections ?? []).map((s) => ({ ...s, from: '' }))) === 'Instrumento:violão@|Natureza:prática@')
  const choices = (id) => shape((executions.find((e) => e.id === `5eed0000-0000-4000-8000-00000000${id}`)?.selections ?? []).map((s) => ({ ...s, from: '' })))
  check('1701: a múltipla com as duas opções, em ordem', choices('1701') === 'Habilidade:escrita,pensamento@', choices('1701'))
  check('1301 e 202: escuta + o tipo de input', choices('1301') === 'Habilidade:escuta@|Tipo de input:raw@' && choices('0202') === 'Habilidade:escuta@|Tipo de input:comprehensible@', `${choices('1301')} ${choices('0202')}`)
  const withChoices = executions.filter((e) => e.id.startsWith('5eed') && e.selections.length > 0).length
  check('19 registros do seed com escolha (os 10 do S3a + o 501 + 5 com Local + 1301, 202, 1701)', withChoices === 19, String(withChoices))
} catch (err) {
  check('rodou sem erro', false, err.stack?.split('\n').slice(0, 2).join(' '))
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
