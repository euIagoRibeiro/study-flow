// Só fala quando a bateria falha: os últimos pedidos da tela (status, duração,
// os que ficaram sem resposta), as últimas navegações, erros do console, erros de
// página não tratados e a memória livre. Separa pedido que não saiu, resposta lenta,
// erro da API e API fora do ar.
// Ligado a TODA página aberta por launch() (sessao.mjs): ninguém precisa criar o seu.
// Só lê eventos e imprime: não espera, não repete, não muda resultado nem código de saída.
// ESTRESSE_CPU=4 deixa a CPU da página 4× mais lenta (tests/ferramentas/estresse.mjs)
import { freemem } from 'node:os'

const KEEP = 40
const SHOW = 15
// Uma vez por processo, de qualquer instância: a 1ª falha explica, as seguintes costumam ser consequência
let printed = false

export function createDiagnostico() {
  const log = []
  const add = (entry) => {
    log.push(entry)
    if (log.length > KEEP) log.shift()
  }
  return {
    async watch(page) {
      const cpu = Number(process.env.ESTRESSE_CPU)
      if (cpu > 1) await page.emulateCPUThrottling(cpu)
      const open = new Map()
      const isApi = (req) => ['fetch', 'xhr'].includes(req.resourceType())
      page.on('request', (req) => {
        if (!isApi(req)) return
        const entry = { at: Date.now(), text: `${req.method()} ${req.url()}`, end: 'SEM RESPOSTA' }
        open.set(req, entry)
        add(entry)
      })
      const finish = (req, end) => {
        const entry = open.get(req)
        if (entry) entry.end = `${end} em ${Date.now() - entry.at}ms`
      }
      page.on('response', (res) => finish(res.request(), res.status()))
      page.on('requestfailed', (req) => finish(req, `falhou (${req.failure()?.errorText})`))
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) add({ at: Date.now(), text: `navegou: ${frame.url()}`, end: '' })
      })
      page.on('console', (msg) => {
        if (msg.type() === 'error') add({ at: Date.now(), text: `console: ${msg.text()}`, end: '' })
      })
      page.on('pageerror', (err) => add({ at: Date.now(), text: `erro de página não tratado: ${err.message}`, end: '' }))
      page.on('error', (err) => add({ at: Date.now(), text: `página travou: ${err.message}`, end: '' }))
    },
    // Só a 1ª falha do processo
    print(name) {
      if (printed) return
      printed = true
      console.log(`DIAGNÓSTICO da falha "${name}": memória livre ${(freemem() / 1024 ** 3).toFixed(2)} GB`)
      const now = Date.now()
      // As últimas linhas e, mesmo que os pedidos as tenham empurrado pra longe, as 3 últimas navegações
      const recent = log.slice(-SHOW)
      const navigations = log.filter((e) => e.text.startsWith('navegou: ')).slice(-3).filter((e) => !recent.includes(e))
      for (const e of [...navigations, ...recent]) console.log(`  -${now - e.at}ms ${e.text} ${e.end}`)
      if (log.length === 0) console.log('  nenhum pedido registrado')
    },
  }
}
