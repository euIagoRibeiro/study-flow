// D7b: seção "Comparar tags" do Painel. Busca pelo caminho (sem acento), as
// duas Álgebras de raízes diferentes lado a lado, ordem e cor pela escolha
// (estável ao trocar o período), tabela e "Juntas" = API, aviso de aninhada,
// arquivada na busca, limite de 5, URL (?tags=) com período, detalhe, voltar
// e lixo na URL, erro + Tentar de novo. Só lê: nada é gravado.
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
// A regra do D6, escrita de novo aqui
const diffOf = (cur, prev) => {
  if (prev === 0) return cur === 0 ? 'igual' : 'novo'
  if (cur === 0) return 'sem tempo agora'
  const min = Math.round(cur / 60) - Math.round(prev / 60)
  if (min === 0) return 'igual'
  const pct = Math.round(((cur - prev) / prev) * 100)
  return `${min > 0 ? '+' : '−'}${duration(Math.abs(min) * 60)}${pct === 0 ? '' : ` (${pct > 0 ? '+' : '−'}${Math.abs(pct)}%)`}`
}
const pct = (part, total) => { const v = (part / total) * 100; return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%` }

const tags = await (await fetch(`${API}/tags`)).json()
const byId = new Map(tags.map((t) => [t.id, t]))
const pathOf = (t) => (t.parentId ? `${pathOf(byId.get(t.parentId))} › ${t.name}` : t.name)
const byPath = (p) => tags.find((t) => pathOf(t) === p)
const VMA = byPath('Vestibular › Matemática › Álgebra'), MA = byPath('Matemática › Álgebra'), VEST = byPath('Vestibular')
const archived = tags.find((t) => !t.active)
if (!VMA || !MA || !VEST || !archived) throw new Error('o seed não tem as tags esperadas (reseed?)')

const browser = await puppeteer.launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.emulateTimezone(FUSO)
  await page.setViewport({ width: 390, height: 900 })
  const tagReqs = []
  let failing = false
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().startsWith(`${API}/dashboard/tempo-por-tags`)) {
      tagReqs.push(new URL(req.url()))
      if (failing) return req.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"x"}' })
    }
    req.continue()
  })
  const read = () => page.evaluate(() => {
    const s = document.querySelector('section[aria-label="Comparar tags"]')
    if (!s) return null
    const table = s.querySelector('table')
    const palette = (() => {
      const probe = document.createElement('span'); document.body.append(probe)
      const o = ['1', '2', '3', '4', '5'].map((n) => { probe.style.color = `var(--categoria-${n})`; return getComputedStyle(probe).color })
      probe.remove(); return o
    })()
    const bars = s.querySelector('[role="img"]')
    return {
      text: s.textContent.replace(/\s+/g, ' '),
      results: [...s.querySelectorAll('ul[aria-label="Tags encontradas"] button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
      chips: [...s.querySelectorAll('ul[aria-label="Tags escolhidas"] li')].map((li) => ({
        text: li.querySelector('span:not([aria-hidden])')?.textContent.trim(),
        dot: getComputedStyle(li.querySelector('span[aria-hidden="true"]')).backgroundColor,
        remove: li.querySelector('button')?.getAttribute('aria-label'),
      })),
      bars: bars ? [...bars.children].map((row) => ({
        name: row.children[0].textContent.trim(),
        width: parseFloat(row.querySelector('[style]').style.width),
        color: getComputedStyle(row.querySelector('[style]')).backgroundColor,
        value: row.children[1].textContent.trim(),
      })) : null,
      head: table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : null,
      rows: table ? [...table.querySelectorAll('tbody tr')].map((tr) => {
        const tds = [...tr.children]
        return [tds[0].textContent.trim(), tds[1].querySelector('span.block').textContent.trim(), tds[1].querySelector('span.block + span.block').textContent.trim(),
          [...tds[2].querySelectorAll('span.block')].map((b) => b.textContent.trim()).join(' '),
          getComputedStyle(tds[0].querySelector('span[aria-hidden="true"]')).backgroundColor]
      }) : null,
      notes: [...s.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
      palette,
      focused: document.activeElement === s.querySelector('input'),
      url: location.pathname + location.search,
    }
  })
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      const r = await read()
      if (r && !r.text.includes('Carregando')) return r
      await pause(100)
    }
    return read()
  }
  const search = async (text) => {
    // rola pro centro antes: perto do pé, a barra fixa do celular cobre o campo
    await page.evaluate(() => document.querySelector('section[aria-label="Comparar tags"] input').scrollIntoView({ block: 'center' }))
    await page.click('section[aria-label="Comparar tags"] input', { clickCount: 3 })
    await page.keyboard.press('Backspace')
    if (text) await page.type('section[aria-label="Comparar tags"] input', text)
    await pause(100)
    return read()
  }
  const pick = async (label) => {
    const ok = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('section[aria-label="Comparar tags"] ul[aria-label="Tags encontradas"] button')].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === l)
      b?.click(); return !!b
    }, label)
    if (!ok) throw new Error(`opção "${label}" não está na busca`)
    await pause(100)
    return settle()
  }
  // Conta a tela contra a API com o MESMO período (o do último pedido)
  const expectFor = async (ids) => {
    const reqs = tagReqs.filter((u) => u.searchParams.get('tags') === ids.join(','))
    const [cur, prev] = reqs.slice(-2)
    const call = async (u) => (await fetch(`${API}/dashboard/tempo-por-tags?${u.searchParams}`)).json()
    return { cur: await call(cur), prev: await call(prev) }
  }

  // ---- seção vazia
  await page.goto(`${APP}/painel?periodo=ano&inicio=${new Date().getFullYear()}-01-01`, { waitUntil: 'networkidle0' })
  let r = await settle()
  check('seção "Comparar tags" abaixo de "Tempo", com a dica e sem pedido', !!r && r.text.includes('Escolha até 5 tags') && tagReqs.length === 0 &&
    await page.evaluate(() => { const t = document.querySelector('section[aria-label="Tempo"]'), c = document.querySelector('section[aria-label="Comparar tags"]'); return !!(t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) }), r?.text.slice(0, 120))

  // ---- busca pelo caminho, sem acento
  r = await search('algebra')
  check('busca "algebra" (sem acento) acha as duas Álgebras pelo caminho completo, em ordem', r.results.includes('Matemática › Álgebra') && r.results.includes('Vestibular › Matemática › Álgebra') &&
    r.results.indexOf('Matemática › Álgebra') < r.results.indexOf('Vestibular › Matemática › Álgebra'), JSON.stringify(r.results))
  r = await pick('Vestibular › Matemática › Álgebra')
  check('escolher: URL ?tags=<id>, chip com o caminho, busca limpa e foco de volta no campo',
    new URL(`http://x${r.url}`).searchParams.get('tags') === VMA.id && r.chips.map((c) => c.text).join() === 'Vestibular › Matemática › Álgebra' && !r.results.length && r.focused,
    JSON.stringify({ url: r.url, chips: r.chips, focused: r.focused }))
  r = await search('álgebra')
  check('a já escolhida sai da busca', !r.results.includes('Vestibular › Matemática › Álgebra') && r.results.includes('Matemática › Álgebra'), JSON.stringify(r.results))
  r = await pick('Matemática › Álgebra')
  check('2ª escolha: URL com as duas, na ordem da escolha', new URL(`http://x${r.url}`).searchParams.get('tags') === `${VMA.id},${MA.id}`, r.url)

  // ---- tabela, barras, juntas = API
  let api = await expectFor([VMA.id, MA.id])
  const union = api.cur.unionSeconds
  const expRows = api.cur.items.map((x) => [pathOf(byId.get(x.tagId)), duration(x.seconds), pct(x.seconds, union), diffOf(x.seconds, api.prev.items.find((p) => p.tagId === x.tagId)?.seconds ?? 0)])
  check('o ano tem tempo nas duas (o caso não é vazio)', api.cur.items.every((x) => x.seconds > 0), JSON.stringify(api.cur))
  check('tabela: cabeçalho Tag | Tempo | vs. anterior', JSON.stringify(r.head) === JSON.stringify(['Tag', 'Tempo', 'vs. anterior']), JSON.stringify(r.head))
  check('tabela = API (tempo, % sobre o total juntas, diferença), na ordem da escolha', JSON.stringify(r.rows?.map((x) => x.slice(0, 4))) === JSON.stringify(expRows), `${JSON.stringify(r.rows)} x ${JSON.stringify(expRows)}`)
  check('raízes diferentes: Juntas = soma (nada a desduplicar)', union === api.cur.items.reduce((s, x) => s + x.seconds, 0), `${union}`)
  check('"Juntas" = união da API, com a diferença', r.notes.some((n) => n === `Juntas (cada sessão conta uma vez): ${duration(union)} · vs. anterior: ${diffOf(union, api.prev.unionSeconds)}`), JSON.stringify(r.notes))
  check('cores pela ordem da escolha: 1ª categoria-1, 2ª categoria-2 (chip, barra e bolinha)',
    r.chips[0].dot === r.palette[0] && r.chips[1].dot === r.palette[1] && r.bars?.[0].color === r.palette[0] && r.bars?.[1].color === r.palette[1] && r.rows[0][4] === r.palette[0] && r.rows[1][4] === r.palette[1], JSON.stringify({ chips: r.chips, bars: r.bars, palette: r.palette }))
  const max = Math.max(...api.cur.items.map((x) => x.seconds))
  check('barras: largura proporcional ao maior (100%), valor = API', r.bars?.every((b, i) => Math.abs(b.width - (api.cur.items[i].seconds / max) * 100) < 0.01 && b.value === duration(api.cur.items[i].seconds)), JSON.stringify(r.bars))

  // ---- cor estável ao trocar o período (a ordem por tamanho pode mudar)
  await page.evaluate(() => document.querySelector('button[aria-label="Período anterior"]').click())
  r = await settle()
  check('período anterior: tags mantidas na URL, mesmas cores nas mesmas tags', new URL(`http://x${r.url}`).searchParams.get('tags') === `${VMA.id},${MA.id}` &&
    r.chips.map((c) => c.text).join('|') === 'Vestibular › Matemática › Álgebra|Matemática › Álgebra' && r.chips[0].dot === r.palette[0] && r.chips[1].dot === r.palette[1], JSON.stringify({ url: r.url, chips: r.chips }))
  await page.goBack({ waitUntil: 'networkidle0' })
  r = await settle()

  // ---- aninhada: Vestibular inclui Vestibular › Matemática › Álgebra
  r = await search('vestibular')
  r = await pick('Vestibular')
  check('aninhada: aviso "Vestibular inclui Vestibular › Matemática › Álgebra: não somam."', r.notes.includes('Vestibular inclui Vestibular › Matemática › Álgebra: não somam.'), JSON.stringify(r.notes))
  api = await expectFor([VMA.id, MA.id, VEST.id])
  const vest = api.cur.items.find((x) => x.tagId === VEST.id).seconds, ma = api.cur.items.find((x) => x.tagId === MA.id).seconds
  check('aninhada: Juntas = Vestibular + Matemática › Álgebra (a de dentro não soma de novo)', api.cur.unionSeconds === vest + ma && r.notes.some((n) => n.startsWith(`Juntas (cada sessão conta uma vez): ${duration(vest + ma)} `)), JSON.stringify(r.notes))
  check('aninhada: % sobre o total juntas (Vestibular = ' + pct(vest, vest + ma) + ')', r.rows?.[2]?.[2] === pct(vest, vest + ma), JSON.stringify(r.rows))

  // ---- tirar: URL, foco
  await page.evaluate(() => [...document.querySelectorAll('ul[aria-label="Tags escolhidas"] button')].find((b) => b.getAttribute('aria-label') === 'Tirar Vestibular').click())
  await pause(200) // a URL muda no clique; o React desenha logo depois
  r = await settle()
  check('tirar Vestibular: some da URL e o aviso some; foco no campo', new URL(`http://x${r.url}`).searchParams.get('tags') === `${VMA.id},${MA.id}` && !r.notes.some((n) => n.includes('inclui')) && r.focused, JSON.stringify({ url: r.url, notes: r.notes }))

  // ---- arquivada na busca
  r = await search(archived.name.slice(0, 6))
  const archivedLabel = `${pathOf(archived)} (arquivada)`
  check(`arquivada aparece na busca com "(arquivada)" (${pathOf(archived)})`, r.results.includes(archivedLabel), JSON.stringify(r.results))
  r = await pick(archivedLabel)
  check('arquivada pode ser escolhida', r.chips.some((c) => c.text === pathOf(archived)), JSON.stringify(r.chips))

  // ---- limite de 5
  for (const p of ['Linguagens', 'Exercícios']) { await search(p); await pick(p) }
  r = await search('fisica')
  check('com 5: a busca não lista e diz o motivo', r.results.length === 0 && r.notes.some((n) => n.startsWith('Já são 5 tags, o máximo.')), JSON.stringify({ results: r.results, notes: r.notes }))
  check('com 5: URL com 5 ids', new URL(`http://x${r.url}`).searchParams.get('tags').split(',').length === 5, r.url)
  await search('')

  // ---- detalhe de contexto mantém as tags; Fechar também
  const ctxTags = new URL(`http://x${r.url}`).searchParams.get('tags')
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Tempo"] table button')][0].click())
  await pause(200)
  r = await settle()
  check('abrir o detalhe de um contexto mantém as tags', new URL(`http://x${r.url}`).searchParams.get('contexto') && new URL(`http://x${r.url}`).searchParams.get('tags') === ctxTags, r.url)
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label^="Em "] button')].find((b) => b.textContent.trim() === 'Fechar').click())
  await pause(200)
  r = await settle()
  check('Fechar o detalhe mantém as tags', !new URL(`http://x${r.url}`).searchParams.get('contexto') && new URL(`http://x${r.url}`).searchParams.get('tags') === ctxTags, r.url)

  // ---- lixo na URL: id desconhecido, repetido, mais de 5
  const junk = [VMA.id, '00000000-0000-4000-a0d0-0000000000ff', VMA.id, MA.id, VEST.id, ...tags.filter((t) => t.level === 1).slice(0, 4).map((t) => t.id)]
  await page.goto(`${APP}/painel?periodo=semana&inicio=2025-03-24&tags=${junk.join(',')}`, { waitUntil: 'networkidle0' })
  r = await settle()
  const sent = tagReqs.at(-1)?.searchParams.get('tags').split(',')
  check('URL com lixo: ignora o desconhecido e o repetido, corta em 5', sent?.length === 5 && sent[0] === VMA.id && sent[1] === MA.id && new Set(sent).size === 5 && !sent.includes('00000000-0000-4000-a0d0-0000000000ff'), JSON.stringify(sent))
  check('período sem tempo: sem barras, tabela com 0', r.bars === null && r.rows?.every((x) => x[1] === '0min'), JSON.stringify({ bars: r.bars, rows: r.rows }))

  // ---- erro e Tentar de novo
  failing = true
  await page.goto(`${APP}/painel?tags=${VMA.id}`, { waitUntil: 'networkidle0' })
  r = await settle()
  check('erro da API: mensagem + Tentar de novo (e a seção Tempo segue)', r.text.includes('Não foi possível carregar a comparação') &&
    await page.evaluate(() => !!document.querySelector('section[aria-label="Tempo"] dt')), r.text.slice(0, 160))
  failing = false
  await page.evaluate(() => [...document.querySelector('section[aria-label="Comparar tags"]').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tentar de novo').click())
  r = await settle()
  check('Tentar de novo carrega', r.rows?.length === 1, JSON.stringify(r.rows))
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
