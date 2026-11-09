// Conexão com o banco (hospedagem 1b): o dbConfig decide o SSL e as recusas, e o
// index.js recusa subir antes de carregar o Pool. Sem banco nem rede: confere a
// função, o que o pg monta com ela e a partida do backend numa porta de teste.
// A prova com um Postgres de verdade (CA certa, outra CA, nome do host, sem SSL)
// é manual: tests/ferramentas/ssl-container.mjs. Uso (raiz do repo):
//   node --env-file=backend/.env tests/api/db-ssl-test.mjs
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
// BACKEND_DIR: uma cópia do backend (mutação), sem mexer no de desenvolvimento
const BACKEND = process.env.BACKEND_DIR ?? REAL
const PORT = '3336'
if (!process.env.AUTH_PASSWORD_HASH || !process.env.SESSION_SECRET) {
  console.error('AUTH_PASSWORD_HASH ou SESSION_SECRET ausente: rode com --env-file=backend/.env')
  process.exit(2)
}
const { dbConfig } = await import(pathToFileURL(join(BACKEND, 'src', 'dbconfig.js')).href)
const pg = createRequire(join(BACKEND, 'package.json'))('pg')

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${detail})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
// Marcadores que não podem aparecer em nenhuma mensagem
const SECRET = 'SENHA-MARCADOR'
const REMOTE_HOST = 'db.exemplo.invalid'
const REMOTE = `postgres://usuario:${SECRET}@${REMOTE_HOST}:5432/banco`
const CA = '-----BEGIN CERTIFICATE-----\nMIIBteste\n-----END CERTIFICATE-----\n'
const refusal = (env) => {
  try {
    dbConfig(env)
    return null
  } catch (err) {
    return err.message
  }
}
const leaks = (text) => text.includes(SECRET) || text.includes(REMOTE_HOST)
function refuses(name, env, pattern) {
  const msg = refusal(env)
  check(name, msg !== null && pattern.test(msg) && !leaks(msg), msg ?? 'aceitou')
}

