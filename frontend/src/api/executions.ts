import type { TaskExecution } from '../types'
import { request } from './client'

export function listExecutions(): Promise<TaskExecution[]> {
  return request<TaskExecution[]>('/executions')
}

// O snapshot (título/frequência) é copiado pelo servidor — não vai no corpo
function postExecution(
  taskId: string,
  description: string | null,
  completedAt: string | null,
): Promise<TaskExecution> {
  return request<TaskExecution>('/executions', {
    method: 'POST',
    body: JSON.stringify({ taskId, description, completedAt }),
  })
}

function putExecution(
  id: string,
  changes: { description: string | null; completedAt: string | null },
): Promise<TaskExecution> {
  return request<TaskExecution>(`/executions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

export function createExecution(
  taskId: string,
  description: string,
): Promise<TaskExecution> {
  return postExecution(taskId, description, new Date().toISOString())
}

export function startExecution(taskId: string): Promise<TaskExecution> {
  return postExecution(taskId, null, null) // aberta: cronômetro rodando
}

export function finishExecution(
  id: string,
  description: string,
): Promise<TaskExecution> {
  return putExecution(id, {
    description,
    completedAt: new Date().toISOString(),
  })
}

export function reopenExecution(
  id: string,
  previousDescription: string | null,
): Promise<TaskExecution> {
  return putExecution(id, {
    description: previousDescription,
    completedAt: null,
  })
}

export function editExecution(
  id: string,
  changes: { description: string; completedAt: string },
): Promise<TaskExecution> {
  return putExecution(id, changes)
}
