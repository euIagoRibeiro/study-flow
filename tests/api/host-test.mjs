// O backend escuta só na própria máquina por padrão (a rede local não chega nele):
// sobe o backend numa porta de teste SEM a variável HOST e confere que
// 127.0.0.1 responde e um IPv4 da máquina fora do loopback (Wi-Fi, cabo)
// recusa. Controle: com HOST=0.0.0.0 o mesmo IP responde (a checagem acerta
// o alvo). Sem interface fora do loopback, pula com aviso. Uso (raiz do repo):
//   node tests/api/host-test.mjs
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
// BACKEND_DIR: uma cópia do backend (mutação), sem mexer no de desenvolvimento,
// que o nodemon reiniciaria com o código mutado. O .env é sempre o do backend real
const BACKEND = process.env.BACKEND_DIR ?? REAL
const PORT = '3335'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))?.address
async function reach(host) {
  try {
    const res = await fetch(`http://${host}:${PORT}/health`, { signal: AbortSignal.timeout(3000) })
    return res.status
  } catch (err) {
    return err.cause?.code ?? err.name
  }
}
async function withBackend(env, fn) {
  const { HOST: _, ...clean } = process.env
  const child = spawn(process.execPath, [`--env-file=${join(REAL, '.env')}`, 'src/index.js'], { cwd: BACKEND, env: { ...clean, ...env, PORT } })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  try {
    for (let i = 0; i < 40 && !out.includes('API rodando'); i++) await pause(250)
    if (!out.includes('API rodando')) throw new Error(`backend não subiu: ${out.trim().slice(0, 200)}`)
    await fn(out.trim())
  } finally {
    child.kill()
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)))
  }
}

try {
  if ((await reach('127.0.0.1')) !== 'ECONNREFUSED') throw new Error(`a porta ${PORT} já está em uso`)
  await withBackend({}, async (line) => {
    check('sem HOST: anuncia 127.0.0.1', line.includes(`http://127.0.0.1:${PORT}`), line)
    const local = await reach('127.0.0.1')
    check('sem HOST: 127.0.0.1 responde', local === 200, String(local))
    if (!lan) {
      console.log('AVISO  sem interface IPv4 fora do loopback: a recusa pela rede não foi conferida')
      check('sem HOST: IP da rede (pulado, sem interface)', true)
    } else {
      const outside = await reach(lan)
      check(`sem HOST: IP da rede (${lan}) recusa`, outside === 'ECONNREFUSED', String(outside))
    }
  })
  if (lan) {
    await withBackend({ HOST: '0.0.0.0' }, async () => {
      const outside = await reach(lan)
      check(`controle HOST=0.0.0.0: IP da rede (${lan}) responde`, outside === 200, String(outside))
    })
  }
  const after = await reach('127.0.0.1')
  check('backend de teste encerrado (porta livre)', after === 'ECONNREFUSED', String(after))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
