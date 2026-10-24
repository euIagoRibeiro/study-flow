import type { Exercise } from '../types'
import { request } from './client'

export function listExercises(): Promise<Exercise[]> {
  return request<Exercise[]>('/exercises')
}

// Nome repetido: 409 com o existente (o treino usa ele; A3e)
export function createExercise(name: string): Promise<Exercise> {
  return request<Exercise>('/exercises', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function updateExercise(
  id: string,
  changes: { name?: string; active?: boolean },
): Promise<Exercise> {
  return request<Exercise>(`/exercises/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

// Só nunca usado; usado: arquivar
export function deleteExercise(id: string): Promise<void> {
  return request<void>(`/exercises/${id}`, { method: 'DELETE' })
}
