import type { Selection, SelectionFields, SelectionOption } from '../types'
import { request } from './client'

// Todas, inclusive as arquivadas: a tela decide o que mostrar
export function listSelections(): Promise<Selection[]> {
  return request<Selection[]>('/selections')
}

// Seleção e opções num POST só (tudo ou nada); tagId null = global
export function createSelection(
  tagId: string | null,
  fields: SelectionFields,
  options: string[],
): Promise<Selection> {
  return request<Selection>('/selections', {
    method: 'POST',
    body: JSON.stringify({ tagId, ...fields, options }),
  })
}

export function updateSelection(
  id: string,
  changes: Partial<SelectionFields> & { active?: boolean },
): Promise<Selection> {
  return request<Selection>(`/selections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

// Só nunca usada (as opções vão junto); usada, o servidor recusa (409)
export function deleteSelection(id: string): Promise<void> {
  return request<void>(`/selections/${id}`, { method: 'DELETE' })
}

export function createOption(
  selectionId: string,
  name: string,
): Promise<SelectionOption> {
  return request<SelectionOption>('/selection-options', {
    method: 'POST',
    body: JSON.stringify({ selectionId, name }),
  })
}

export function updateOption(
  id: string,
  changes: { name?: string; active?: boolean },
): Promise<SelectionOption> {
  return request<SelectionOption>(`/selection-options/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

export function deleteOption(id: string): Promise<void> {
  return request<void>(`/selection-options/${id}`, { method: 'DELETE' })
}
