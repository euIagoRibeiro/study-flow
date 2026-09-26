import type { TimeEntry } from '../types'
import { request } from './client'

export function listTimeEntries(): Promise<TimeEntry[]> {
  return request<TimeEntry[]>('/time-entries')
}

function putTimeEntry(
  id: string,
  changes: { startedAt: string; endedAt: string | null },
): Promise<TimeEntry> {
  return request<TimeEntry>(`/time-entries/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

// Sessão nova, sempre rodando: usada por "Iniciar cronômetro" e "Retomar"
export function startTimeEntry(taskExecutionId: string): Promise<TimeEntry> {
  return request<TimeEntry>('/time-entries', {
    method: 'POST',
    body: JSON.stringify({
      taskExecutionId,
      startedAt: new Date().toISOString(),
    }),
  })
}

export function stopTimeEntry(entry: TimeEntry): Promise<TimeEntry> {
  return putTimeEntry(entry.id, {
    startedAt: entry.startedAt,
    endedAt: new Date().toISOString(),
  })
}

// Reabre a MESMA sessão — só o "Desfazer" usa. "Retomar" cria uma nova
// (startTimeEntry), nunca reabre
export function reopenTimeEntry(entry: TimeEntry): Promise<TimeEntry> {
  return putTimeEntry(entry.id, { startedAt: entry.startedAt, endedAt: null })
}

export function editTimeEntry(
  id: string,
  changes: { startedAt: string; endedAt: string },
): Promise<TimeEntry> {
  return putTimeEntry(id, changes)
}
