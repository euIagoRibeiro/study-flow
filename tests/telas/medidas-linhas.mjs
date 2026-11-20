// Painel, medidas dentro das linhas do Tempo (MA2b): abaixo de cada contexto da tabela "Tempo dedicado por
// contexto", uma linha-irmã (<tr data-measure-row>, uma célula com colSpan) com o total de cada medida
// ("105 questões") e, se tem tipos, "acertos: 80 · erros: 20 · sem tipo: 5". Contexto com medida e SEM tempo
// no período vira linha no fim ("0min", sem %, sem comparação, sem botão). Dados próprios (semana de 07/04/2025,
// tests/medidas-dados.mjs com { withTime: true }, a conta à mão lá), inseridos pelo banco e apagados no fim,
// com a conferência por prefixo e pelas contagens totais. Confere também: a tabela continua uma tabela
// (soma dos colSpan = 3 em toda linha), o foco por teclado só para nos botões dos contextos, o texto de
// leitura da linha-irmã, a falha isolada (o Tempo segue, linha discreta com "Tentar de novo"), o carregamento
// próprio e que ?contexto= não refaz o pedido. Limitação registrada: sem tempo no período, só a seção
// "Medidas" mostra a medida (MA2e).
import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
import { launch } from '../sessao.mjs'
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
const R1_ID = '00000000-0000-4000-a0f2-000000000001'

// A sequência da tabela de contextos, linha a linha
const EXPECTED_KINDS = ['tempo', 'medida', 'tempo', 'medida', 'tempo', 'tempo', 'medida', 'so-medida', 'medida', 'so-medida', 'medida']
const EXPECTED_TIME = [
  ['MD R1', '1h45', '40%'], ['MD R4', '1h30', '34%'], ['MD R6', '40min', '15%'], ['MD R3', '30min', '11%'],
]
const EXPECTED_LINES = {
  'MD R1': [['105 questões', 'acertos: 80 · erros: 20 · sem tipo: 5']],
  'MD R4': [['3 etapas', 'kx: 1 · ky: 1 · kz: 1']],
  'MD R3': [['1.001 páginas', 'lidas: 1.000 · sem tipo: 1']],
  'MD R2': [['7,75 km']],
  'MD R5': [['1 capítulo']],
}

