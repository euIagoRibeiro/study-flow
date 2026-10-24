import type { Exercise } from '../types'
import { ApiError, request } from './client'

export function listExercises(): Promise<Exercise[]> {
  return request<Exercise[]>('/exercises')
}

// Nome repetido (catálogo da tela desatualizado): o 409 traz o existente,
// e quem chamou recebe ele, como se tivesse criado
export async function createExercise(name: string): Promise<Exercise> {
  try {
    return await request<Exercise>('/exercises', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      typeof error.body === 'object' &&
      error.body !== null &&
      'exercise' in error.body
    ) {
      return error.body.exercise as Exercise
    }
    throw error
  }
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
