import type { TimeEntry } from '../types'
import { request } from './client'

export function listTimeEntries(): Promise<TimeEntry[]> {
  return request<TimeEntry[]>('/time-entries')
}

export function startTimeEntry(taskExecutionId: string): TimeEntry {
  return {
    id: crypto.randomUUID(),
    taskExecutionId,
    startedAt: new Date().toISOString(),
    endedAt: null,
  }
}

export function stopTimeEntry(entry: TimeEntry): TimeEntry {
  return { ...entry, endedAt: new Date().toISOString() }
}

export function resumeTimeEntry(entry: TimeEntry): TimeEntry {
  return { ...entry, endedAt: null }
}

export function editTimeEntry(
  entry: TimeEntry,
  changes: { startedAt: string; endedAt: string },
): TimeEntry {
  return { ...entry, startedAt: changes.startedAt, endedAt: changes.endedAt }
}
