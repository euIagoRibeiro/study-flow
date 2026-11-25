// Prova manual do backup (hospedagem, item 3): roda o ops/backup.sh e o
// ops/restaurar.sh de verdade, em contêineres postgres:17.11 numa rede própria:
// "origem" (SSL com uma CA de teste, as 15 migrações e o seed, studyflow_backup
// com login e senha aleatória), "restaurado" (o servidor de serviço do job) e
// "sem-papeis" (um cluster onde studyflow_api e studyflow_backup não existem).
// "sem-supabase" (um cluster sem nenhum papel, só pro cenário do Supabase).
// Chave age descartável, CA e certificados numa pasta temporária apagada no fim,
// como os contêineres, a rede e a imagem com o age. Cenários: backup normal (o
// arquivo cifrado, a restauração sem os papéis falha e com o restaurar.sh bate
// com o dono), origem estilo Supabase (os 8 papéis de SUPABASE_ROLES e privilégios padrão
// citados pelo dump: sem eles a restauração falha, com o restaurar.sh passa, e um papel fora
// da lista faz a restauração falhar NOMEANDO o papel), gravação concorrente durante o backup, sslmode na URL, outra CA,
// tabela sem a política, política que não lê tudo, URL de outro papel; nenhuma
// saída mostra a senha nem a URL. Uso (raiz do repo, com o Docker):
//   node tests/ferramentas/backup-local.mjs
// OPS_DIR: uma cópia de ops/ (mutação)
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OPS = process.env.OPS_DIR ?? join(ROOT, 'ops')
const REAL_OPS = join(ROOT, 'ops')
const IMAGE = 'postgres:17.11'
const RUNNER = 'studyflow-backup-teste-runner'
const NET = 'studyflow-backup-teste'
const C = { origem: 'sfb-origem', restaurado: 'sfb-restaurado', semPapeis: 'sfb-sem-papeis', semSupabase: 'sfb-sem-supabase' }
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok ? '' : ` (${String(detail).slice(0, 400)})`}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts })
const work = mkdtempSync(join(tmpdir(), 'studyflow-backup-'))
for (const d of ['certs', 'keys', 'out', 'sh']) mkdirSync(join(work, d))
const pwBackup = randomBytes(18).toString('hex')
const pwPostgres = randomBytes(18).toString('hex')
const leaks = (text) => text.includes(pwBackup) || text.includes(pwPostgres) || /@(origem|outro-nome)/.test(text)
const backupUrl = (user = 'studyflow_backup', pw = pwBackup) => `postgresql://${user}:${pw}@origem:5432/postgres`
const RESTORE = 'postgresql://postgres@restaurado:5432/postgres?sslmode=disable'
const SEM_PAPEIS = 'postgresql://postgres@sem-papeis:5432/postgres?sslmode=disable'
const SEM_SUPABASE = 'postgresql://postgres@sem-supabase:5432/postgres?sslmode=disable'

