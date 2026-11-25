// A borda do Render reaproveita conexões: o servidor tem que segurá-las mais que ela (o padrão do Node, 5 s, fecha antes)
export const KEEP_ALIVE_MS = 120000
export const HEADERS_MS = 121000

export function applyServerTimeouts(server) {
  server.keepAliveTimeout = KEEP_ALIVE_MS
  server.headersTimeout = HEADERS_MS
  return server
}
