// M4: definir e editar medida na tela de tags. Cria a própria árvore
// (teste-m4 › sub › neto) e apaga tudo no finally, esperando a API antes de
// cada pedido. Mira pelo rótulo/conteúdo.
import puppeteer from 'puppeteer-core'

import pg from 'pg'
import { API, APP, CHROME } from '../config.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`)
}
async function waitForApi() {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/tasks`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('API não respondeu')
}
async function api(method, path, body) {
  await waitForApi()
  const res = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const measureOf = async (tagId) => (await api('GET', '/measures')).find((m) => m.tagId === tagId)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const ids = {}
try {
  ids.root = (await api('POST', '/tags', { name: 'teste-m4' })).id
  ids.sub = (await api('POST', '/tags', { name: 'sub', parentId: ids.root })).id
  ids.neto = (await api('POST', '/tags', { name: 'neto', parentId: ids.sub })).id
  ids.task = (await api('POST', '/tasks', { title: 'teste-m4 tarefa' })).id

  const page = await browser.newPage()
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 375, height: 900 })
  const load = async () => {
    await waitForApi()
    await page.goto(`${APP}/tags`, { waitUntil: 'networkidle0' })
    // Abre a árvore de teste (estado de aberto/fechado vem do localStorage)
    for (const name of ['teste-m4', 'sub']) {
      await page.evaluate((n) => {
        const b = document.querySelector(`button[aria-label="Subtags de ${n}"]`)
        if (b && b.getAttribute('aria-expanded') !== 'true') b.click()
      }, name)
      await pause(150)
    }
  }
  const menu = async (path, item) => {
    await page.evaluate((p) => document.querySelector(`button[aria-haspopup="menu"][aria-label="Mais ações de ${p}"]`).click(), path)
    await page.waitForSelector(`[role="menu"]`)
    return page.evaluate((i) => {
      const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      // Item vazio = só ler o menu ('x'.startsWith('') é true: clicaria no 1º)
      const found = i ? items.find((b) => b.textContent.trim().startsWith(i)) : undefined
      if (found && found.getAttribute('aria-disabled') !== 'true') found.click()
      return items.map((b) => ({ text: b.textContent.trim(), disabled: b.getAttribute('aria-disabled') === 'true' }))
    }, item)
  }
  const form = (tag) => `form[aria-label="Medida de ${tag}"]`
  const fill = (scope, label, value) => page.evaluate((s, l, v) => {
    const lab = [...document.querySelector(s).querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(l))
    const input = lab.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, scope, label, value)
  const fillAria = (scope, aria, value) => page.evaluate((s, a, v) => {
    const input = document.querySelector(s).querySelector(`input[aria-label="${a}"]`)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, scope, aria, value)
  const click = (scope, text) => page.evaluate((s, t) =>
    [...document.querySelector(s).querySelectorAll('button')].find((b) => b.textContent.trim() === t).click(), scope, text)
  const text = (scope) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', scope)
  const lineOf = (tag) => page.evaluate((t) => {
    const btn = document.querySelector(`button[aria-label^="Mais ações de"][aria-label$="${t}"]`)
    const li = btn.closest('li')
    return [...li.children].find((c) => c.tagName === 'P')?.textContent.trim() ?? ''
  }, tag)

  // --- Definir na raiz, com 2 tipos
  await load()
  await menu('teste-m4', 'Definir medida')
  await page.waitForSelector(form('teste-m4'))
  check('nota da raiz: "Vale para teste-m4 e as subtags."', (await text(form('teste-m4'))).includes('Vale para teste-m4 e as subtags.'))
  await fill(form('teste-m4'), 'O que se mede', 'páginas')
  await fill(form('teste-m4'), 'No singular', 'página')
  for (const [i, name] of ['leitura', 'revisão'].entries()) {
    await click(form('teste-m4'), 'Tipo')
    await fillAria(form('teste-m4'), `Tipo ${i + 1}`, name)
  }
  await click(form('teste-m4'), 'Salvar')
  await pause(1200)
  let m = await measureOf(ids.root)
  check('definir com 2 tipos: gravado num POST só', m?.name === 'páginas' && m.kinds.length === 2, JSON.stringify(m?.kinds?.map((k) => k.name)))
  check('linha embaixo da tag: "Medida: páginas (leitura, revisão)"', (await lineOf('teste-m4')) === 'Medida: páginas (leitura, revisão)', await lineOf('teste-m4'))

  // --- Subtag substitui; a nota mostra o que herdava
  await menu('teste-m4 › sub', 'Definir medida')
  await page.waitForSelector(form('sub'))
  check('nota da subtag: herda "páginas" e substitui', (await text(form('sub'))).includes('Hoje herda "páginas" de teste-m4; definida aqui, substitui.'))
  await fill(form('sub'), 'O que se mede', 'capítulos')
  await fill(form('sub'), 'No singular', 'capítulo')
  await click(form('sub'), 'Salvar')
  await pause(1200)
  check('subtag com medida própria', (await measureOf(ids.sub))?.name === 'capítulos')
  const netoMenu = await menu('teste-m4 › sub › neto', '')
  check('neto também tem "Definir medida"', netoMenu.some((i) => i.text === 'Definir medida'))
  await page.keyboard.press('Escape')

  // --- Editar a raiz: nota cita a subtag; renomear e ligar decimal
  await menu('teste-m4', 'Editar medida')
  await page.waitForSelector(form('teste-m4'))
  check('nota da raiz cita a substituição: "sub tem medida própria."', (await text(form('teste-m4'))).includes('sub tem medida própria.'))
  await fill(form('teste-m4'), 'O que se mede', 'páginas lidas')
  await page.evaluate((s) => document.querySelector(s).querySelector('input[type="checkbox"]').click(), form('teste-m4'))
  await click(form('teste-m4'), 'Salvar')
  await pause(1200)
  m = await measureOf(ids.root)
  check('editar: nome e decimal gravados', m.name === 'páginas lidas' && m.allowsDecimal === true)

  // --- Tipos com ação imediata
  await menu('teste-m4', 'Editar medida')
  await page.waitForSelector(form('teste-m4'))
  await fillAria(form('teste-m4'), 'Tipo novo', 'anotação')
  await page.focus(`${form('teste-m4')} input[aria-label="Tipo novo"]`)
  await page.keyboard.press('Enter')
  await pause(1000)
  m = await measureOf(ids.root)
  check('Enter no "tipo novo" adiciona (e não salva a medida)', m.kinds.some((k) => k.name === 'anotação') && !!(await page.$(form('teste-m4'))))
  await fillAria(form('teste-m4'), 'Tipo novo', 'LEITURA')
  await click(form('teste-m4'), 'Adicionar')
  await pause(1000)
  check('tipo repetido: mensagem do servidor no formulário', (await text(form('teste-m4'))).includes('Tipo repetido nesta medida'))
  await page.evaluate(() => document.querySelector('button[aria-label="Mais ações do tipo revisão"]').click())
  await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === 'Renomear').click())
  await fillAria(form('teste-m4'), 'Novo nome de revisão', 'revisão final')
  await click(form('teste-m4'), 'OK')
  await pause(1000)
  check('renomear tipo', (await measureOf(ids.root)).kinds.some((k) => k.name === 'revisão final'))
  await page.evaluate(() => document.querySelector('button[aria-label="Mais ações do tipo leitura"]').click())
  await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === 'Arquivar').click())
  await pause(1000)
  check('arquivar tipo: chip "Arquivado"', !(await measureOf(ids.root)).kinds.find((k) => k.name === 'leitura').active &&
    (await text(form('teste-m4'))).includes('Arquivado'))
  await page.evaluate(() => document.querySelector('button[aria-label="Mais ações do tipo anotação"]').click())
  await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === 'Apagar').click())
  await pause(1000)
  check('apagar tipo nunca usado', !(await measureOf(ids.root)).kinds.some((k) => k.name === 'anotação'))

  // --- Uso: com registro, apagar vira arquivar
  const leitura = (await measureOf(ids.root)).kinds.find((k) => k.name === 'leitura')
  await api('PATCH', `/measure-kinds/${leitura.id}`, { active: true })
  await api('POST', '/executions', { taskId: ids.task, description: 'm4', completedAt: new Date().toISOString(),
    rootTagId: ids.root, tagIds: [], measureValues: [{ kindId: leitura.id, quantity: 3 }] })
  await load()
  await menu('teste-m4', 'Editar medida')
  await page.waitForSelector(form('teste-m4'))
  await page.evaluate(() => document.querySelector('button[aria-label="Mais ações do tipo leitura"]').click())
  const kindMenu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
    .map((b) => ({ text: b.textContent.trim(), disabled: b.getAttribute('aria-disabled') === 'true' })))
  check('tipo usado: "Apagar" travado com o motivo', kindMenu.some((i) => i.disabled && i.text.includes('Em uso em registros')), JSON.stringify(kindMenu))
  await page.keyboard.press('Escape')
  check('medida usada: sem "Apagar medida", com o motivo', (await text(form('teste-m4'))).includes('Em uso em registros: arquive em vez de apagar.') &&
    !(await text(form('teste-m4'))).includes('Apagar medida'))
  await click(form('teste-m4'), 'Arquivar medida')
  await pause(1000)
  await click(form('teste-m4'), 'Fechar')
  check('arquivar medida: linha diz "· arquivada"', (await lineOf('teste-m4')).endsWith('· arquivada'), await lineOf('teste-m4'))
  // Sem o neto (e sem uso), a única razão que trava o Apagar da sub é a medida
  await api('DELETE', `/tags/${ids.neto}`)
  ids.neto = null
  await load()
  const tagMenu = await menu('teste-m4 › sub', '')
  check('tag que declara medida: "Apagar" travado com o motivo', tagMenu.some((i) => i.disabled && i.text.includes('Declara uma medida')), JSON.stringify(tagMenu.map((i) => i.text)))
  await page.keyboard.press('Escape')

  // --- Apagar medida nunca usada (a da subtag)
  await menu('teste-m4 › sub', 'Editar medida')
  await page.waitForSelector(form('sub'))
  await click(form('sub'), 'Apagar medida')
  await pause(1000)
  check('apagar medida nunca usada', (await measureOf(ids.sub)) === undefined && (await lineOf('sub')) === '')
} catch (err) {
  check('rodou sem erro', false, err.message)
} finally {
  await waitForApi()
  if (ids.task) {
    await pool.query('DELETE FROM execution_measure_values WHERE task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [ids.task])
    await pool.query('DELETE FROM execution_measures WHERE task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [ids.task])
    await pool.query('DELETE FROM task_execution_tags WHERE task_execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [ids.task])
    await pool.query('DELETE FROM task_executions WHERE task_id = $1', [ids.task])
    await pool.query('DELETE FROM tasks WHERE id = $1', [ids.task])
  }
  const tagIds = [ids.neto, ids.sub, ids.root].filter(Boolean)
  await pool.query('DELETE FROM measure_kinds WHERE measure_id IN (SELECT id FROM measures WHERE tag_id = ANY($1))', [tagIds])
  await pool.query('DELETE FROM measures WHERE tag_id = ANY($1)', [tagIds])
  for (const id of tagIds) await pool.query('DELETE FROM tags WHERE id = $1', [id])
  const left = await pool.query(`SELECT (SELECT count(*) FROM tags WHERE name LIKE 'teste-m4%')::int + (SELECT count(*) FROM measures WHERE id::text NOT LIKE '5eed%')::int AS n`)
  check('dados de teste apagados', left.rows[0].n === 0, `${left.rows[0].n} sobrando`)
  await pool.end()
  await browser.close()
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length ? 0 : 1
}
