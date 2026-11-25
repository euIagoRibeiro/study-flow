// Área de toque dos chips do FilterChips (commit A0), nas 5 telas que os usam, em 5 larguras (320 a 1280), janela real
// (com a barra de rolagem clássica). Os chips têm 36 px visíveis; o alvo de toque tem que ter 44 px, só na vertical
// (4 px acima e 4 abaixo), sem mudar nenhum pixel visível. Confere, para CADA chip:
//  - o desenho continua com 36 px de altura;
//  - dentro dos 44 px (elementFromPoint a 3 px acima do topo e abaixo da base, em 3 posições horizontais e no meio) o
//    elemento é o próprio chip, e fora (a 5 px) não é (o alvo é inteiro: a ±4 px, e a medição tem 1 px de folga pro arredondamento do navegador);
//  - na horizontal NÃO há extensão (1 px à esquerda da borda e à direita não é o chip: o vão de 6 px entre chips é vão);
// e para cada grupo:
//  - o rolável não ganha rolagem vertical (a área extra cabe no respiro do anel de foco);
//  - EXCEÇÃO: na Lista, o seletor "Frequência" tem o próprio alvo de 44 px, a 6 px dos chips: os dois alvos invisíveis se tocam e os
//    2 últimos px de baixo do chip ficam com o seletor (o chip fica com 42 px ali; ninguém fica sem alvo). Medido, não escondido;
//  - nenhum elemento interativo vizinho (a até 12 px do grupo) tem ponto de toque que caia num chip do grupo.
// "Bateria que não acha o que medir tem que falhar": cada tela precisa trazer seu grupo, com chips, e os vizinhos achados
// somam pelo menos 3. Nada é gravado. Uso: node --env-file=backend/.env tests/layout/chips-alvo.mjs
import { APP, CHROME } from '../config.mjs'
import { launch } from '../sessao.mjs'

let ok = 0
let bad = 0
const check = (cond, msg) => { cond ? ok++ : bad++; if (!cond) console.log('FALHOU', msg) }

const screens = [
  ['Lista', '/', 'Contexto'],
  ['Executar', '/executar', 'Frequência'],
  ['Histórico', '/historico', 'Período'],
  ['Painel', '/painel', 'Período'],
  ['Obras', '/tags', 'Filtrar obras por status'],
]
const widths = [320, 375, 414, 768, 1280]

// Roda na página: mede o grupo inteiro, chip por chip
const measureGroup = (label) => page => page.evaluate(async (label) => {
  const group = [...document.querySelectorAll('[role="group"]')].find((g) => g.getAttribute('aria-label') === label)
  if (!group) return null
  const chips = [...group.querySelectorAll('button[aria-pressed]')]
  const isInteractive = (el) => el.matches('button, a[href], select, input, textarea, [role="button"], summary')
  const hitChip = (x, y) => document.elementFromPoint(x, y)?.closest('button[aria-pressed]') ?? null
  const result = { group: true, scrollerOverflowY: group.scrollHeight - group.clientHeight, chips: [], neighbors: 0, neighborHits: [] }

  // Vizinhos: interativos fora do grupo a até 12 px dele (na vertical), com sobreposição horizontal
  group.scrollIntoView({ block: 'center', inline: 'nearest' })
  const g = group.getBoundingClientRect()
  const near = [...document.querySelectorAll('button, a[href], select, input, textarea, [role="button"], summary')]
    .filter((el) => !group.contains(el) && isInteractive(el))
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.bottom > g.top - 12 && r.top < g.bottom + 12 && r.right > g.left && r.left < g.right
    })
  result.neighbors = near.length

  for (const chip of chips) {
    chip.scrollIntoView({ block: 'center', inline: 'center' })
    // As setas de rolagem somem/aparecem num estado do React depois do scroll: esperar assentar, senão a seta (que cobre a ponta) mascara o chip
    await new Promise((done) => setTimeout(done, 150))
    const r = chip.getBoundingClientRect()
    const x = (f) => r.left + r.width * f
    const inside = [] // pontos que TÊM que ser o chip (o miolo e 1 px de alvo extra)
    const edge = [] // as pontas do alvo de 44 px (3 px além do desenho)
    const outside = [] // pontos que NÃO podem ser o chip
    for (const dx of [3, r.width / 2, r.width - 3]) {
      inside.push([r.left + dx, r.top + r.height / 2], [r.left + dx, r.top - 1], [r.left + dx, r.bottom + 1])
      edge.push([r.left + dx, r.top - 3], [r.left + dx, r.bottom + 3])
      outside.push([r.left + dx, r.top - 5], [r.left + dx, r.bottom + 5])
    }
    const who = (px, py) => {
      const e = document.elementFromPoint(px, py)
      if (!e) return 'nada'
      const owner = e.closest('select, button, a[href], input, textarea, summary, [role="button"]')
      return owner ? `${owner.tagName.toLowerCase()}[${owner.getAttribute('aria-label') ?? owner.textContent.trim().slice(0, 20)}]` : `${e.tagName.toLowerCase()} (sem alvo)`
    }
    outside.push([r.left - 1, r.top + r.height / 2], [r.right + 1, r.top + r.height / 2])
    result.chips.push({
      text: chip.textContent.trim(),
      height: r.height,
      missInside: inside.filter(([px, py]) => hitChip(px, py) !== chip).length,
      hitOutside: outside.filter(([px, py]) => hitChip(px, py) === chip).length,
      firstMiss: inside.find(([px, py]) => hitChip(px, py) !== chip) ?? null,
      // Ponta do alvo tomada por OUTRO controle (dois alvos invisíveis disputando o mesmo vão: ninguém fica sem alvo)
      // ou por área sem alvo (aí o chip tem menos de 44 px de verdade)
      edgeMiss: edge.filter(([px, py]) => hitChip(px, py) !== chip).map(([px, py]) => ({ side: py < r.top ? 'cima' : 'baixo', by: who(px, py) })),
      x: x(0),
    })
  }

  // Cada ponto de toque de cada vizinho (3 x 3, a 1 px das bordas) não pode cair num chip do grupo
  for (const el of near) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    for (const fx of [0, 0.5, 1]) {
      for (const fy of [0, 0.5, 1]) {
        const px = Math.min(Math.max(r.left + r.width * fx, r.left + 1), r.right - 1)
        const py = Math.min(Math.max(r.top + r.height * fy, r.top + 1), r.bottom - 1)
        const top = document.elementFromPoint(px, py)
        const chip = top?.closest('button[aria-pressed]')
        if (chip && chips.includes(chip)) {
          result.neighborHits.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30)}" em (${px.toFixed(1)}, ${py.toFixed(1)})`)
        }
      }
    }
  }
  return result
}, label)