let browser
try {
  await seedMedidas(pool, { withTime: true })
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  const requests = []
  let holdMeasures = false
  let failMeasures = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (req.url().startsWith(`${API}/dashboard/`)) requests.push(url)
    const mine = url.pathname.endsWith('/dashboard/medidas-por-contexto')
    if (mine && failMeasures) {
      return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    if (mine && holdMeasures) return setTimeout(() => req.continue(), 1500)
    req.continue()
  })
  const mineRequests = () => requests.filter((u) => u.pathname.endsWith('/dashboard/medidas-por-contexto'))

  const read = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Tempo"]')
    if (!s) return null
    const table = [...s.querySelectorAll('table')].find((t) => t.querySelector('caption')?.textContent.trim() === 'Tempo dedicado por contexto')
    const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) => ({
      kind: tr.hasAttribute('data-measure-row') ? 'medida' : tr.hasAttribute('data-measure-only') ? 'so-medida' : 'tempo',
      cells: [...tr.children].map((td) => ({
        text: td.textContent.replace(/\s+/g, ' ').trim(), colSpan: td.colSpan,
        spans: [...td.querySelectorAll('span.block')].map((b) => b.textContent.trim()),
      })),
      lines: [...tr.querySelectorAll('td > div > div')].map((d) => [...d.querySelectorAll('p')].map((p) => p.textContent.trim())),
      button: tr.querySelector('button')?.textContent.trim() ?? null,
      sr: tr.querySelector('.sr-only')?.textContent.trim() ?? null,
      dot: !!tr.querySelector('span[aria-hidden="true"]'),
    }))
    const alert = s.querySelector('[role="alert"]')
    return {
      rows, header: [...(table?.querySelectorAll('thead th') ?? [])].length,
      total: [...s.querySelectorAll('dt')].find((dt) => dt.textContent.trim() === 'Tempo dedicado')?.nextElementSibling?.textContent.trim() ?? null,
      tables: s.querySelectorAll('table').length,
      alert: alert ? alert.textContent.replace(/\s+/g, ' ').trim() : null,
      text: s.textContent.replace(/\s+/g, ' ').trim(),
      oldBlocks: document.querySelectorAll('section[aria-label="Medidas"] [data-measure-list] > div').length,
      url: location.pathname + location.search,
    }
  })
  // espera o Tempo e (se for o caso) as linhas de medida
  const settle = async ({ measures = true } = {}) => {
    for (let i = 0; i < 80; i++) {
      const r = await read()
      const timeReady = r && (r.rows.some((x) => x.kind === 'tempo') || r.text.includes('Nenhum tempo'))
      if (timeReady && (!measures || r.rows.some((x) => x.kind === 'medida') || r.text.includes('Nenhum tempo'))) return r
      await pause(100)
    }
    return read()
  }
  const open = async (path, opts) => { await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' }); return settle(opts) }
  const week = `/painel?periodo=semana&inicio=${WEEK}`

  // ---- a tabela, linha a linha
  let r = await open(week)
  check('a sequência da tabela: tempo, linha-irmã, … e no fim as linhas só de medida, cada uma com a sua linha-irmã',
    JSON.stringify(r.rows.map((x) => x.kind)) === JSON.stringify(EXPECTED_KINDS), JSON.stringify(r.rows.map((x) => x.kind)))
  const timeRows = r.rows.filter((x) => x.kind === 'tempo')
  check('linhas de tempo: nome, tempo e % do Tempo (4h25 no total)',
    JSON.stringify(timeRows.map((x) => [x.cells[0].text, x.cells[1].spans[0], x.cells[1].spans[1]])) === JSON.stringify(EXPECTED_TIME) && r.total === '4h25',
    JSON.stringify(timeRows.map((x) => [x.cells[0].text, x.cells[1].spans])))
  check('"vs. anterior" das linhas de tempo continua ("novo": sem dado na semana anterior)', timeRows.every((x) => x.cells[2].text === 'novo'), JSON.stringify(timeRows.map((x) => x.cells[2].text)))
  const subRows = r.rows.filter((x) => x.kind === 'medida')
  const owners = []
  r.rows.forEach((row, i) => { if (row.kind === 'medida') owners.push(r.rows[i - 1].cells[0].text) })
  check('o texto de cada linha-irmã: total com unidade em minúsculas e "tipo: número" (R1, R4, R3, R2, R5)',
    JSON.stringify(subRows.map((x, i) => [owners[i], x.lines])) === JSON.stringify(['MD R1', 'MD R4', 'MD R3', 'MD R2', 'MD R5'].map((n) => [n, EXPECTED_LINES[n]])),
    JSON.stringify(subRows.map((x, i) => [owners[i], x.lines])))
  check('contexto com tempo e SEM medida (MD R6) não ganha linha-irmã', r.rows[4].kind === 'tempo' && r.rows[4].cells[0].text === 'MD R6' && r.rows[5].kind === 'tempo')
  check('medida só com valor sem tipo (Km, Capítulos): só o total, sem linha de tipos', subRows[3].lines[0].length === 1 && subRows[4].lines[0].length === 1)

  // ---- as linhas só de medida
  const only = r.rows.filter((x) => x.kind === 'so-medida')
  check('linhas só de medida: "0min", sem %, sem "vs. anterior", sem botão, sem bolinha, por nome',
    JSON.stringify(only.map((x) => [x.cells[0].text, x.cells[1].spans, x.cells[2].text, x.button, x.dot])) === JSON.stringify([['MD R2', ['0min'], '', null, false], ['MD R5', ['0min'], '', null, false]]),
    JSON.stringify(only.map((x) => [x.cells[0].text, x.cells[1].spans, x.cells[2].text, x.button, x.dot])))
  check('as linhas de tempo dos contextos abrem o detalhe (botão com o nome)', JSON.stringify(timeRows.map((x) => x.button)) === JSON.stringify(['MD R1', 'MD R4', 'MD R6', 'MD R3']))

  // ---- a tabela continua uma tabela
  check('toda linha ocupa as 3 colunas (soma dos colSpan = 3) e o cabeçalho tem 3', r.header === 3 && r.rows.every((x) => x.cells.reduce((sum, c) => sum + c.colSpan, 0) === 3), JSON.stringify(r.rows.map((x) => x.cells.map((c) => c.colSpan))))
  check('cada linha-irmã é UMA célula com colSpan 3', subRows.every((x) => x.cells.length === 1 && x.cells[0].colSpan === 3))
  check('leitura: cada linha-irmã começa com "Medidas de {contexto}:" só para leitor de tela',
    JSON.stringify(subRows.map((x) => x.sr)) === JSON.stringify(['MD R1', 'MD R4', 'MD R3', 'MD R2', 'MD R5'].map((n) => `Medidas de ${n}:`)), JSON.stringify(subRows.map((x) => x.sr)))

  // ---- foco por teclado: só os botões dos contextos
  const focused = () => page.evaluate(() => document.activeElement?.textContent.trim() ?? null)
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Tempo"] tbody button')].find((b) => b.textContent.trim() === 'MD R1').focus())
  const seen = [await focused()]
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); seen.push(await focused()) }
  check('Tab percorre só os botões dos contextos, na ordem (as linhas-irmãs não recebem foco)', JSON.stringify(seen) === JSON.stringify(['MD R1', 'MD R4', 'MD R6', 'MD R3']), JSON.stringify(seen))
  await page.keyboard.press('Tab')
  check('o próximo Tab sai da tabela', await page.evaluate(() => !document.activeElement.closest('section[aria-label="Tempo"] table')), String(await focused()))
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  check('Shift+Tab volta ao último botão da tabela (MD R3)', (await focused()) === 'MD R3', String(await focused()))
  check('só 4 elementos focáveis na tabela (os 4 botões)', await page.evaluate(() => document.querySelectorAll('section[aria-label="Tempo"] table button, section[aria-label="Tempo"] table a, section[aria-label="Tempo"] table [tabindex]').length) === 4)

  // ---- os pedidos
  const mine = mineRequests().at(-1)
  check('o pedido de medidas por contexto leva o mesmo período e fuso do Tempo',
    mine?.searchParams.get('de') === '2025-04-07T03:00:00.000Z' && mine.searchParams.get('ate') === '2025-04-14T03:00:00.000Z' && mine.searchParams.get('fuso') === FUSO, String(mine))
  check('a seção "Medidas" antiga continua (5 blocos) até a MA2e', r.oldBlocks === 5, `${r.oldBlocks}`)

  // ---- ?contexto= e ?tags= não refazem o pedido de medidas
  const count = mineRequests().length
  for (const query of [`&contexto=${R1_ID}`, `&tags=${R1_ID}`, '']) {
    await page.evaluate((url) => { history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, `${week}${query}`)
    await pause(900)
  }
  r = await read()
  check('contexto e tags na URL: nenhum pedido novo de medidas por contexto, e as linhas continuam', mineRequests().length === count && r.rows.length === 11, `${mineRequests().length - count} novos, ${r.rows.length} linhas`)

  // ---- carregando: o Tempo já está pronto, as medidas chegam depois
  holdMeasures = true
  await page.goto(`${APP}${week}`, { waitUntil: 'domcontentloaded' })
  let waiting = null
  for (let i = 0; i < 60; i++) {
    const x = await read()
    if (x && x.rows.filter((y) => y.kind === 'tempo').length === 4 && x.rows.every((y) => y.kind === 'tempo') && x.alert === null) { waiting = x; break }
    await pause(50)
  }
  check('enquanto as medidas não chegam: as 4 linhas de tempo já estão, sem linha-irmã e sem alerta', waiting !== null, JSON.stringify(await read()))
  holdMeasures = false
  r = await settle()
  check('depois que chegam, as linhas-irmãs aparecem (11 linhas)', r.rows.length === 11, `${r.rows.length}`)

  // ---- falha isolada: o Tempo segue; Tentar de novo carrega
  failMeasures = true
  r = await open(week, { measures: false })
  await pause(300)
  r = await read()
  check('falha nas medidas: o Tempo segue inteiro (4 linhas, 4h25) e não há linha de medida', r.rows.length === 4 && r.rows.every((x) => x.kind === 'tempo') && r.total === '4h25', `${r.rows.length} ${r.total}`)
  check('falha nas medidas: linha discreta abaixo da tabela, com "Tentar de novo", dentro do Tempo', r.alert === 'Não foi possível carregar as medidas. Tentar de novo', String(r.alert))
  check('falha nas medidas: a seção "Medidas" antiga (outra rota) segue com os 5 blocos', r.oldBlocks === 5, `${r.oldBlocks}`)
  failMeasures = false
  await page.evaluate(() => [...document.querySelector('section[aria-label="Tempo"] [role="alert"]').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tentar de novo').click())
  r = await settle()
  check('Tentar de novo carrega as linhas de medida e some o alerta', r.rows.length === 11 && r.alert === null, `${r.rows.length} ${r.alert}`)

  // ---- período: o seguinte não tem tempo (limitação registrada) e o pedido usa as bordas novas
  const sent = mineRequests().length
  await page.evaluate(() => document.querySelector('button[aria-label="Próximo período"]').click())
  for (let i = 0; i < 40 && mineRequests().length === sent; i++) await pause(50)
  r = await settle({ measures: false })
  check('Próximo período: URL nova, pedido com as bordas da semana seguinte e a tabela de contextos some (sem tempo)',
    r.url === '/painel?periodo=semana&inicio=2025-04-14' && mineRequests().at(-1).searchParams.get('de') === '2025-04-14T03:00:00.000Z' && r.tables === 0 && r.text.includes('Nenhum tempo dedicado'), `${r.url} ${r.tables}`)
  await page.evaluate(() => document.querySelector('button[aria-label="Período anterior"]').click())
  // a tela do período vazio ainda mostra "Nenhum tempo": espera a URL voltar antes de ler
  await page.waitForFunction((w) => location.search.includes(`inicio=${w}`), {}, WEEK)
  r = await settle()
  check('Período anterior: volta às 11 linhas', r.rows.length === 11, `${r.rows.length}`)
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
