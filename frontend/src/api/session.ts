import { request } from './client'

export const checkSession = () => request<{ ok: true }>('/session')

export const login = (password: string) =>
  request<void>('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

export const logout = () => request<void>('/logout', { method: 'POST' })
