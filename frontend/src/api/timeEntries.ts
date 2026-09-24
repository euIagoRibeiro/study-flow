import type { TimeEntry } from '../types'

export function listTimeEntries(): TimeEntry[] {
  return []
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
