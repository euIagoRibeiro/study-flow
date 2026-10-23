import type { Measure, MeasureFields, MeasureKind } from '../types'
import { request } from './client'

export function listMeasures(): Promise<Measure[]> {
  return request<Measure[]>('/measures')
}

// Medida e tipos num POST só (tudo ou nada)
export function createMeasure(
  tagId: string,
  fields: MeasureFields,
  kinds: string[],
): Promise<Measure> {
  return request<Measure>('/measures', {
    method: 'POST',
    body: JSON.stringify({ tagId, ...fields, kinds }),
  })
}

export function updateMeasure(
  id: string,
  changes: Partial<MeasureFields> & { active?: boolean },
): Promise<Measure> {
  return request<Measure>(`/measures/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

// Só nunca usada (os tipos vão junto); usada, o servidor recusa (409)
export function deleteMeasure(id: string): Promise<void> {
  return request<void>(`/measures/${id}`, { method: 'DELETE' })
}

export function createKind(
  measureId: string,
  name: string,
): Promise<MeasureKind> {
  return request<MeasureKind>(`/measures/${measureId}/kinds`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function updateKind(
  id: string,
  changes: { name?: string; active?: boolean },
): Promise<MeasureKind> {
  return request<MeasureKind>(`/measure-kinds/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

export function deleteKind(id: string): Promise<void> {
  return request<void>(`/measure-kinds/${id}`, { method: 'DELETE' })
}
