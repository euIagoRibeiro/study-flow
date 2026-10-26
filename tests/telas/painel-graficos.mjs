// D3b: pizza por contexto (cores de categoria pela ordem da tabela, que é a
// legenda; % ao lado das fatias grandes; "outros" depois da 5ª), barras do
// período (valor em cima de cada barra) e o detalhe de um contexto na mesma
// página (?contexto=): subtags, e fases se o contexto usa. Compara com a API.
// Só lê: nada é gravado.
import puppeteer from 'puppeteer-core'
import { API, APP, CHROME } from '../config.mjs'

const FUSO = 'America/Sao_Paulo'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const duration = (seconds) => {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}min`
}
const local = (ymd) => new Date(`${ymd}T00:00:00-03:00`)
const ymdOf = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10)
const addDays = (ymd, n) => ymdOf(new Date(local(ymd).getTime() + n * 86400e3 + 12 * 3600e3))
const mondayOf = (ymd) => addDays(ymd, -((new Date(local(ymd).getTime() + 12 * 3600e3).getUTCDay() + 6) % 7))
const api = async (route, params) => (await fetch(`${API}/dashboard/${route}?${new URLSearchParams(params)}`)).json()
const phaseLabels = { requisitos: 'Requisitos', prototipo: 'Protótipo', validacao: 'Validação', implementacao: 'Implementação' }

const tags = await (await fetch(`${API}/tags`)).json()
const byName = (n) => tags.find((t) => t.name === n && t.level === 1)
const nameOf = (id) => (id === null ? '(sem tag)' : tags.find((t) => t.id === id)?.name)
// Semana passada: completa, com Código (fases), Vestibular e outros (seed D1 + antigo)
const mon = mondayOf(ymdOf(new Date()))
const prev = addDays(mon, -7)
const period = { de: local(prev).toISOString(), ate: local(mon).toISOString(), fuso: FUSO }

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  // Resposta trocada (pro caso "outros"): itens com 8 contextos/tags
  let fakeItems = null
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    if (fakeItems && req.url().startsWith(`${API}/dashboard/tempo-por-contexto`)) {
      const items = fakeItems
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ totalSeconds: items.reduce((s, x) => s + x.seconds, 0), overlap: false, running: [], items }) })
    }
    req.continue()
  })
  const read = (sectionLabel) => page.evaluate((label) => {
    const s = document.querySelector(`section[aria-label="${label}"]`)
    if (!s) return null
    const pie = s.querySelector('svg[role="img"][aria-label^="Pizza"]')
    const bars = s.querySelector('svg[role="img"][aria-label^="Barras"]')
    const table = s.querySelector('table')
    return {
      pieLabel: pie?.getAttribute('aria-label') ?? null,
      slices: [...(pie?.querySelectorAll('path') ?? [])].map((p) => getComputedStyle(p).fill),
      pieTexts: [...(pie?.querySelectorAll('text') ?? [])].map((t) => t.textContent.trim()),
      rows: [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) => ({
        cells: ((tds) => [tds[0]?.textContent.trim(), tds[1]?.querySelector('span.block')?.textContent.trim(), tds[1]?.querySelector('span.block + span.block')?.textContent.trim(), tds[2] ? [...tds[2].querySelectorAll('span.block')].map((b) => b.textContent.trim()).join(' ') : undefined])([...tr.children]),
        dot: (() => { const d = tr.querySelector('td span[aria-hidden="true"]'); return d ? getComputedStyle(d).backgroundColor : null })(),
        button: !!tr.querySelector('button'),
      })),
      bars: [...(bars?.querySelectorAll('rect') ?? [])].length,
      barTexts: [...(bars?.querySelectorAll('text') ?? [])].map((t) => t.textContent.trim()),
      phaseRows: [...(s.querySelectorAll('table') ?? [])].slice(1).flatMap((t) => [...t.querySelectorAll('tbody tr')].map((tr) => ((tds) => [tds[0]?.textContent.trim(), tds[1]?.querySelector('span.block')?.textContent.trim(), tds[1]?.querySelector('span.block + span.block')?.textContent.trim(), tds[2] ? [...tds[2].querySelectorAll('span.block')].map((b) => b.textContent.trim()).join(' ') : undefined])([...tr.children]))),
      text: s.textContent.replace(/\s+/g, ' '),
    }
  }, sectionLabel)
  const settle = async (label) => {
    for (let i = 0; i < 50; i++) {
      const r = await read(label)
      if (r && (r.rows.length > 0 || /Nenhum tempo/.test(r.text))) return r
      await pause(100)
    }
    return read(label)
  }
  // Cores das variáveis no tema da página (o computed do fill/background vem em rgb)
  const palette = () => page.evaluate(() => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const out = ['1', '2', '3', '4', '5', 'outros'].map((n) => {
      probe.style.color = `var(--categoria-${n})`
      return getComputedStyle(probe).color
    })
    probe.remove()
    return out
  })

  // ---- semana passada: pizza, legenda, barras
  await page.goto(`${APP}/painel?periodo=semana&inicio=${prev}`, { waitUntil: 'networkidle0' })
  let r = await settle('Tempo')
  const ctx = await api('tempo-por-contexto', period)
  const colors = await palette()
  check('paleta: 6 cores distintas definidas (--categoria-1..5 e -outros)', new Set(colors).size === 6 && colors.every((c) => c.startsWith('rgb')), JSON.stringify(colors))
  check('pizza com nome acessível', /^Pizza do tempo por contexto/.test(r.pieLabel ?? ''), r.pieLabel)
  check('uma fatia por item (até 6)', r.slices.length === Math.min(ctx.items.length, 6), `${r.slices.length} x ${ctx.items.length}`)
  check('fatias nas cores da ordem: 1ª = --categoria-1, 2ª = --categoria-2…', JSON.stringify(r.slices) === JSON.stringify(colors.slice(0, r.slices.length)), JSON.stringify(r.slices))
  check('legenda: a bolinha de cada linha tem a cor da fatia dela', r.rows.every((row, i) => row.dot === (i >= ctx.items.length ? null : i < 5 ? colors[i] : colors[5])), JSON.stringify(r.rows.map((x) => x.dot)))
  check('tabela = itens da API, na ordem', JSON.stringify(r.rows.slice(0, ctx.items.length).map((x) => [x.cells[0], x.cells[1]])) === JSON.stringify(ctx.items.map((x) => [nameOf(x.tagId), duration(x.seconds)])), JSON.stringify(r.rows.map((x) => x.cells)))
  const big = ctx.items.filter((x) => x.seconds / ctx.totalSeconds >= 0.1).map((x) => `${Math.round((x.seconds / ctx.totalSeconds) * 100)}%`)
  check('% ao lado das fatias grandes (≥ 10%), igual ao da tabela', JSON.stringify(r.pieTexts) === JSON.stringify(big), `${JSON.stringify(r.pieTexts)} x ${JSON.stringify(big)}`)
  const days = await api('tempo-por-periodo', { ...period, por: 'dia' })
  check('barras: 7 (de segunda a domingo)', r.bars === 7, String(r.bars))
  const dayLabels = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
  const expectedBarTexts = days.items.flatMap((x, i) => (x.seconds > 0 ? [duration(x.seconds), dayLabels[i]] : [dayLabels[i]]))
  check('barras: valor em cima de cada dia com tempo, e o dia embaixo (= API)', JSON.stringify(r.barTexts) === JSON.stringify(expectedBarTexts), `${JSON.stringify(r.barTexts)} x ${JSON.stringify(expectedBarTexts)}`)
  check('(sem tag) não abre detalhe; contextos abrem', r.rows.every((row) => row.button === (row.cells[0] !== '(sem tag)')), JSON.stringify(r.rows.map((x) => [x.cells[0], x.button])))

  // ---- mês: barras por semana
  const m1 = `${ymdOf(new Date()).slice(0, 8)}01`
  await page.goto(`${APP}/painel?periodo=mes&inicio=${m1}`, { waitUntil: 'networkidle0' })
  r = await settle('Tempo')
  const [y, m] = m1.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const weeks = await api('tempo-por-periodo', { de: local(m1).toISOString(), ate: local(next).toISOString(), fuso: FUSO, por: 'semana' })
  check('mês: uma barra por semana (= API)', r.bars === weeks.items.length && r.bars >= 4, `${r.bars} x ${weeks.items.length}`)

  // ---- detalhe: Código (com fases) e Exercícios (sem fases)
  await page.goto(`${APP}/painel?periodo=semana&inicio=${prev}`, { waitUntil: 'networkidle0' })
  await settle('Tempo')
  const codigo = byName('Código')
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Tempo"] tbody button')].find((b) => b.textContent.trim() === 'Código').click())
  let d = await settle('Em Código')
  const url = await page.evaluate(() => location.search)
  check('tocar em Código: ?contexto= na URL, seção "Em Código" na mesma página', url === `?periodo=semana&inicio=${prev}&contexto=${codigo.id}` && d !== null, `${url}`)
  const sub = await api('tempo-por-subtag', { ...period, contexto: codigo.id })
  check('Em Código: subtags = API (nome e tempo, na ordem; null = "(sem subtag)")',
    JSON.stringify(d.rows.slice(0, sub.items.length).map((x) => [x.cells[0], x.cells[1]])) === JSON.stringify(sub.items.map((x) => [x.tagId === null ? '(sem subtag)' : tags.find((t) => t.id === x.tagId)?.name, duration(x.seconds)])),
    `${JSON.stringify(d.rows.map((x) => x.cells))} x ${JSON.stringify(sub.items)}`)
  check('Em Código: pizza das subtags', /^Pizza do tempo por subtag/.test(d.pieLabel ?? '') && d.slices.length === Math.min(sub.items.length, 6), `${d.pieLabel} ${d.slices.length}`)
  const ph = await api('tempo-por-fase', { ...period, contexto: codigo.id })
  check('Em Código: tabela de fases = API (rótulos da tela; null = "(sem fase)")',
    JSON.stringify(d.phaseRows.map((x) => [x[0], x[1]])) === JSON.stringify(ph.items.map((x) => [x.phase === null ? '(sem fase)' : phaseLabels[x.phase], duration(x.seconds)])),
    `${JSON.stringify(d.phaseRows)} x ${JSON.stringify(ph.items)}`)
  await page.goBack({ waitUntil: 'networkidle0' })
  await pause(300)
  check('voltar do navegador fecha o detalhe', (await read('Em Código')) === null && (await page.evaluate(() => location.search)) === `?periodo=semana&inicio=${prev}`)
  const exerc = byName('Exercícios')
  await page.goto(`${APP}/painel?periodo=semana&inicio=${prev}&contexto=${exerc.id}`, { waitUntil: 'networkidle0' })
  d = await settle('Em Exercícios')
  check('URL direta com ?contexto=: detalhe aberto; Exercícios (sem fases) sem tabela de fases', d !== null && d.phaseRows.length === 0 && !/fase/i.test(d.text), d?.text.slice(0, 120))
  await page.evaluate(() => [...document.querySelector('section[aria-label="Em Exercícios"]').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fechar').click())
  await pause(300)
  check('Fechar tira o detalhe e o ?contexto=', (await read('Em Exercícios')) === null && !(await page.evaluate(() => location.search)).includes('contexto'))

  // ---- "outros": 8 itens → 5 cores + 1 fatia cinza; tabela com as 8 linhas
  const ids = tags.filter((t) => t.active).slice(0, 8).map((t) => t.id)
  fakeItems = ids.map((id, i) => ({ tagId: id, seconds: (9 - i) * 3600 }))
  await page.goto(`${APP}/painel?periodo=semana&inicio=${prev}`, { waitUntil: 'networkidle0' })
  r = await settle('Tempo')
  check('"outros": 8 itens = 6 fatias (5 cores + cinza)', r.slices.length === 6 && JSON.stringify(r.slices) === JSON.stringify(colors), JSON.stringify(r.slices))
  check('"outros": tabela com as 8 linhas; da 6ª em diante, bolinha cinza', r.rows.length === 8 && r.rows.slice(5).every((x) => x.dot === colors[5]), JSON.stringify(r.rows.map((x) => x.dot)))
  fakeItems = null
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
