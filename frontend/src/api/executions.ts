import type {
  ExecutionChanges,
  QuantityChoice,
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
  } & Partial<TagChoice> &
    Partial<QuantityChoice>,
): Promise<SavedExecution> {
  return request<SavedExecution>('/executions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Sem rootTagId/tagIds no corpo, o servidor não mexe nas tags; sem
// estimatedMinutes, mantém a estimativa; sem quantity, mantém a quantidade
function putExecution(
  id: string,
  changes: {
    description: string | null
    completedAt: string | null
    estimatedMinutes?: number | null
  } & Partial<TagChoice> &
    Partial<QuantityChoice>,
): Promise<SavedExecution> {
  return request<SavedExecution>(`/executions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

// Registrar sem cronômetro: o "Quando", a duração estimada e a quantidade
// vêm da tela
export function createExecution(
  taskId: string,
  description: string,
  completedAt: string,
  tags: TagChoice,
  estimatedMinutes: number | null,
  quantity: QuantityChoice,
): Promise<SavedExecution> {
  return postExecution({
    taskId,
    description,
    completedAt,
    ...tags,
    ...(estimatedMinutes ? { estimatedMinutes } : {}),
    ...(quantity.quantity !== null ? quantity : {}),
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
  quantity: QuantityChoice,
): Promise<SavedExecution> {
  return putExecution(id, {
    description,
    completedAt: new Date().toISOString(),
    ...tags,
    ...quantity,
  })
}

// Desfazer volta tudo ao que era: descrição, tags e quantidade de antes
// (ausente, o servidor manteria a do Finalizar)
export function reopenExecution(
  id: string,
  previousDescription: string | null,
  previousTags: TagChoice,
  previousQuantity: QuantityChoice,
): Promise<SavedExecution> {
  return putExecution(id, {
    description: previousDescription,
    completedAt: null,
    ...previousTags,
    ...previousQuantity,
  })
}

export function editExecution(
  id: string,
  changes: ExecutionChanges,
): Promise<SavedExecution> {
  return putExecution(id, changes)
}
