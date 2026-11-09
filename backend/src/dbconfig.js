import tls from 'node:tls'

// Conexão com o banco: fora da própria máquina, só com SSL verificado pela CA de
// DATABASE_CA_CERT; sem ela, a API não sobe. As mensagens citam só nomes de
// variável e de parâmetro, nunca o valor da URL
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
// O pg deixa estes parâmetros da URL passarem por cima do objeto ssl
const SSL_PARAMS = [
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
  'uselibpqcompat',
]

export function dbConfig(env) {
  const connectionString = env.DATABASE_URL ?? ''
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error('DATABASE_URL ausente ou sem postgres:// no começo')
  }
  let url
  let host
  try {
    url = new URL(connectionString)
    // Como o pg: o parâmetro host da URL ganha do nome antes da porta
    host = url.searchParams.get('host') || decodeURIComponent(url.hostname)
  } catch {
    throw new Error('DATABASE_URL inválida')
  }
  for (const key of url.searchParams.keys()) {
    const param = SSL_PARAMS.find((p) => p === key.toLowerCase())
    if (param) {
      throw new Error(
        `DATABASE_URL com o parâmetro ${param}: o SSL vem só de DATABASE_CA_CERT; tire-o da URL`,
      )
    }
  }
  // Sem host, o pg usaria o PGHOST do ambiente
  if (!host) throw new Error('DATABASE_URL sem host')

  const ca = env.DATABASE_CA_CERT ?? ''
  if (ca && !ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('DATABASE_CA_CERT não é um certificado PEM')
  }
  const bare = host.replace(/^\[(.*)\]$/, '$1')
  if (!LOCAL_HOSTS.has(bare)) {
    if (!ca) {
      throw new Error(
        'DATABASE_CA_CERT ausente: fora desta máquina, o banco só com o certificado verificado',
      )
    }
    if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined) {
      throw new Error(
        'NODE_TLS_REJECT_UNAUTHORIZED definida: ela mexe na verificação de certificados do Node inteiro; tire-a do ambiente',
      )
    }
  }
  // ssl: false explícito no local sem CA: senão o pg leria o PGSSLMODE do ambiente.
  // Com IP no host, o pg não passa o nome ao TLS e o Node confere o certificado
  // contra "localhost": a conferência é sempre contra o host da URL
  return {
    connectionString,
    ssl: ca
      ? {
          ca,
          rejectUnauthorized: true,
          checkServerIdentity: (_name, cert) =>
            tls.checkServerIdentity(bare, cert),
        }
      : false,
  }
}
