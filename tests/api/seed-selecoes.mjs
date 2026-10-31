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
  check('as 4 seleções do seed (11 opções) vêm da API', names.size === 15, `${names.size} nomes`)
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
    ['Exercícios: nenhum registro com escolha, nenhuma sugestão', '300', null, ''],
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
  const withChoices = executions.filter((e) => e.id.startsWith('5eed') && e.selections.length > 0).length
  check('11 registros do seed com escolha (os 10 novos + o 501)', withChoices === 11, String(withChoices))
} catch (err) {
  check('rodou sem erro', false, err.stack?.split('\n').slice(0, 2).join(' '))
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
