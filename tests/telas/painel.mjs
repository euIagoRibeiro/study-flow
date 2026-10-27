// D3a: aba Painel, seletor Semana | Mês (na URL), total de tempo dedicado,
// aviso da sessão rodando, nota de sobreposição e a tabela por contexto. A
// tela é comparada com a API do mesmo período (a API foi provada no D2).
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
// Mesmo formato da tela (formatDuration)
const duration = (seconds) => {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}min`
}
// Datas locais de Brasília (−03) sem depender do fuso desta máquina
const local = (ymd) => new Date(`${ymd}T00:00:00-03:00`)
const ymdOf = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10)
const addDays = (ymd, n) => ymdOf(new Date(local(ymd).getTime() + n * 86400e3 + 12 * 3600e3))
const todayYmd = ymdOf(new Date())
// Dia da semana do meio-dia local (0 = domingo): segunda = volta (dia + 6) % 7
const mondayOf = (ymd) => addDays(ymd, -((new Date(local(ymd).getTime() + 12 * 3600e3).getUTCDay() + 6) % 7))
const firstOfMonth = (ymd) => `${ymd.slice(0, 8)}01`
const nextMonth = (ymd) => {
  const [y, m] = ymd.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}
async function apiFor(start, end) {
  const q = new URLSearchParams({ de: local(start).toISOString(), ate: local(end).toISOString(), fuso: FUSO })
  return (await fetch(`${API}/dashboard/tempo-por-contexto?${q}`)).json()
}

const tags = await (await fetch(`${API}/tags`)).json()
const nameOf = (id) => (id === null ? '(sem tag)' : tags.find((t) => t.id === id)?.name)
const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  const requests = []
  // Falha TODOS os pedidos enquanto ligado: em dev, o StrictMode roda o efeito
  // duas vezes ao montar, e o 1º pedido (descartado pela limpeza) levaria o 500
  let failing = false
  // Segura (1,5s) a resposta do período que começa em holdDe
  let holdDe = null
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().startsWith(`${API}/dashboard/`)) {
      requests.push(new URL(req.url()))
      if (holdDe && new URL(req.url()).searchParams.get('de') === holdDe) {
        return setTimeout(() => req.continue(), 1500)
      }
      if (failing) {
        return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
      }
    }
    req.continue()
  })
  const screen = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Tempo"]')
    const rows = [...(s?.querySelectorAll('table tbody tr') ?? [])].map((tr) => ((tds) => [tds[0]?.textContent.trim(), tds[1]?.querySelector('span.block')?.textContent.trim(), tds[1]?.querySelector('span.block + span.block')?.textContent.trim(), tds[2] ? [...tds[2].querySelectorAll('span.block')].map((b) => b.textContent.trim()).join(' ') : undefined])([...tr.children]))
    return {
      period: document.querySelector('[role="group"][aria-label="Navegar no período"] p')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      total: [...(s?.querySelectorAll('dt') ?? [])].find((dt) => dt.textContent.trim() === 'Tempo dedicado')?.nextElementSibling?.textContent.trim() ?? null,
      text: s?.textContent.replace(/\s+/g, ' ') ?? '',
      rows,
      url: location.pathname + location.search,
      nextDisabled: document.querySelector('button[aria-label="Próximo período"]')?.disabled ?? null,
    }
  })
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await screen()
      if (s.total !== null || /Nenhum tempo|Não foi possível/.test(s.text)) return s
      await pause(100)
    }
    return screen()
  }
  // Clica e espera o RÓTULO do período mudar antes de ler (o total do
  // período anterior já estava na tela, e a URL muda antes do React desenhar:
  // com o computador carregado, a semana anterior era lida ainda como a atual)
  const periodText = () => page.evaluate(() => document.querySelector('[role="group"][aria-label="Navegar no período"] p')?.textContent.replace(/\s+/g, ' ').trim() ?? null)
  const act = async (fn) => {
    const before = await periodText()
    await page.evaluate(fn)
    for (let i = 0; i < 40 && (await periodText()) === before; i++) await pause(50)
  }
  const matches = (label, s, api) => {
    const expected = api.items.map((x) => [nameOf(x.tagId), duration(x.seconds)])
    // as linhas do período primeiro; depois as só do anterior (D6), com 0min
    const got = s.rows.slice(0, api.items.length).map((r) => [r[0], r[1]])
    const extra = s.rows.slice(api.items.length)
    check(`${label}: total = API (${duration(api.totalSeconds)})`, s.total === duration(api.totalSeconds), `${s.total}`)
    check(`${label}: tabela = itens da API, na ordem`, JSON.stringify(got) === JSON.stringify(expected) && extra.every((r) => r[1] === '0min'), `${JSON.stringify(s.rows)} x ${JSON.stringify(expected)}`)
  }

  // ---- aba na navegação
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
  const nav = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Principal"] a')].map((a) => [a.textContent.trim(), a.getAttribute('href')]))
  check('navegação: 4 abas, Painel por último, no mesmo nível', JSON.stringify(nav) === JSON.stringify([['Lista', '/'], ['Executar', '/executar'], ['Histórico', '/historico'], ['Painel', '/painel']]), JSON.stringify(nav))
  await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Principal"] a')].find((a) => a.textContent.trim() === 'Painel').click())
  let s = await settle()
  check('clicar em Painel abre /painel', s.url.startsWith('/painel'), s.url)

  // ---- semana atual (padrão)
  const mon = mondayOf(todayYmd)
  const sun = addDays(mon, 6)
  const sem = await apiFor(mon, addDays(mon, 7))
  // A semana atual tem a sessão rodando do seed: o total cresce enquanto a
  // bateria roda. Comparar com a API de AGORA (a tela buscou um instante antes:
  // aceita também o minuto anterior), não com a de lá do começo
  const currentWeek = async () => {
    const t = (await apiFor(mon, addDays(mon, 7))).totalSeconds
    return [duration(t), duration(t - 60)]
  }
  check('padrão: semana atual, de segunda a domingo', s.period?.includes(String(Number(mon.slice(8)))) && s.period?.includes(String(Number(sun.slice(8)))), `${s.period} (${mon}..${sun})`)
  matches('semana atual', s, sem)
  const req = requests.filter((u) => u.pathname.endsWith('tempo-por-contexto')).slice(-2)[0]
  check('pedido: fuso do aparelho e bordas na meia-noite local (segunda → segunda)',
    req?.searchParams.get('fuso') === FUSO && req.searchParams.get('de') === local(mon).toISOString() && req.searchParams.get('ate') === local(addDays(mon, 7)).toISOString(),
    req?.search)
  check('"tempo dedicado" escrito', /tempo dedicado/i.test(s.text))
  check('próximo período desabilitado na semana atual', s.nextDisabled === true)
  const run = sem.running[0]
  // (os minutos correm entre a API e a tela: confere a frase e a tarefa)
  check('aviso: sessão rodando, com a tarefa e há quanto tempo', !!run && /Inclui 1 sessão rodando há \d+(h\d\d|min)/.test(s.text) && s.text.includes(run.taskTitle), s.text.slice(0, 200))
  check('nota de "em paralelo" só se a API disse que há sobreposição', s.text.includes('em paralelo') === sem.overlap, `${sem.overlap}`)
  const pct = s.rows.map((r) => r[2])
  check('coluna %: um valor por linha, terminando em %', pct.length > 0 && pct.every((p) => /^(<1|\d+)%$/.test(p)), JSON.stringify(pct))

  // ---- semana anterior: URL, totais, voltar do navegador
  await act(() => document.querySelector('button[aria-label="Período anterior"]').click())
  s = await settle()
  const prev = addDays(mon, -7)
  check('anterior: URL ?periodo=semana&inicio=<segunda anterior>', s.url === `/painel?periodo=semana&inicio=${prev}`, s.url)
  matches('semana anterior', s, await apiFor(prev, mon))
  check('próximo período habilitado no passado', s.nextDisabled === false)
  check('semana anterior: sem aviso de rodando', !s.text.includes('rodando'))
  await page.goBack({ waitUntil: 'networkidle0' })
  s = await settle()
  check('voltar do navegador volta pra semana atual', s.url === '/painel' && (await currentWeek()).includes(s.total), `${s.url} ${s.total}`)

  // ---- mês
  await act(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mês').click())
  s = await settle()
  const m1 = firstOfMonth(todayYmd)
  check('Mês: URL ?periodo=mes&inicio=<dia 1>', s.url === `/painel?periodo=mes&inicio=${m1}`, s.url)
  matches('mês atual', s, await apiFor(m1, nextMonth(m1)))
  const monthName = new Date(`${m1}T12:00:00-03:00`).toLocaleDateString('pt-BR', { month: 'long', timeZone: FUSO })
  check('rótulo do mês por extenso', s.period?.toLowerCase().includes(monthName), `${s.period} (${monthName})`)
  await act(() => document.querySelector('button[aria-label="Período anterior"]').click())
  s = await settle()
  const [y, m] = m1.split('-').map(Number)
  const m0 = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  matches('mês anterior', s, await apiFor(m0, m1))

  // ---- URL direta: recarregar mantém; vazio; inválido cai na semana atual
  await page.goto(`${APP}/painel?periodo=semana&inicio=${prev}`, { waitUntil: 'networkidle0' })
  s = await settle()
  matches('URL direta (recarregar)', s, await apiFor(prev, mon))
  await page.goto(`${APP}/painel?periodo=semana&inicio=2025-01-06`, { waitUntil: 'networkidle0' })
  s = await settle()
  check('período sem tempo: "Nenhum tempo dedicado nesta semana."', s.text.includes('Nenhum tempo dedicado nesta semana.') && s.rows.length === 0, s.text.slice(0, 120))
  await page.goto(`${APP}/painel?periodo=quinzena&inicio=ontem`, { waitUntil: 'networkidle0' })
  s = await settle()
  check('URL inválida: cai na semana atual', (await currentWeek()).includes(s.total), `${s.url} ${s.total}`)
  await page.goto(`${APP}/painel?periodo=semana&inicio=2025-03-26`, { waitUntil: 'networkidle0' })
  s = await settle()
  const r2 = requests.filter((u) => u.pathname.endsWith('tempo-por-contexto')).slice(-2)[0]
  check('início no meio da semana: ajusta pra segunda (24/03)', r2?.searchParams.get('de') === local('2025-03-24').toISOString(), r2?.search)

  // ---- corrida: a resposta da semana anterior chega DEPOIS da atual
  await page.goto(`${APP}/painel?periodo=semana&inicio=${prev}`, { waitUntil: 'networkidle0' })
  await settle()
  holdDe = local(addDays(prev, -7)).toISOString()
  await page.evaluate(() => document.querySelector('button[aria-label="Período anterior"]').click())
  await pause(150)
  await page.evaluate(() => document.querySelector('button[aria-label="Próximo período"]').click())
  await pause(2500)
  s = await settle()
  check('corrida: resposta velha chegando por último não substitui a do período na tela', s.total === duration((await apiFor(prev, mon)).totalSeconds) && s.url === `/painel?periodo=semana&inicio=${prev}`, `${s.url} ${s.total} ${s.text.slice(0, 60)}`)
  holdDe = null

  // ---- erro e Tentar de novo
  failing = true
  await page.goto(`${APP}/painel`, { waitUntil: 'networkidle0' })
  s = await settle()
  check('erro da API: mensagem + Tentar de novo', s.text.includes('Não foi possível carregar o painel') && s.text.includes('Tentar de novo'), s.text.slice(0, 120))
  failing = false
  await page.evaluate(() => [...document.querySelector('section[aria-label="Tempo"]').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tentar de novo').click())
  s = await settle()
  check('Tentar de novo carrega', (await currentWeek()).includes(s.total), `${s.total}`)
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
