import { useEffect } from 'react'
import type { MeasureTexts } from './measures'
import { phases } from './phases'
import type { Phase, WorkoutExercise } from './types'

// Rascunho de formulário só na TELA (sessão do navegador), N3 (2026-10-26):
// ir a "gerenciar tags" (ou a qualquer outra tela) e voltar não perde o que
// foi digitado. Nada vai pro servidor. Existe enquanto o formulário estiver
// DIFERENTE do intocado; some ao gravar, ao cancelar ou no "descartar".
// Sessão do navegador indisponível ou rascunho com lixo: como se não houvesse
export const draftKeys = {
  registrar: (taskId: string) => `studyflow:rascunho:registrar:${taskId}`,
  editar: (executionId: string) => `studyflow:rascunho:editar:${executionId}`,
}

export function readDraft(key: string): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // sem a sessão do navegador: não havia o que apagar
  }
}

// Grava a "foto" do formulário só quando ela difere do formulário intocado;
// voltar tudo ao que era apaga o rascunho
export function useDraftSync(key: string, snapshot: object, pristine: object) {
  const current = JSON.stringify(snapshot)
  const original = JSON.stringify(pristine)
  useEffect(() => {
    try {
      if (current === original) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, current)
    } catch {
      // sem a sessão do navegador: o rascunho vive só enquanto a tela está aberta
    }
  }, [key, current, original])
}

// Conferências do que se lê de volta (o que está na sessão é texto livre)
export const isText = (value: unknown): value is string =>
  typeof value === 'string'

export function isPhase(value: unknown): value is Phase | null {
  return value === null || phases.includes(value as Phase)
}

export function isTexts(value: unknown): value is MeasureTexts {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((text) => typeof text === 'string')
  )
}

export function isWorkout(value: unknown): value is WorkoutExercise[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item?.exerciseId === 'string' &&
        Array.isArray(item.sets) &&
        item.sets.every(
          (set: { reps?: unknown; weightKg?: unknown }) =>
            typeof set?.reps === 'number' &&
            (set.weightKg === null || typeof set.weightKg === 'number'),
        ),
    )
  )
}
