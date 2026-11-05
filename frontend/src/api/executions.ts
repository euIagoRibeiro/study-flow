import type {
  ExecutionChanges,
  MeasureValue,
  SavedExecution,
  StartDraft,
  TagChoice,
  TaskExecution,
  WorkLink,
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
    selectionOptionIds?: string[]
  } & Partial<TagChoice> &
    Partial<WorkLink>,
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
    selectionOptionIds?: string[]
  } & Partial<TagChoice> &
    Partial<WorkLink>,
): Promise<SavedExecution> {
  return request<SavedExecution>(`/executions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

// Obra e link só quando há: ausente = nenhum
const workLinkBody = (link: WorkLink | undefined) => ({
  ...(link?.workId ? { workId: link.workId } : {}),
  ...(link?.linkUrl ? { linkUrl: link.linkUrl } : {}),
})

// Registrar sem cronômetro: o "Quando", a duração estimada e a medida vêm
// da tela (o servidor descobre QUAL medida pelo caminho)
export function createExecution(
  taskId: string,
  description: string,
  completedAt: string,
  tags: TagChoice,
  estimatedMinutes: number | null,
  measureValues: MeasureValue[],
  selectionOptionIds: string[],
  link: WorkLink,
): Promise<SavedExecution> {
  return postExecution({
    taskId,
    description,
    completedAt,
    ...tags,
    ...(estimatedMinutes ? { estimatedMinutes } : {}),
    ...(measureValues.length > 0 ? { measureValues } : {}),
    ...(selectionOptionIds.length > 0 ? { selectionOptionIds } : {}),
    ...workLinkBody(link),
  })
}

// Aberta: cronômetro rodando. Com rascunho, já nasce com o caminho, a
// descrição, as seleções, a obra e o link do formulário de baixo (a seção
// Treino aparece na hora)
export function startExecution(
  taskId: string,
  draft?: StartDraft,
): Promise<SavedExecution> {
  return postExecution({
    taskId,
    description: draft?.description ? draft.description : null,
    completedAt: null,
    ...draft?.tags,
    ...(draft?.selectionOptionIds.length
      ? { selectionOptionIds: draft.selectionOptionIds }
      : {}),
    ...workLinkBody(draft),
  })
}

// measureValues e selectionOptionIds undefined = não mexer (o servidor mantém);
// obra e link só os que vierem (null limpa)
export function finishExecution(
  id: string,
  description: string,
  tags: Partial<TagChoice>,
  measureValues: MeasureValue[] | undefined,
  selectionOptionIds: string[] | undefined,
  link: Partial<WorkLink>,
): Promise<SavedExecution> {
  return putExecution(id, {
    description,
    completedAt: new Date().toISOString(),
    ...tags,
    ...(measureValues ? { measureValues } : {}),
    ...(selectionOptionIds ? { selectionOptionIds } : {}),
    ...link,
  })
}

// Desfazer volta tudo ao que era: descrição, tags, medida, treino e seleções de
// antes (ausentes, o servidor manteria os do Finalizar); obra e link, os que o
// Finalizar mudou
export function reopenExecution(
  id: string,
  previousDescription: string | null,
  previousTags: TagChoice,
  previousMeasureValues: MeasureValue[],
  previousWorkout: WorkoutExercise[],
  previousSelectionOptionIds: string[],
  previousLink: Partial<WorkLink>,
): Promise<SavedExecution> {
  return putExecution(id, {
    description: previousDescription,
    completedAt: null,
    ...previousTags,
    measureValues: previousMeasureValues,
    workout: previousWorkout,
    selectionOptionIds: previousSelectionOptionIds,
    ...previousLink,
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