let browser
let neighborsTotal = 0
let sharedPoints = 0
try {
  browser = await launch({ executablePath: CHROME, ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  for (const width of widths) {
    await page.setViewport({ width, height: 900 })
    for (const [name, path, label] of screens) {
      const t = `${name} ${width}`
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle0' })
      await page.waitForFunction((l) => [...document.querySelectorAll('[role="group"]')].some((g) => g.getAttribute('aria-label') === l && g.querySelector('button[aria-pressed]')), {}, label)
      const m = await measureGroup(label)(page)
      check(m?.group === true, `${t}: grupo "${label}" não achado`)
      if (!m) continue
      check(m.chips.length >= 3, `${t}: só ${m.chips.length} chips no grupo "${label}"`)
      check(m.scrollerOverflowY <= 0.5, `${t}: o rolável ganhou rolagem vertical (${m.scrollerOverflowY}px)`)
      neighborsTotal += m.neighbors
      check(m.neighborHits.length === 0, `${t}: ponto de toque de vizinho cai num chip (${m.neighborHits.slice(0, 2).join('; ')})`)
      for (const c of m.chips) {
        check(Math.abs(c.height - 36) < 0.1, `${t}: chip "${c.text}" com ${c.height}px de altura visível (esperado 36)`)
        check(c.missInside === 0, `${t}: chip "${c.text}": ${c.missInside} ponto(s) do miolo ou do 1º px extra não são o chip (primeiro: ${JSON.stringify(c.firstMiss)})`)
        // As pontas (3 px além do desenho) têm que ser o chip. ÚNICA exceção, documentada: na Lista o seletor "Frequência"
        // (alvo de 44 px dele, a 6 px dos chips) fica com os 2 últimos px de baixo; o chip fica com 42 px ali
        const shared = c.edgeMiss.filter((e) => name === 'Lista' && e.side === 'baixo' && e.by === 'select[Frequência]')
        sharedPoints += shared.length
        const lost = c.edgeMiss.filter((e) => !shared.includes(e))
        check(lost.length === 0, `${t}: chip "${c.text}": pontas do alvo de 44 px perdidas (${JSON.stringify(lost[0])})`)
        check(c.hitOutside === 0, `${t}: chip "${c.text}": ${c.hitOutside} ponto(s) fora dos 44 px × largura são o chip`)
      }
      if (width === 320) console.log(`  ${t}: ${m.chips.length} chips, ${m.neighbors} vizinho(s)`)
    }
  }
  check(sharedPoints > 0, 'a exceção da Lista (seletor Frequência) não apareceu: se sumiu, tirar a exceção do teste')
  check(neighborsTotal >= 3, `vizinhos achados no total: ${neighborsTotal} (esperado pelo menos 3: sem eles a checagem de invasão é vazia)`)
} finally {
  await browser?.close().catch(() => {})
}
console.log(`\n${ok} de ${ok + bad}`)
process.exitCode = bad === 0 && ok > 0 ? 0 : 1
