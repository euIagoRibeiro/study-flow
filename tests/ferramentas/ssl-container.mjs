// Prova manual do SSL do banco (hospedagem 1b) contra um Postgres 17.11 de
// verdade, em contêiner próprio na 127.0.0.1:5433 (nunca o de desenvolvimento).
// Gera numa pasta temporária uma CA de teste, um certificado de servidor só para
// "localhost" e uma outra CA; sobe o servidor com ssl=on e pg_hba só hostssl;
// conecta com o dbConfig do backend: CA certa, outra CA, nome do host diferente
// (127.0.0.1), outra CA com NODE_TLS_REJECT_UNAUTHORIZED=0, e depois um servidor
// sem SSL. No fim, contêineres e pasta apagados. Senha aleatória, nunca impressa.
// Uso (raiz do repo, com o Docker): node tests/ferramentas/ssl-container.mjs
// BACKEND_DIR: uma cópia do backend (mutação)
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const BACKEND = process.env.BACKEND_DIR ?? join(dirname(SELF), '..', '..', 'backend')
const { dbConfig } = await import(pathToFileURL(join(BACKEND, 'src', 'dbconfig.js')).href)
const pg = createRequire(join(BACKEND, 'package.json'))('pg')
const IMAGE = 'postgres:17.11'
const PORT = 5433
const NAME = 'studyflow-ssl17'
const url = (host, password) => `postgres://postgres:${password}@${host}:${PORT}/postgres`

async function tryConnect(config) {
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    const r = await client.query(
      `SELECT s.ssl, current_setting('server_version') AS version
       FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`,
    )
    return { ok: true, ssl: r.rows[0].ssl, version: r.rows[0].version }
  } catch (err) {
    return { ok: false, code: err.code ?? '', message: err.message.slice(0, 120) }
  } finally {
    await client.end().catch(() => {})
  }
}

// Filho: a conexão com a outra CA num processo com NODE_TLS_REJECT_UNAUTHORIZED=0
if (process.argv[2] === '--filho') {
  const { host, ca } = JSON.parse(process.env.SSL_FILHO)
  console.log(JSON.stringify(await tryConnect(dbConfig({ DATABASE_URL: url(host, process.env.SSL_FILHO_SENHA), DATABASE_CA_CERT: ca }))))
  process.exit(0)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${JSON.stringify(detail)})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' })
const work = mkdtempSync(join(tmpdir(), 'studyflow-ssl-'))
const password = randomBytes(18).toString('hex')

function startServer(name, settings, hba) {
  const r = docker('run', '-d', '--name', name, '-p', `127.0.0.1:${PORT}:5432`, '-e', `POSTGRES_PASSWORD=${password}`,
    '-v', `${work}:/work:ro`, '--entrypoint', 'sh', IMAGE, '-c',
    'mkdir -p /certs && cp /work/server.crt /work/server.key /work/' + hba + ' /certs/ && chown postgres /certs/* ' +
    `&& chmod 600 /certs/server.key && exec docker-entrypoint.sh postgres -c hba_file=/certs/${hba} ${settings}`)
  if (r.status !== 0) throw new Error(`docker run ${name}: ${r.stderr.trim().slice(0, 200)}`)
}
async function waitReady(config) {
  // O servidor temporário do initdb não escuta em TCP: conectar já é o definitivo
  let last
  for (let i = 0; i < 60; i++) {
    last = await tryConnect(config.conn)
    if (last.ok) return last
    await pause(1000)
  }
  throw new Error(`servidor não ficou pronto em 60 s: ${last.code} ${last.message}`)
}
const removeAll = () => {
  for (const n of [NAME, `${NAME}-sem-ssl`]) docker('rm', '-f', n)
}

