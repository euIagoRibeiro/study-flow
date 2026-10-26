import { formatQuantity } from './numbers'
import type { TagIndex } from './tags'
import type {
  Exercise,
  TaskExecution,
  WorkoutExercise,
  WorkoutSet,
} from './types'

// A marcadora do caminho: a tag mais funda que usa treino (a mesma regra da
// API). O caminho tem todos os níveis, da raiz pra baixo
export function workoutMarker(path: string[], byId: TagIndex): string | null {
  return [...path].reverse().find((id) => byId.get(id)?.tracksWorkout) ?? null
}

// Recentes no contexto: exercícios dos registros concluídos com a mesma
// marcadora, do uso mais recente pro mais antigo
export function recentExerciseIds(
  executions: TaskExecution[],
  markerId: string,
  byId: TagIndex,
): string[] {
  const ids: string[] = []
  const used = executions
    .filter(
      (execution) =>
        execution.workout &&
        execution.completedAt !== null &&
        workoutMarker(
          [
            ...(execution.rootTagId ? [execution.rootTagId] : []),
            ...execution.tagIds,
          ],
          byId,
        ) === markerId,
    )
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))
  for (const execution of used) {
    for (const item of execution.workout ?? []) {
      if (!ids.includes(item.exerciseId)) ids.push(item.exerciseId)
    }
  }
  return ids
}

// Filtro sem maiúscula nem acento: "triangulo" acha "triângulo" (também na
// busca de tags do Painel)
export function plain(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export function matchesFilter(exercise: Exercise, filter: string) {
  return plain(exercise.name).includes(plain(filter))
}

export function formatSet(set: WorkoutSet) {
  return set.weightKg === null
    ? `${set.reps} × peso do corpo`
    : `${set.reps} × ${formatQuantity(set.weightKg)} kg`
}

// Histórico: todas com peso, "kg" uma vez no fim; todas no corpo, "15, 12
// reps, peso do corpo"; misturado, cada série completa (o "kg" do fim
// ficaria ambíguo). Sem compactar repetidas: lê como foi anotado
export function formatSets(sets: WorkoutSet[]) {
  if (sets.every((set) => set.weightKg !== null)) {
    const all = sets.map(
      (set) => `${set.reps} × ${formatQuantity(set.weightKg ?? 0)}`,
    )
    return `${all.join(', ')} kg`
  }
  if (sets.every((set) => set.weightKg === null)) {
    return `${sets.map((set) => set.reps).join(', ')} reps, peso do corpo`
  }
  return sets.map(formatSet).join(', ')
}

// Exercício escolhido e sem série: o servidor recusaria (400). Quem salva
// trava com o motivo em vez de descartar em silêncio
export function emptyExerciseError(
  draft: WorkoutExercise[],
  exercises: Exercise[],
): string | null {
  const empty = draft.find((item) => item.sets.length === 0)
  if (!empty) return null
  const name =
    exercises.find((x) => x.id === empty.exerciseId)?.name ?? 'Um exercício'
  return `${name} está sem séries: adicione uma ou tire do treino.`
}

export function countSets(count: number) {
  return count === 0
    ? 'sem séries'
    : count === 1
      ? '1 série'
      : `${count} séries`
}

// "2 exercícios, 8 séries" (o aviso de troca de caminho)
export function describeWorkout(workout: WorkoutExercise[]) {
  const sets = workout.reduce((sum, item) => sum + item.sets.length, 0)
  const exercises =
    workout.length === 1 ? '1 exercício' : `${workout.length} exercícios`
  return `${exercises}, ${countSets(sets)}`
}

export const REPS_ERROR = 'Reps: número inteiro de 1 a 1000'
export const KG_ERROR =
  'Kg: número maior que zero, com até 2 casas (ex.: 22,5), até 9999,99'

// Campos da série (texto, nunca type="number"). Kg vazio = peso do corpo
export function parseSet(
  repsText: string,
  kgText: string,
): WorkoutSet | { error: string } {
  const reps = repsText.trim()
  if (!/^\d{1,4}$/.test(reps) || Number(reps) < 1 || Number(reps) > 1000) {
    return { error: REPS_ERROR }
  }
  const kg = kgText.trim()
  if (kg === '') return { reps: Number(reps), weightKg: null }
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(kg)) return { error: KG_ERROR }
  const weightKg = Number(kg.replace(',', '.'))
  return weightKg > 0 ? { reps: Number(reps), weightKg } : { error: KG_ERROR }
}
