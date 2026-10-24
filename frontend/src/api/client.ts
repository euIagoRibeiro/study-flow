const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('VITE_API_URL não definida no frontend/.env')
}

// Carrega o status HTTP, pra quem chamou distinguir, por exemplo, um 409
// (conflito com o estado atual) de uma falha qualquer
export class ApiError extends Error {
  status: number
  // O corpo da resposta, quando o servidor manda mais que o motivo (ex.: o
  // 409 do exercício traz o existente)
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    // Content-Type só quando tem corpo: num GET, ele forçaria um preflight à toa
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
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
    throw new ApiError(response.status, message, body)
  }
  // 204 não tem corpo (ex.: DELETE): response.json() quebraria
  if (response.status === 204) return undefined as T
  return response.json()
}
