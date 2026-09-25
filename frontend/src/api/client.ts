const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('VITE_API_URL não definida no frontend/.env')
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
    throw new Error(`${method} ${path} falhou com status ${response.status}`)
  }
  return response.json()
}
