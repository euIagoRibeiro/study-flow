import type {
  ExecutionChanges,
  SavedExecution,
  TagChoice,
  TaskExecution,
} from '../types'
import { request } from './client'

export function listExecutions(): Promise<TaskExecution[]> {
  return request<TaskExecution[]>('/executions')
}

// O snapshot (título/frequência) é copiado pelo servidor — não vai no corpo
function postExecution(
  body: {
    taskId: string
    description: string | null
    completedAt: string | null
    estimatedMinutes?: number
  } & Partial<TagChoice>,
): Promise<SavedExecution> {
  return request<SavedExecution>('/executions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Sem rootTagId/tagIds no corpo, o servidor não mexe nas tags; sem
// estimatedMinutes, mantém a estimativa
function putExecution(
  id: string,
  changes: {
    description: string | null
    completedAt: string | null
    estimatedMinutes?: number | null
  } & Partial<TagChoice>,
): Promise<SavedExecution> {
  return request<SavedExecution>(`/executions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

// Registrar sem cronômetro: o "Quando" e a duração estimada vêm da tela
export function createExecution(
  taskId: string,
  description: string,
  completedAt: string,
  tags: TagChoice,
  estimatedMinutes: number | null,
): Promise<SavedExecution> {
  return postExecution({
    taskId,
    description,
    completedAt,
    ...tags,
    ...(estimatedMinutes ? { estimatedMinutes } : {}),
  })
}

export function startExecution(taskId: string): Promise<SavedExecution> {
  // aberta: cronômetro rodando
  return postExecution({ taskId, description: null, completedAt: null })
}

export function finishExecution(
  id: string,
  description: string,
  tags: Partial<TagChoice>,
): Promise<SavedExecution> {
  return putExecution(id, {
    description,
    completedAt: new Date().toISOString(),
    ...tags,
  })
}

// Desfazer volta tudo ao que era: descrição e tags de antes
export function reopenExecution(
  id: string,
  previousDescription: string | null,
  previousTags: TagChoice,
): Promise<SavedExecution> {
  return putExecution(id, {
    description: previousDescription,
    completedAt: null,
    ...previousTags,
  })
}

export function editExecution(
  id: string,
  changes: ExecutionChanges,
): Promise<SavedExecution> {
  return putExecution(id, changes)
}