try {
  // ---- local: só os três nomes; sem CA, ssl false explícito
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const env = { DATABASE_URL: `postgres://u:p@${host}:5432/db` }
    const msg = refusal(env)
    const cfg = msg === null ? dbConfig(env) : {}
    check(`${host} sem CA: sobe sem SSL (ssl false explícito)`, cfg.ssl === false, msg ?? JSON.stringify(cfg.ssl))
  }
  const localCa = dbConfig({ DATABASE_URL: 'postgres://u:p@localhost/db', DATABASE_CA_CERT: CA })
  check('localhost com CA: ssl com a CA e rejectUnauthorized true',
    localCa.ssl?.ca === CA && localCa.ssl?.rejectUnauthorized === true
    && typeof localCa.ssl?.checkServerIdentity === 'function', JSON.stringify(localCa.ssl))

  // ---- remoto: qualquer outro nome, inclusive de contêiner e variações do local
  for (const host of ['postgres', 'db', 'studyflow-postgres-1', '127.0.0.2', '0.0.0.0', 'localhost.exemplo', '::2', REMOTE_HOST]) {
    const url = `postgres://u:${SECRET}@${host.includes(':') ? `[${host}]` : host}:5432/db`
    refuses(`${host} sem CA: recusa citando DATABASE_CA_CERT`, { DATABASE_URL: url }, /DATABASE_CA_CERT ausente/)
  }
  refuses('host da URL local, parâmetro host remoto (o pg usa o parâmetro): recusa',
    { DATABASE_URL: `postgres://u:${SECRET}@localhost/db?host=${REMOTE_HOST}` }, /DATABASE_CA_CERT ausente/)
  const remote = dbConfig({ DATABASE_URL: REMOTE, DATABASE_CA_CERT: CA })
  check('remoto com CA: ssl com a CA e rejectUnauthorized true',
    remote.ssl?.ca === CA && remote.ssl?.rejectUnauthorized === true && Object.keys(remote.ssl).length === 3,
    JSON.stringify(remote.ssl))
  check('remoto com CA: a connectionString é a DATABASE_URL', remote.connectionString === REMOTE)
  // O nome conferido é o da URL, não o que o TLS passa (com IP, o pg não passa nada
  // e o Node confere contra "localhost")
  const certFor = (san) => ({ subject: { CN: 'x' }, subjectaltname: san })
  const identity = (cfg, name, san) => (typeof cfg.ssl?.checkServerIdentity === 'function'
    ? cfg.ssl.checkServerIdentity(name, certFor(san)) : { code: 'sem checkServerIdentity' })
  check('nome conferido: o host da URL aceita o certificado dele',
    identity(remote, REMOTE_HOST, `DNS:${REMOTE_HOST}`) === undefined)
  check('nome conferido: certificado de outro nome recusado',
    identity(remote, REMOTE_HOST, 'DNS:outro.exemplo')?.code === 'ERR_TLS_CERT_ALTNAME_INVALID')
  const byIp = dbConfig({ DATABASE_URL: `postgres://u:${SECRET}@10.0.0.5:5432/db`, DATABASE_CA_CERT: CA })
  check('host IP: o "localhost" que o Node passaria não vale contra certificado de localhost',
    identity(byIp, 'localhost', 'DNS:localhost')?.code === 'ERR_TLS_CERT_ALTNAME_INVALID')
  check('host IP: certificado com o IP aceito', identity(byIp, 'localhost', 'IP Address:10.0.0.5') === undefined)
  const byV6 = dbConfig({ DATABASE_URL: 'postgres://u:p@[::1]:5432/db', DATABASE_CA_CERT: CA })
  check('host [::1] com CA: conferido como ::1 (sem colchetes)',
    identity(byV6, 'localhost', 'IP Address:0:0:0:0:0:0:0:1') === undefined)

  // ---- parâmetros de SSL na URL: recusados, com o nome do parâmetro
  for (const p of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation', 'uselibpqcompat']) {
    refuses(`?${p}= recusado (remoto com CA)`, { DATABASE_URL: `${REMOTE}?${p}=x`, DATABASE_CA_CERT: CA },
      new RegExp(`parâmetro ${p}:`))
    refuses(`?${p}= recusado também no local`, { DATABASE_URL: `postgres://u:${SECRET}@localhost/db?${p}=x` },
      new RegExp(`parâmetro ${p}:`))
  }
  refuses('SSLMODE em maiúsculas recusado', { DATABASE_URL: `${REMOTE}?SSLMODE=disable`, DATABASE_CA_CERT: CA }, /parâmetro sslmode:/)
  refuses('ssl%6Dode (sslmode codificado) recusado', { DATABASE_URL: `${REMOTE}?ssl%6Dode=disable`, DATABASE_CA_CERT: CA }, /parâmetro sslmode:/)
  refuses('sslmode depois de outro parâmetro recusado',
    { DATABASE_URL: `${REMOTE}?application_name=x&sslmode=no-verify`, DATABASE_CA_CERT: CA }, /parâmetro sslmode:/)
  check('parâmetro que não é de SSL passa', refusal({ DATABASE_URL: `${REMOTE}?application_name=x`, DATABASE_CA_CERT: CA }) === null)

  // ---- NODE_TLS_REJECT_UNAUTHORIZED: com host remoto, recusa com qualquer valor
  for (const v of ['0', '', '1']) {
    refuses(`remoto com NODE_TLS_REJECT_UNAUTHORIZED=${JSON.stringify(v)}: recusa`,
      { DATABASE_URL: REMOTE, DATABASE_CA_CERT: CA, NODE_TLS_REJECT_UNAUTHORIZED: v }, /NODE_TLS_REJECT_UNAUTHORIZED definida/)
  }
  check('local com NODE_TLS_REJECT_UNAUTHORIZED=0: sobe (só o remoto recusa)',
    refusal({ DATABASE_URL: 'postgres://u:p@localhost/db', NODE_TLS_REJECT_UNAUTHORIZED: '0' }) === null)

  // ---- forma da URL e do certificado
  refuses('sem DATABASE_URL: recusa', {}, /DATABASE_URL ausente/)
  refuses('URL que não é postgres://: recusa', { DATABASE_URL: `mysql://u:${SECRET}@${REMOTE_HOST}/db` }, /postgres:\/\//)
  refuses('caminho de socket: recusa', { DATABASE_URL: '/var/run/postgresql db' }, /postgres:\/\//)
  refuses('URL sem host: recusa (o pg usaria o PGHOST)', { DATABASE_URL: `postgres://u:${SECRET}@/db` }, /sem host|inválida/)
  refuses('CA que não é PEM: recusa', { DATABASE_URL: REMOTE, DATABASE_CA_CERT: `/certs/${SECRET}.crt` }, /não é um certificado PEM/)
  check('CA vazia conta como ausente (remoto recusa)', /DATABASE_CA_CERT ausente/.test(refusal({ DATABASE_URL: REMOTE, DATABASE_CA_CERT: '' }) ?? ''))

  // ---- o que o pg monta: a URL passa por cima do objeto ssl (por isso a recusa)
  const over = new pg.Client({ connectionString: `${REMOTE}?sslmode=no-verify`, ssl: { ca: CA, rejectUnauthorized: true } })
  check('pg: sslmode=no-verify na URL desliga a verificação do objeto ssl (a razão da recusa)',
    over.connectionParameters.ssl?.rejectUnauthorized === false, JSON.stringify(over.connectionParameters.ssl))
  const ours = new pg.Client(dbConfig({ DATABASE_URL: REMOTE, DATABASE_CA_CERT: CA }))
  check('pg com o dbConfig: ca e rejectUnauthorized true chegam à conexão',
    ours.connectionParameters.ssl?.ca === CA && ours.connectionParameters.ssl?.rejectUnauthorized === true,
    JSON.stringify(ours.connectionParameters.ssl))
  const saved = process.env.PGSSLMODE
  process.env.PGSSLMODE = 'require'
  try {
    const plain = new pg.Client({ connectionString: 'postgres://u:p@localhost/db' })
    const local = new pg.Client(dbConfig({ DATABASE_URL: 'postgres://u:p@localhost/db' }))
    check('pg: sem ssl na config, o PGSSLMODE do ambiente vale (controle)', plain.connectionParameters.ssl !== false,
      JSON.stringify(plain.connectionParameters.ssl))
    check('pg com o dbConfig local: PGSSLMODE do ambiente ignorado (ssl false)', local.connectionParameters.ssl === false,
      JSON.stringify(local.connectionParameters.ssl))
  } finally {
    if (saved === undefined) delete process.env.PGSSLMODE
    else process.env.PGSSLMODE = saved
  }

  // ---- partida: o index.js recusa antes de carregar o Pool, sem pilha nem URL
  async function start(env) {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: BACKEND,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, AUTH_PASSWORD_HASH: process.env.AUTH_PASSWORD_HASH,
        SESSION_SECRET: process.env.SESSION_SECRET, PORT, ...env },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    for (let i = 0; i < 40 && child.exitCode === null && !out.includes('API rodando'); i++) await pause(250)
    const code = child.exitCode
    if (code === null) {
      child.kill()
      await new Promise((r) => child.once('exit', r))
    }
    return { code, out: out.trim() }
  }
  const startRefuses = async (name, env, pattern) => {
    const r = await start(env)
    check(name, r.code === 1 && /^A API não sobe sem o banco verificado: /.test(r.out) && pattern.test(r.out)
      && !/\n\s+at /.test(r.out) && !leaks(r.out), `saída ${r.code}: ${r.out.slice(0, 300)}`)
  }
  await startRefuses('partida: remoto sem CA, saída 1 citando DATABASE_CA_CERT', { DATABASE_URL: REMOTE }, /DATABASE_CA_CERT ausente/)
  await startRefuses('partida: sslmode na URL, saída 1 citando o parâmetro',
    { DATABASE_URL: `${REMOTE}?sslmode=no-verify`, DATABASE_CA_CERT: CA }, /parâmetro sslmode:/)
  await startRefuses('partida: NODE_TLS_REJECT_UNAUTHORIZED=0, saída 1 citando a variável',
    { DATABASE_URL: REMOTE, DATABASE_CA_CERT: CA, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, /NODE_TLS_REJECT_UNAUTHORIZED definida/)
  const ok = await start({ DATABASE_URL: REMOTE, DATABASE_CA_CERT: CA })
  check('partida: remoto com CA sobe (o Pool conecta só no 1º pedido)', ok.out.includes('API rodando'), ok.out.slice(0, 300))
  const local = await start({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' })
  check('partida: localhost sem CA sobe', local.out.includes('API rodando'), local.out.slice(0, 300))
} catch (err) {
  check(`bateria sem erro inesperado: ${err.message}`, false)
} finally {
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
