import { loadConfig } from './auth.js'
import { dbConfig } from './dbconfig.js'

let config
try {
  config = loadConfig(process.env)
} catch (err) {
  console.error(`A API não sobe sem a trava: ${err.message}`)
  process.exit(1)
}
try {
  dbConfig(process.env)
} catch (err) {
  console.error(`A API não sobe sem o banco verificado: ${err.message}`)
  process.exit(1)
}
// O app.js carrega o db.js, que cria o Pool na importação: só depois da conferência
const { createApp } = await import('./app.js')

const port = process.env.PORT ?? 3333
// Só na própria máquina por padrão: sem host, o Node escutaria em todas as
// interfaces (a rede Wi-Fi inclusive). HOST sobrescreve
const host = process.env.HOST ?? '127.0.0.1'
createApp(config).listen(port, host, () =>
  console.log(
    `API rodando em http://${host}:${port} (limite geral: ${config.rateLimitPerMin} pedidos por minuto por IP)`,
  ),
)