try {
  if (docker('ps', '-aq', '--filter', `name=^${NAME}`).stdout.trim()) throw new Error(`contêiner ${NAME} já existe`)
  const gen = spawnSync('docker', ['run', '--rm', '-v', `${work}:/work`, '-w', '/work', '--entrypoint', 'sh', IMAGE, '-c', [
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj /CN=studyflow-teste-ca',
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout outra.key -out outra.crt -days 2 -subj /CN=studyflow-outra-ca',
    'openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj /CN=localhost',
    'printf "subjectAltName=DNS:localhost\\n" > san.ext',
    'openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 2 -extfile san.ext',
    'chmod 644 *',
  ].join(' && ')], { encoding: 'utf8' })
  if (gen.status !== 0) throw new Error(`openssl: ${gen.stderr.trim().slice(-200)}`)
  writeFileSync(join(work, 'pg_hba_ssl.conf'), 'local all all trust\nhostssl all all all scram-sha-256\n')
  writeFileSync(join(work, 'pg_hba_plain.conf'), 'local all all trust\nhost all all all scram-sha-256\n')
  const ca = readFileSync(join(work, 'ca.crt'), 'utf8')
  const other = readFileSync(join(work, 'outra.crt'), 'utf8')
  const withCa = (host, cert) => dbConfig({ DATABASE_URL: url(host, password), DATABASE_CA_CERT: cert })

  // ---- servidor com SSL, pg_hba só hostssl
  startServer(NAME, '-c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key', 'pg_hba_ssl.conf')
  const good = await waitReady({ conn: withCa('localhost', ca) })
  check('CA certa em localhost: conecta, pg_stat_ssl com ssl ligado, servidor 17.11',
    good.ok && good.ssl === true && good.version.startsWith('17.11'), good)
  const plainOnSsl = await tryConnect(dbConfig({ DATABASE_URL: url('localhost', password) }))
  check('controle: sem SSL, o pg_hba só hostssl recusa', !plainOnSsl.ok && /no pg_hba.conf entry|SSL off|encryption/i.test(plainOnSsl.message), plainOnSsl)
  const wrongCa = await tryConnect(withCa('localhost', other))
  check('outra CA: recusa pela verificação do certificado', !wrongCa.ok && /CERT|SIGNATURE|ISSUER/.test(wrongCa.code), wrongCa)
  const wrongName = await tryConnect(withCa('127.0.0.1', ca))
  check('nome do host diferente do certificado (127.0.0.1, SAN só localhost): recusa',
    !wrongName.ok && wrongName.code === 'ERR_TLS_CERT_ALTNAME_INVALID', wrongName)
  const unverified = await tryConnect({ connectionString: url('127.0.0.1', password), ssl: { ca: other, rejectUnauthorized: false } })
  check('controle: com rejectUnauthorized false, outra CA e outro nome conectam (as recusas são da verificação)',
    unverified.ok && unverified.ssl === true, unverified)
  const viaUrl = await tryConnect({ connectionString: `${url('localhost', password)}?sslmode=no-verify`, ssl: { ca: other, rejectUnauthorized: true } })
  check('controle: sslmode=no-verify na URL passa por cima do objeto ssl no pg (outra CA conecta)', viaUrl.ok, viaUrl)
  let refused = ''
  try {
    dbConfig({ DATABASE_URL: `${url('localhost', password)}?sslmode=no-verify`, DATABASE_CA_CERT: ca })
  } catch (err) {
    refused = err.message
  }
  check('o dbConfig recusa essa URL', /parâmetro sslmode:/.test(refused), refused)
  const child = await new Promise((resolve) => {
    const c = spawn(process.execPath, [SELF, '--filho'], {
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', SSL_FILHO_SENHA: password,
        SSL_FILHO: JSON.stringify({ host: 'localhost', ca: other }) },
    })
    let out = ''
    c.stdout.on('data', (d) => { out += d })
    c.on('exit', () => resolve(out.trim()))
  })
  const childResult = JSON.parse(child || '{}')
  check('outra CA com NODE_TLS_REJECT_UNAUTHORIZED=0: o rejectUnauthorized true do dbConfig ainda recusa',
    childResult.ok === false && /CERT|SIGNATURE|ISSUER/.test(childResult.code ?? ''), childResult)
  docker('rm', '-f', NAME)

  // ---- servidor sem SSL
  startServer(`${NAME}-sem-ssl`, '-c ssl=off', 'pg_hba_plain.conf')
  const control = await waitReady({ conn: dbConfig({ DATABASE_URL: url('localhost', password) }) })
  check('controle: servidor sem SSL atende sem CA (ssl desligado)', control.ok && control.ssl === false, control)
  const noSsl = await tryConnect(withCa('localhost', ca))
  check('servidor sem SSL, com a CA: recusa, sem cair para texto puro',
    !noSsl.ok && /does not support SSL/i.test(noSsl.message), noSsl)
} catch (err) {
  check(`ferramenta sem erro inesperado: ${err.message}`, false)
} finally {
  removeAll()
  rmSync(work, { recursive: true, force: true })
  const left = docker('ps', '-aq', '--filter', `name=^${NAME}`).stdout.trim()
  check('contêineres e pasta temporária apagados', !left && !existsSync(work), left)
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
