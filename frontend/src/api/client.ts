const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('VITE_API_URL não definida no frontend/.env')
}

export const SESSION_ENDED = 'Sua sessão terminou. Entre e toque de novo.'

// Carrega o status HTTP, pra quem chamou distinguir, por exemplo, um 409
// (conflito com o estado atual) de uma falha qualquer
export class ApiError extends Error {
  status: number
  // O corpo da resposta, quando o servidor manda mais que o motivo (ex.: o
  // 409 do exercício traz o existente)
  body: unknown
  // Segundos do Retry-After (429), quando vier
  retryAfter: number | null

  constructor(
    status: number,
    message: string,
    body?: unknown,
    retryAfter: number | null = null,
  ) {
    super(message)
    this.status = status
    this.body = body
    this.retryAfter = retryAfter
  }
}

// Um 401 fora do /login = a sessão venceu: quem mostra a tela de entrada
// (SessionGate) ouve aqui. O /login com 401 é só senha errada
let sessionEnded: (() => void) | null = null
export function onSessionEnded(listener: () => void) {
  sessionEnded = listener
  return () => {
    if (sessionEnded === listener) sessionEnded = null
  }
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    // X-StudyFlow em todo pedido: a API recusa DELETE sem ele (só um script da
    // mesma origem consegue mandá-lo). O cookie de sessão vai sozinho
    headers: options?.body
      ? { 'Content-Type': 'application/json', 'X-StudyFlow': '1' }
      : { 'X-StudyFlow': '1' },
  })

  if (!response.ok) {
    const method = options?.method ?? 'GET'
    // O servidor manda { error } com o motivo (ex.: nome repetido); sem
    // ele, fica a mensagem genérica
    let message = `${method} ${path} falhou com status ${response.status}`
    let body: unknown
    try {
      body = await response.json()
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
        message = body.error
      }
    } catch {
      // Resposta sem JSON: fica a genérica
    }
    if (response.status === 401 && path !== '/login') {
      sessionEnded?.()
      message = SESSION_ENDED
    }
    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new ApiError(
      response.status,
      message,
      body,
      retryAfter > 0 ? retryAfter : null,
    )
  }
  // 204 não tem corpo (ex.: DELETE): response.json() quebraria
  if (response.status === 204) return undefined as T
  return response.json()
}
