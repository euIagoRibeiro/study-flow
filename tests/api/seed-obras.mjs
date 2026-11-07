// Obras do seed (O3a) pela API, contra a conta à mão do comentário do dev_seed.sql.
// Não muda nada: as escritas são recusadas de propósito (provam que os ids passam
// pela validação de uuid de uma rota de escrita). Uso (raiz do repo): node <este arquivo>
import { API } from '../config.mjs'
import { apiFetch } from '../sessao.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const call = async (method, path, body) => {
  const res = await apiFetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const id = (group, n) => `5eed0000-0000-4000-${group}-${String(n).padStart(12, '0')}`
const show = (w) => JSON.stringify(w && {
  status: w.status, records: w.records, seconds: w.seconds, progress: w.progress, total: w.total,
  measureCurrent: w.measureCurrent, defaultTagActive: w.defaultTagActive, defaultTaskActive: w.defaultTaskActive,
})
try {
  const works = (await call('GET', '/works')).body.filter((w) => w.id.startsWith('5eed'))
  const by = Object.fromEntries(works.map((w) => [w.title, w]))
  check('as 4 obras do seed', works.map((w) => w.title).sort().join() === 'Curso de Docker,Inktober,Soul Eater,Vagabond', works.map((w) => w.title).join())
  const soul = by['Soul Eater']
  check('Soul Eater: 6 de 113, 2 registros, 82:20, medida atual',
    soul?.status === 'em_andamento' && soul.progress === 6 && soul.total === 113 && soul.records === 2 && soul.seconds === 4940 && soul.measureCurrent && soul.defaultTagActive && soul.defaultTaskActive, show(soul))
  const ink = by.Inktober
  check('Inktober: sem medida, 2 registros, 54:30',
    ink?.status === 'em_andamento' && ink.progress === null && ink.total === null && ink.records === 2 && ink.seconds === 3270 && ink.measureCurrent, show(ink))
  const vag = by.Vagabond
  check('Vagabond: pausada, 0 de 327, sem registro',
    vag?.status === 'pausado' && vag.progress === 0 && vag.total === 327 && vag.records === 0 && vag.seconds === 0, show(vag))
  const doc = by['Curso de Docker']
  check('Curso de Docker: concluída, tarefa arquivada, caminho ativo, sem medida num caminho sem medida',
    doc?.status === 'concluido' && doc.defaultTaskActive === false && doc.defaultTagActive === true && doc.records === 0 && doc.measureCurrent === true, show(doc))
  check('nenhuma obra do seed com a marca de medida mudada', works.every((w) => w.measureCurrent), works.filter((w) => !w.measureCurrent).map((w) => w.title).join())

  const records = (await call('GET', '/executions')).body
  const rec = (n) => records.find((r) => r.id === id('8000', n))
  check('registros ligados: 2201, 2202 Inktober; 2301, 2302 Soul Eater; 2303 e 2304 sem obra',
    [2201, 2202].every((n) => rec(n)?.workId === ink?.id) && [2301, 2302].every((n) => rec(n)?.workId === soul?.id)
      && [2303, 2304].every((n) => rec(n) && rec(n).workId === null),
    [2201, 2202, 2301, 2302, 2303, 2304].map((n) => rec(n)?.workId?.slice(-2) ?? 'null').join())
  check('1301 com o link do vídeo', rec(1301)?.linkUrl === 'https://www.youtube.com/watch?v=jNQXAC9IVRw', rec(1301)?.linkUrl)
  check('2301 com 6 capítulos; 2302 sem medida',
    rec(2301)?.measure?.measureId === id('a000', 8) && rec(2301).measure.values[0]?.quantity === 6 && rec(2302)?.measure === null,
    JSON.stringify([rec(2301)?.measure, rec(2302)?.measure]))

  // Rotas de escrita, recusadas sem mudar nada: os ids passam pelo z.uuid
  const dup = await call('POST', '/works', { title: 'Soul Eater', defaultTagId: id('9000', 910), defaultTaskId: id('8000', 15), measureId: id('a000', 8), total: 113 })
  check('POST repetido: 409 (tag, tarefa e medida do seed aceitas como uuid e conferidas)', dup.status === 409, `${dup.status} ${JSON.stringify(dup.body)}`)
  for (const w of works) {
    const r = await call('PATCH', `/works/${w.id}`, { measureId: null, total: 5 })
    check(`PATCH ${w.title}: 400 "total precisa de uma medida" (achou a obra)`, r.status === 400 && /total precisa/.test(r.body?.error ?? ''), `${r.status} ${JSON.stringify(r.body)}`)
  }
  const after = (await call('GET', '/works')).body.filter((w) => w.id.startsWith('5eed'))
  check('nada mudou nas obras', JSON.stringify(after) === JSON.stringify(works))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
