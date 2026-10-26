import type {
  ExecutionChanges,
  MeasureValue,
  SavedExecution,
  StartDraft,
  TagChoice,
  TaskExecution,
  WorkoutExercise,
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
    workout?: WorkoutExercise[]
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

// Aberta: cronômetro rodando. Com rascunho, já nasce com o caminho e a
// descrição do formulário de baixo (a seção Treino aparece na hora)
export function startExecution(
  taskId: string,
  draft?: StartDraft,
): Promise<SavedExecution> {
  return postExecution({
    taskId,
    description: draft?.description ? draft.description : null,
    completedAt: null,
    ...draft?.tags,
  })
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

// Desfazer volta tudo ao que era: descrição, tags, medida e treino de antes
// (ausentes, o servidor manteria os do Finalizar)
export function reopenExecution(
  id: string,
  previousDescription: string | null,
  previousTags: TagChoice,
  previousMeasureValues: MeasureValue[],
  previousWorkout: WorkoutExercise[],
): Promise<SavedExecution> {
  return putExecution(id, {
    description: previousDescription,
    completedAt: null,
    ...previousTags,
    measureValues: previousMeasureValues,
    workout: previousWorkout,
  })
}

// Treino ao vivo, com o caminho já gravado: só o treino (o PUT do registro
// regravaria a descrição que está sendo digitada)
export function saveWorkout(
  id: string,
  workout: WorkoutExercise[],
): Promise<SavedExecution> {
  return request<SavedExecution>(`/executions/${id}/workout`, {
    method: 'PUT',
    body: JSON.stringify({ workout }),
  })
}

// Caminho ainda não gravado (1º exercício, ou Academia → Casa): caminho e
// treino num pedido só, com a descrição JÁ gravada, não a do campo
export function saveWorkoutWithPath(
  id: string,
  savedDescription: string | null,
  tags: TagChoice,
  workout: WorkoutExercise[],
): Promise<SavedExecution> {
  return putExecution(id, {
    description: savedDescription,
    completedAt: null,
    ...tags,
    workout,
  })
}

export function editExecution(
  id: string,
  changes: ExecutionChanges,
): Promise<SavedExecution> {
  return putExecution(id, changes)
}