// Roda no contêiner com o age; segredos só pelo ambiente do processo (-e NOME)
function inRunner(script, env = {}, opsDir = OPS) {
  const names = Object.keys(env)
  const args = ['run', '--rm', '--network', NET, '-v', `${opsDir}:/ops:ro`, '-v', `${join(work, 'certs')}:/certs:ro`,
    '-v', `${join(work, 'keys')}:/keys`, '-v', `${join(work, 'out')}:/out`, ...names.flatMap((n) => ['-e', n]),
    RUNNER, 'bash', '-c', script]
  const r = docker(args, { env: { ...process.env, ...env } })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const runBackup = (over = {}, opsDir = OPS) => inRunner('bash /ops/backup.sh', {
  BACKUP_DATABASE_URL: backupUrl(), AGE_RECIPIENT: recipient, PGSSLROOTCERT: '/certs/ca.crt', RESTORE_URL: RESTORE, OUT: '/out', ...over,
}, opsDir)
const psqlOrigem = (sql) => docker(['exec', '-i', C.origem, 'psql', '-U', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql })
const ownerSums = () => docker(['exec', '-i', C.origem, 'bash', '-c',
  'source /ops-real/restauro-comum.sh; restored_sums "postgresql:///postgres?host=/var/run/postgresql&user=postgres"']).stdout.trim()
let recipient = ''

async function waitReady(name) {
  for (let i = 0; i < 90; i++) {
    const logs = docker(['logs', name])
    if (`${logs.stdout}${logs.stderr}`.includes('PostgreSQL init process complete') &&
      docker(['exec', name, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) return
    await pause(1000)
  }
  throw new Error(`${name} não ficou pronto`)
}
function cleanup() {
  for (const n of Object.values(C)) docker(['rm', '-f', n])
  docker(['network', 'rm', NET])
  docker(['rmi', '-f', RUNNER])
}

try {
  for (const n of Object.values(C)) {
    if (docker(['ps', '-aq', '--filter', `name=^${n}$`]).stdout.trim()) throw new Error(`contêiner ${n} já existe`)
  }
  const build = docker(['build', '-q', '-t', RUNNER, '-'], {
    input: `FROM ${IMAGE}\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends age >/dev/null && rm -rf /var/lib/apt/lists/*\n`,
  })
  if (build.status !== 0) throw new Error(`imagem com o age: ${build.stderr.slice(-300)}`)
  if (docker(['network', 'create', NET]).status !== 0) throw new Error('rede não criada')

  // CA de teste, outra CA, certificado de servidor só pra "origem"; chave age descartável
  const gen = docker(['run', '--rm', '-v', `${join(work, 'certs')}:/c`, '-w', '/c', RUNNER, 'sh', '-c', [
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj /CN=sf-teste-ca',
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout outra.key -out outra.crt -days 30 -subj /CN=sf-outra-ca',
    'openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj /CN=origem',
    'printf "subjectAltName=DNS:origem\\n" > san.ext',
    'openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 30 -extfile san.ext',
    'printf "local all all trust\\nhostssl all all all scram-sha-256\\n" > pg_hba.conf', 'chmod 644 *'].join(' && ')])
  if (gen.status !== 0) throw new Error(`openssl: ${gen.stderr.slice(-300)}`)
  const keys = inRunner('age-keygen -o /keys/chave.txt 2>/dev/null && age-keygen -y /keys/chave.txt')
  recipient = keys.out.trim().split('\n').at(-1)
  if (!/^age1[0-9a-z]+$/.test(recipient)) throw new Error('chave age descartável não gerada')

  const up = (name, alias, extra) => {
    const r = docker(['run', '-d', '--name', name, '--network', NET, '--network-alias', alias, ...extra],
      { env: { ...process.env, POSTGRES_PASSWORD: pwPostgres } })
    if (r.status !== 0) throw new Error(`${name}: ${r.stderr.slice(-200)}`)
  }
  up(C.origem, 'origem', ['--network-alias', 'outro-nome', '-e', 'POSTGRES_PASSWORD', '-v', `${join(work, 'certs')}:/work:ro`,
    '-v', `${join(ROOT, 'backend')}:/b:ro`, '-v', `${REAL_OPS}:/ops-real:ro`, '-v', `${join(work, 'sh')}:/sh:ro`,
    '--entrypoint', 'sh', IMAGE, '-c',
    'mkdir -p /certs && cp /work/server.crt /work/server.key /work/pg_hba.conf /certs/ && chown postgres /certs/* && chmod 600 /certs/server.key && ' +
    'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key -c hba_file=/certs/pg_hba.conf'])
  // (POSTGRES_PASSWORD vem do ambiente do docker, não da linha de comando)
  up(C.restaurado, 'restaurado', ['-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE])
  up(C.semPapeis, 'sem-papeis', ['-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE])
  up(C.semSupabase, 'sem-supabase', ['-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE])
  await Promise.all(Object.values(C).map(waitReady))

  for (const f of readdirSync(join(ROOT, 'backend', 'migrations')).sort()) {
    const r = docker(['exec', C.origem, 'psql', '-U', 'postgres', '-X', '-q', '-1', '-v', 'ON_ERROR_STOP=1', '-f', `/b/migrations/${f}`])
    if (r.status !== 0) throw new Error(`migração ${f}: ${r.stderr.slice(0, 200)}`)
  }
  const seed = docker(['exec', C.origem, 'psql', '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/b/seeds/dev_seed.sql'])
  if (seed.status !== 0) throw new Error(`seed: ${seed.stderr.slice(0, 200)}`)
  const role = psqlOrigem(`ALTER ROLE studyflow_backup LOGIN PASSWORD '${pwBackup}';`)
  if (role.status !== 0) throw new Error('papel de backup sem login')
  const roles = docker(['exec', C.semPapeis, 'psql', '-U', 'postgres', '-X', '-A', '-t', '-c',
    "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'studyflow_%'"]).stdout.trim()
  check('"sem-papeis" começa sem studyflow_api nem studyflow_backup', roles === '0', roles)

  // ---- 1. backup normal
  const before = ownerSums()
  const one = runBackup()
  check('backup normal: saída 0 e "OK: 17 tabelas"', one.code === 0 && /OK: 17 tabelas, \d+ linhas/.test(one.out), one.out)
  check('backup normal: conferência do restaurado 17 / 17 / 34', /= 17 17 34/.test(one.out), one.out)
  const files = readdirSync(join(work, 'out')).filter((f) => f.endsWith('.dump.age'))
  const file = files.at(-1)
  const head = file ? readFileSync(join(work, 'out', file)).subarray(0, 21).toString() : ''
  check('o arquivo sai cifrado (age-encryption.org/v1)', files.length === 1 && head === 'age-encryption.org/v1', `${files} ${head}`)
  const raw = file ? readFileSync(join(work, 'out', file)).toString('latin1') : ''
  check('o arquivo cifrado não contém texto do seed nem o cabeçalho do pg_dump',
    !raw.includes('PGDMP') && !raw.includes('Vestibular'), 'texto puro no arquivo')
  // Ponto 1: restaurar num cluster SEM os papéis quebra; com o restaurar.sh (que os cria) passa
  const bare = inRunner(
    `psql "${SEM_PAPEIS}" -X -q -c "CREATE DATABASE cru TEMPLATE template0" && ` +
    `psql "${SEM_PAPEIS.replace('/postgres?', '/cru?')}" -X -q -c "DROP SCHEMA public" && ` +
    `age -d -i /keys/chave.txt /out/${file} | pg_restore --exit-on-error --single-transaction -d "${SEM_PAPEIS.replace('/postgres?', '/cru?')}"`)
  check('restaurar SEM criar os papéis antes: falha com "role … does not exist"',
    bare.code !== 0 && /role "studyflow_(api|backup)" does not exist/.test(bare.out), bare.out)
  const restored = inRunner('bash /ops/restaurar.sh', { BACKUP_FILE: `/out/${file}`, AGE_IDENTITY: '/keys/chave.txt', RESTORE_URL: SEM_PAPEIS })
  const restoredSums = restored.out.split('\n').filter((l) => /^\w+ \d+ [0-9a-f]{32}$/.test(l)).join('\n')
  check('restaurar.sh no cluster sem os papéis: saída 0, 17 / 17 / 34', restored.code === 0 && /= 17 17 34/.test(restored.out), restored.out)
  check('restaurar.sh: contagem e md5 das 17 tabelas = as do DONO na origem',
    restoredSums === before && before.split('\n').length === 17, `${restoredSums.split('\n').length} linhas`)
  const made = docker(['exec', C.semPapeis, 'psql', '-U', 'postgres', '-X', '-A', '-t', '-c',
    "SELECT string_agg(rolname || ':' || rolcanlogin, ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'studyflow_%'"]).stdout.trim()
  check('restaurar.sh criou os dois papéis SEM login', made === 'studyflow_api:false,studyflow_backup:false', made)

  // ---- 1b. origem estilo Supabase: os papéis e os privilégios padrão que um dump do Supabase cita (SUPABASE_ROLES, ops/restauro-comum.sh)
  const SB = ['anon', 'authenticated', 'service_role', 'supabase_admin', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user']
  const sbHere = () => docker(['exec', C.semSupabase, 'psql', '-U', 'postgres', '-X', '-A', '-t', '-c',
    `SELECT string_agg(rolname || ':' || rolcanlogin, ',' ORDER BY rolname COLLATE "C") FROM pg_roles WHERE rolname IN (${SB.map((r) => `'${r}'`).join(',')})`]).stdout.trim()
  check('"sem-supabase" começa sem nenhum dos 8 papéis do Supabase', sbHere() === '', sbHere())
  const sbSetup = psqlOrigem(`${SB.map((r) => `CREATE ROLE ${r} NOLOGIN;`).join(' ')}
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    GRANT SELECT ON public.tasks TO authenticator, supabase_auth_admin, supabase_storage_admin, dashboard_user;`)
  check('origem estilo Supabase preparada (8 papéis, privilégios padrão e GRANTs)', sbSetup.status === 0, sbSetup.stderr)
  const sbBackup = runBackup()
  check('backup da origem estilo Supabase: saída 0 e "OK: 17 tabelas" (o alvo de teste do backup.sh recebe os papéis)',
    sbBackup.code === 0 && /OK: 17 tabelas, \d+ linhas/.test(sbBackup.out), sbBackup.out)
  const sbFile = readdirSync(join(work, 'out')).filter((f) => f.endsWith('.dump.age')).sort().at(-1)
  const sbTarget = (db) => SEM_SUPABASE.replace('/postgres?', `/${db}?`)
  // Só os dois studyflow_* existem aqui: o 1º papel a faltar no dump TEM que ser um do Supabase
  const sbPre = docker(['exec', C.semSupabase, 'psql', '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE studyflow_api NOLOGIN; CREATE ROLE studyflow_backup NOLOGIN;'])
  check('"sem-supabase" recebe só studyflow_api e studyflow_backup', sbPre.status === 0, sbPre.stderr)
  // Controle: um papel FORA da lista (cópia do ops/ sem o supabase_admin). A restauração falha e o erro NOMEIA o papel
  // (é o que torna a lista fácil de estender), no backup.sh e no restaurar.sh; os outros 7 ficam criados no cluster
  const opsSemAdmin = join(work, 'ops-sem-admin')
  mkdirSync(opsSemAdmin)
  for (const f of ['backup.sh', 'restaurar.sh', 'restauro-comum.sh']) {
    const text = readFileSync(join(OPS, f), 'utf8')
    writeFileSync(join(opsSemAdmin, f), f === 'restauro-comum.sh' ? text.replace(' supabase_admin ', ' ') : text)
  }
  const MISSING = /papel ausente no alvo de restauração: supabase_admin \(acrescente à lista SUPABASE_ROLES/
  const sbBackupMissing = runBackup({ RESTORE_URL: SEM_SUPABASE }, opsSemAdmin)
  check('backup.sh com papel fora da lista (supabase_admin): a restauração de teste FALHA e o erro nomeia o papel e a lista a estender',
    sbBackupMissing.code !== 0 && MISSING.test(sbBackupMissing.out), sbBackupMissing.out)
  const sbBare = inRunner(
    `psql "${SEM_SUPABASE}" -X -q -c "CREATE DATABASE cru2 TEMPLATE template0" && ` +
    `psql "${sbTarget('cru2')}" -X -q -c "DROP SCHEMA public" && ` +
    `age -d -i /keys/chave.txt /out/${sbFile} | pg_restore --exit-on-error --single-transaction -d "${sbTarget('cru2')}"`)
  check('restaurar SEM o supabase_admin no cluster: falha com "role … does not exist" de um papel do Supabase',
    sbBare.code !== 0 && new RegExp(`role "(${SB.join('|')})" does not exist`).test(sbBare.out), sbBare.out)
  const restoreEnv = { BACKUP_FILE: `/out/${sbFile}`, AGE_IDENTITY: '/keys/chave.txt', RESTORE_URL: SEM_SUPABASE }
  const sbMissing = inRunner('bash /ops/restaurar.sh', restoreEnv, opsSemAdmin)
  check('restaurar.sh com papel fora da lista (supabase_admin): a restauração FALHA e o erro nomeia o papel e a lista a estender',
    sbMissing.code !== 0 && MISSING.test(sbMissing.out), sbMissing.out)
  const sbRestored = inRunner('bash /ops/restaurar.sh', restoreEnv)
  const sbSums = sbRestored.out.split('\n').filter((l) => /^\w+ \d+ [0-9a-f]{32}$/.test(l)).join('\n')
  const ownerNow = ownerSums()
  check('restaurar.sh no cluster sem os papéis do Supabase: saída 0, 17 / 17 / 34 e somas = as do DONO',
    sbRestored.code === 0 && /= 17 17 34/.test(sbRestored.out) && sbSums === ownerNow && ownerNow.split('\n').length === 17, sbRestored.out)
  check('os 8 papéis do Supabase criados SEM login (os 7 que a restauração anterior deixou ficam como estavam)',
    sbHere() === [...SB].sort().map((r) => `${r}:false`).join(','), sbHere())
  const sbAgain = inRunner('bash /ops/restaurar.sh', restoreEnv)
  check('restaurar.sh de novo no mesmo cluster (os papéis já existem): saída 0 (IF NOT EXISTS)',
    sbAgain.code === 0 && /= 17 17 34/.test(sbAgain.out), sbAgain.out)

  // Controle negativo da comparação: uma linha alterada no restaurado faz o job falhar
  // nomeando as tabelas (sem a alteração, o backup normal acima passa)
  const tampered = runBackup({ RESTORE_TAMPER_SQL:
    "UPDATE tags SET name = name || ' (alterado)' WHERE id = (SELECT min(id::text)::uuid FROM tags); " +
    "UPDATE works SET title = title || ' (alterado)' WHERE id = (SELECT min(id::text)::uuid FROM works);" })
  check('controle negativo: linha alterada em tags e works no restaurado, o job FALHA nomeando as duas',
    tampered.code !== 0 && /controle negativo/.test(tampered.out) && /não bate com a origem \(contagem ou md5\): tags,works\s*$/m.test(tampered.out),
    tampered.out)

  // ---- 2. gravação concorrente durante o backup (o snapshot fecha a corrida)
  writeFileSync(join(work, 'sh', 'escritor.sh'),
    'i=0; while [ ! -f /tmp/parar ]; do i=$((i+1)); psql -U postgres -X -q -c "INSERT INTO tags (name, level) VALUES (\'escritor-$i\', 1)"; sleep 0.02; done\n')
  const count = () => Number(psqlOrigem("SELECT count(*) FROM tags WHERE name LIKE 'escritor-%';").stdout.trim())
  docker(['exec', '-d', C.origem, 'bash', '/sh/escritor.sh'])
  await pause(1500)
  const w0 = count()
  const two = runBackup()
  const w1 = count()
  docker(['exec', C.origem, 'touch', '/tmp/parar'])
  check(`gravação concorrente (${w1 - w0} inserções durante o backup): saída 0, restauração bate com o snapshot`,
    w1 - w0 >= 10 && two.code === 0 && /OK: 17 tabelas/.test(two.out), `${w1 - w0} inserções; ${two.out}`)

  // ---- 3. recusas
  const ssl = runBackup({ BACKUP_DATABASE_URL: `${backupUrl()}?sslmode=require` })
  check('sslmode na URL: recusa citando o parâmetro', ssl.code !== 0 && /parâmetro sslmode/.test(ssl.out), ssl.out)
  const ssl2 = runBackup({ BACKUP_DATABASE_URL: `${backupUrl()}?application_name=x&SSLROOTCERT=/x` })
  check('sslrootcert em maiúsculas depois de outro parâmetro: recusa', ssl2.code !== 0 && /parâmetro sslrootcert/.test(ssl2.out), ssl2.out)
  const wrongCa = runBackup({ PGSSLROOTCERT: '/certs/outra.crt' })
  check('outra CA: não conecta (verify-full)', wrongCa.code !== 0 && /não conectou à origem/.test(wrongCa.out), wrongCa.out)
  // Com o sslrootcert, o libpq trata require como verify-ca: só o nome separa os dois
  const wrongName = runBackup({ BACKUP_DATABASE_URL: backupUrl().replace('@origem:', '@outro-nome:') })
  check('CA certa, nome do host fora do certificado: não conecta (verify-full confere o nome)',
    wrongName.code !== 0 && /não conectou à origem/.test(wrongName.out), wrongName.out)
  psqlOrigem('CREATE TABLE public.sem_politica (id int); ALTER TABLE public.sem_politica ENABLE ROW LEVEL SECURITY; INSERT INTO public.sem_politica VALUES (1), (2), (3);')
  const noPolicy = runBackup()
  check('tabela com RLS e sem a política: recusa citando a tabela', noPolicy.code !== 0 && /sem a política backup_leitura.*sem_politica/.test(noPolicy.out), noPolicy.out)
  psqlOrigem('DROP TABLE public.sem_politica;')
  psqlOrigem("CREATE TABLE public.politica_falsa (id int); ALTER TABLE public.politica_falsa ENABLE ROW LEVEL SECURITY; INSERT INTO public.politica_falsa VALUES (1); CREATE POLICY backup_leitura ON public.politica_falsa FOR SELECT TO studyflow_backup USING (false);")
  const falsePolicy = runBackup()
  check('política backup_leitura que não lê tudo (USING false): recusa citando a tabela',
    falsePolicy.code !== 0 && /sem a política backup_leitura.*politica_falsa/.test(falsePolicy.out), falsePolicy.out)
  psqlOrigem('DROP TABLE public.politica_falsa;')
  psqlOrigem(`ALTER ROLE postgres PASSWORD '${pwPostgres}';`)
  const owner = runBackup({ BACKUP_DATABASE_URL: backupUrl('postgres', pwPostgres) })
  check('URL de outro papel (postgres): recusa', owner.code !== 0 && /não é do papel studyflow_backup/.test(owner.out), owner.out)

  const all = [keys, one, bare, restored, sbBackup, sbBackupMissing, sbBare, sbMissing, sbRestored, sbAgain, tampered, two, ssl, ssl2, wrongCa, wrongName, noPolicy, falsePolicy, owner].map((r) => r.out).join('\n')
  check('nenhuma saída mostra a senha nem a URL', !leaks(all), 'vazou')
} catch (err) {
  check(`ferramenta sem erro inesperado: ${err.message}`, false)
} finally {
  cleanup()
  rmSync(work, { recursive: true, force: true })
  const left = Object.values(C).filter((n) => docker(['ps', '-aq', '--filter', `name=^${n}$`]).stdout.trim())
  check('contêineres, rede, imagem e pasta temporária apagados',
    left.length === 0 && !existsSync(work) && docker(['image', 'inspect', RUNNER]).status !== 0, left.join(','))
  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length}`)
  process.exitCode = ok === results.length && ok > 0 ? 0 : 1
}
