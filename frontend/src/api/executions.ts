import type {
  ExecutionChanges,
  MeasureValue,
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
    measureValues?: MeasureValue[]
  } & Partial<TagChoice>,
): Promise<SavedExecution> {
  return request<SavedExecution>('/executions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Sem rootTagId/tagIds no corpo, o servidor não mexe nas tags; sem
// estimatedMinutes, mantém a estimativa; sem measureValues, mantém a medida
function putExecution(
  id: string,
  changes: {
    description: string | null
    completedAt: string | null
    estimatedMinutes?: number | null
    measureValues?: MeasureValue[]
  } & Partial<TagChoice>,
): Promise<SavedExecution> {
  return request<SavedExecution>(`/executions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

// Registrar sem cronômetro: o "Quando", a duração estimada e a medida vêm
// da tela (o servidor descobre QUAL medida pelo caminho)
export function createExecution(
  taskId: string,
  description: string,
  completedAt: string,
  tags: TagChoice,
  estimatedMinutes: number | null,
  measureValues: MeasureValue[],
): Promise<SavedExecution> {
  return postExecution({
    taskId,
    description,
    completedAt,
    ...tags,
    ...(estimatedMinutes ? { estimatedMinutes } : {}),
    ...(measureValues.length > 0 ? { measureValues } : {}),
  })
}

export function startExecution(taskId: string): Promise<SavedExecution> {
  // aberta: cronômetro rodando
  return postExecution({ taskId, description: null, completedAt: null })
}

// measureValues undefined = não mexer na medida (o servidor mantém)
export function finishExecution(
  id: string,
  description: string,
  tags: Partial<TagChoice>,
  measureValues: MeasureValue[] | undefined,
): Promise<SavedExecution> {
  return putExecution(id, {
    description,
    completedAt: new Date().toISOString(),
    ...tags,
    ...(measureValues ? { measureValues } : {}),
  })
}

// Desfazer volta tudo ao que era: descrição, tags e medida de antes
// (ausente, o servidor manteria a do Finalizar)
export function reopenExecution(
  id: string,
  previousDescription: string | null,
  previousTags: TagChoice,
  previousMeasureValues: MeasureValue[],
): Promise<SavedExecution> {
  return putExecution(id, {
    description: previousDescription,
    completedAt: null,
    ...previousTags,
    measureValues: previousMeasureValues,
  })
}

export function editExecution(
  id: string,
  changes: ExecutionChanges,
): Promise<SavedExecution> {
  return putExecution(id, changes)
}
