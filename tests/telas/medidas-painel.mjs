// Painel, medidas (MA4): seção "Medidas" entre "Tempo" e "Comparar tags". Dados próprios (semana de
// 07/04/2025, tests/medidas-dados.mjs, com a conta à mão lá) inseridos pelo banco e apagados no fim, com a
// conferência por prefixo e pelas contagens totais. Confere: ordem e títulos, cada bloco (total com o
// nº de registros, tabela por tipo só quando há linhas de tipo, "(sem tipo)" como linha, % pelo percent()
// do Tempo, que pode somar 99), a tela = a API, os pedidos (período e fuso), período vazio por tipo de
// período, carregamento e erro próprios (o Tempo segue), Tentar de novo, e que ?contexto= e ?tags= não
// refazem o pedido (a seção é global até a MA2).
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { apiFetch, launch } from '../sessao.mjs'
import { cleanMedidas, counts, leftovers, seedMedidas, WEEK } from '../medidas-dados.mjs'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente: rode com --env-file=backend/.env (os dados são inseridos pelo banco)')
  process.exit(2)
}
const FUSO = 'America/Sao_Paulo'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
if (Object.values(await leftovers(pool)).some((n) => n > 0)) await cleanMedidas(pool) // rodada interrompida
const before = await counts(pool)

const EXPECTED = [
  { title: 'Páginas', total: '1.001 Páginas', records: '1 registro', rows: [['Lidas', '1.000', '100%'], ['(sem tipo)', '1', '<1%']] },
  { title: 'Questões', total: '105 Questões', records: '2 registros', rows: [['Acertos', '80', '76%'], ['Erros', '20', '19%'], ['(sem tipo)', '5', '5%']] },
  { title: 'Km', total: '7,75 Km', records: '2 registros', rows: null },
  { title: 'Etapas', total: '3 Etapas', records: '1 registro', rows: [['Kx', '1', '33%'], ['Ky', '1', '33%'], ['Kz', '1', '33%']] },
  { title: 'Capítulos', total: '1 capítulo', records: '1 registro', rows: null },
]

let browser
try {
  await seedMedidas(pool)
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  const requests = []
  let holdMeasures = false
  let failMeasures = false
  let failTime = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = new URL(req.url())
    const isMeasures = req.url().startsWith(`${API}/dashboard/medidas`)
    if (req.url().startsWith(`${API}/dashboard/`)) requests.push(url)
    const fail = (isMeasures && failMeasures) || (!isMeasures && req.url().startsWith(`${API}/dashboard/`) && failTime)
    if (fail) {
      return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    if (isMeasures && holdMeasures) return setTimeout(() => req.continue(), 1500)
    req.continue()
  })
  const measureRequests = () => requests.filter((u) => u.pathname.endsWith('/dashboard/medidas'))

  const read = () => page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Medidas"]')
    if (!section) return null
    const blocks = [...section.querySelectorAll(':scope > [data-measure-list] > div')].map((div) => {
      const ps = div.querySelectorAll(':scope > p')
      const table = div.querySelector('table')
      return {
        title: div.querySelector(':scope > h3')?.textContent.trim(),
        total: ps[0]?.textContent.replace(/\s+/g, ' ').trim(),
        records: ps[1]?.textContent.trim(),
        rows: table ? [...table.querySelectorAll('tbody tr')].map((tr) => [tr.children[0].textContent.trim(), tr.children[1].querySelector('span.block').textContent.trim(), tr.children[1].querySelector('span.block + span.block').textContent.trim()]) : null,
        caption: table?.querySelector('caption')?.textContent.trim() ?? null,
      }
    })
    return {
      text: section.textContent.replace(/\s+/g, ' ').trim(),
      h2: section.querySelector('h2')?.textContent.trim(),
      h3: section.querySelectorAll('h3').length,
      blocks,
      alert: section.querySelector('[role="alert"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      url: location.pathname + location.search,
      timeText: document.querySelector('section[aria-label="Tempo"]')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
    }
  })
  const settle = async () => {
    for (let i = 0; i < 60; i++) {
      const s = await read()
      if (s && !s.text.includes('Carregando')) return s
      await pause(100)
    }
    return read()
  }
  const open = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
    return settle()
  }
  const week = `/painel?periodo=semana&inicio=${WEEK}`

  // ---- ordem, títulos e blocos
  let s = await open(week)
  check('os blocos: total + registros, tabela por tipo só com linhas de tipo, "(sem tipo)" linha, % do percent()',
    JSON.stringify(s.blocks.map(({ caption, ...rest }) => rest)) === JSON.stringify(EXPECTED), JSON.stringify(s.blocks))
  check('seção com h2 "Medidas" e um h3 por medida (5)', s.h2 === 'Medidas' && s.h3 === 5, `${s.h2} ${s.h3}`)
  check('medida só com valor sem tipo: sem tabela (Km, Capítulos)', s.blocks[2].rows === null && s.blocks[4].rows === null)
  check('os % podem somar 99 (Etapas: 33% três vezes)', s.blocks[3].rows.map((r) => parseInt(r[2], 10)).reduce((a, b) => a + b, 0) === 99)
  check('cada tabela tem legenda com o nome da medida', s.blocks[1].caption === 'Quantidade por tipo em Questões', String(s.blocks[1].caption))
  const order = await page.evaluate(() => [...document.querySelectorAll('main section[aria-label], section[aria-label]')].map((el) => el.getAttribute('aria-label')).filter((l) => ['Tempo', 'Medidas', 'Comparar tags'].includes(l)))
  check('a seção fica entre "Tempo" e "Comparar tags"', JSON.stringify(order) === JSON.stringify(['Tempo', 'Medidas', 'Comparar tags']), JSON.stringify(order))

  // ---- a tela = a API do mesmo período
  const q = new URLSearchParams({ de: new Date('2025-04-07T00:00:00-03:00').toISOString(), ate: new Date('2025-04-14T00:00:00-03:00').toISOString(), fuso: FUSO })
  const api = await (await apiFetch(`${API}/dashboard/medidas?${q}`)).json()
  const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  const fromApi = api.items.map((m) => [m.name, `${fmt(m.total)} ${m.total === 1 ? m.singular : m.name}`, m.kinds.map((k) => [k.name ?? '(sem tipo)', fmt(k.quantity)])])
  const fromScreen = s.blocks.map((b) => [b.title, b.total, (b.rows ?? []).map((r) => [r[0], r[1]])])
  check('tela = API: nomes, totais e quantidades por tipo, na ordem da API', JSON.stringify(fromApi) === JSON.stringify(fromScreen), JSON.stringify(fromApi))

  // ---- os pedidos
  const mine = measureRequests().at(-1)
  const sameAsTime = requests.some((u) => u.pathname.endsWith('tempo-por-contexto') &&
    u.searchParams.get('de') === mine?.searchParams.get('de') && u.searchParams.get('ate') === mine?.searchParams.get('ate') && u.searchParams.get('fuso') === FUSO)
  check('o pedido leva o mesmo período e fuso do Tempo (de, ate, fuso)',
    mine?.searchParams.get('de') === '2025-04-07T03:00:00.000Z' && mine.searchParams.get('ate') === '2025-04-14T03:00:00.000Z' &&
      mine.searchParams.get('fuso') === FUSO && sameAsTime,
    String(mine))

  // ---- outros tipos de período: dia, mês, ano
  s = await open(`/painel?periodo=dia&inicio=2025-04-08`)
  check('dia 08/04: só Questões (Acertos 80, Erros 20 = 100, 1 registro; 80% e 20%)',
    JSON.stringify(s.blocks.map(({ caption, ...rest }) => rest)) === JSON.stringify([{ title: 'Questões', total: '100 Questões', records: '1 registro', rows: [['Acertos', '80', '80%'], ['Erros', '20', '20%']] }]), JSON.stringify(s.blocks))
  s = await open(`/painel?periodo=mes&inicio=2025-04-01`)
  check('mês de abril: os 5 blocos da semana (mesmos totais)', JSON.stringify(s.blocks.map((b) => [b.title, b.total])) === JSON.stringify(EXPECTED.map((b) => [b.title, b.total])), JSON.stringify(s.blocks.map((b) => b.title)))
  s = await open(`/painel?periodo=ano&inicio=2025-01-01`)
  check('ano de 2025: os 5 blocos', s.blocks.length === 5 && s.blocks[0].total === '1.001 Páginas', JSON.stringify(s.blocks.map((b) => b.title)))

  // ---- vazio, com o fim da frase de cada tipo de período
  for (const [path, noun] of [['/painel?periodo=semana&inicio=2025-01-06', 'nesta semana'], ['/painel?periodo=dia&inicio=2025-04-14', 'neste dia'], ['/painel?periodo=mes&inicio=2025-02-01', 'neste mês'], ['/painel?periodo=ano&inicio=2023-01-01', 'neste ano']]) {
    s = await open(path)
    check(`período vazio: "Nenhuma medida registrada ${noun}."`, s.text.includes(`Nenhuma medida registrada ${noun}.`) && s.blocks.length === 0, s.text)
  }

  // ---- navegar: o período seguinte refaz o pedido com as bordas novas
  await open(week)
  const sent = measureRequests().length
  await page.evaluate(() => document.querySelector('button[aria-label="Próximo período"]').click())
  for (let i = 0; i < 40 && measureRequests().length === sent; i++) await pause(50)
  s = await settle()
  check('Próximo período: URL nova, pedido com as bordas da semana seguinte e a seção vazia',
    s.url === '/painel?periodo=semana&inicio=2025-04-14' && measureRequests().at(-1).searchParams.get('de') === '2025-04-14T03:00:00.000Z' && s.text.includes('Nenhuma medida registrada nesta semana.'), `${s.url} ${s.text}`)
  await page.evaluate(() => document.querySelector('button[aria-label="Período anterior"]').click())
  for (let i = 0; i < 60; i++) { s = await settle(); if (s.blocks.length === 5) break; await pause(100) }
  check('Período anterior: volta aos 5 blocos', s.blocks.length === 5, s.text)

  // ---- carregando: a seção espera sozinha, o Tempo já está pronto
  holdMeasures = true
  await page.goto(`${APP}${week}`, { waitUntil: 'domcontentloaded' })
  let loading = null
  for (let i = 0; i < 40; i++) {
    const r = await read()
    if (r && r.text.includes('Carregando') && !r.timeText.includes('Carregando') && r.timeText.includes('Nenhum tempo')) { loading = r; break }
    await pause(50)
  }
  check('carregando: "Carregando…" só na seção Medidas, com o Tempo já pronto', loading !== null, JSON.stringify(await read()))
  holdMeasures = false
  s = await settle()
  check('depois da espera os blocos aparecem', s.blocks.length === 5, s.text)

  // ---- erro só nas medidas: o Tempo segue; Tentar de novo carrega
  failMeasures = true
  s = await open(week)
  check('erro nas medidas: alerta próprio, o Tempo continua sem alerta', s.alert?.includes('Não foi possível carregar as medidas.') && s.alert.includes('Tentar de novo') && !s.timeText.includes('Não foi possível'), `${s.alert} | ${s.timeText}`)
  failMeasures = false
  await page.evaluate(() => [...document.querySelector('section[aria-label="Medidas"]').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tentar de novo').click())
  s = await settle()
  check('Tentar de novo (da seção) carrega os blocos', s.blocks.length === 5 && s.alert === null, s.text)

  // ---- erro só no Tempo: as medidas aparecem
  failTime = true
  s = await open(week)
  check('erro no Tempo: as medidas continuam na tela', s.blocks.length === 5 && s.alert === null && s.timeText.includes('Não foi possível carregar o painel'), `${s.blocks.length} ${s.timeText}`)
  failTime = false

  // ---- o contexto aberto e as tags escolhidas não refazem o pedido (a seção é global até a MA2)
  s = await open(week)
  const tags = await (await apiFetch(`${API}/tags`)).json()
  const root = tags.find((t) => t.level === 1 && t.name === 'Código') ?? tags.find((t) => t.level === 1)
  const count = measureRequests().length
  for (const query of [`&contexto=${root.id}`, `&tags=${root.id}`, `&contexto=${root.id}&tags=${root.id}`]) {
    await page.evaluate((url) => { history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, `${week}${query}`)
    await pause(900)
  }
  s = await read()
  check('contexto e tags na URL: nenhum pedido novo de medidas, blocos iguais', measureRequests().length === count && s.blocks.length === 5 && JSON.stringify(s.blocks.map((b) => b.total)) === JSON.stringify(EXPECTED.map((b) => b.total)), `${measureRequests().length - count} novos`)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser?.close()
  await cleanMedidas(pool)
  const left = await leftovers(pool)
  check('nenhuma linha com o prefixo dos dados temporários', Object.values(left).every((n) => n === 0), JSON.stringify(left))
  const after = await counts(pool)
  check('as contagens totais das tabelas voltaram ao valor de antes', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  await pool.end()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
