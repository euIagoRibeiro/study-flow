import { useState } from 'react'
import { formatDuration } from '../dates'
import { frequencyLabels } from '../frequency'
import { inlineButtonClass } from '../styles'
import type { CompletedExecution, TimeEntry } from '../types'
import ExecutionEditForm from './ExecutionEditForm'
import TimeEntryEditForm from './TimeEntryEditForm'

function ExecutionHistory(props: {
  executions: CompletedExecution[]
  timeEntries: TimeEntry[]
  onEdit: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
}) {
  // Qual execução está em edição (descrição/data) — sem relação com qual
  // sessão de tempo está em edição, são coisas independentes
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)

  const sorted = [...props.executions].sort((a, b) =>
    a.completedAt < b.completedAt ? 1 : -1,
  )

  return (
    <ul className="mt-3 flex flex-col gap-3 border-t border-linha pt-3">
      {sorted.map((execution) => {
        const entries = props.timeEntries
          .filter((entry) => entry.taskExecutionId === execution.id)
          .sort((a, b) => (a.startedAt > b.startedAt ? 1 : -1))
        const totalMs = entries.reduce((sum, entry) => {
          const end = entry.endedAt ?? execution.completedAt
          return (
            sum +
            (new Date(end).getTime() - new Date(entry.startedAt).getTime())
          )
        }, 0)

        return (
          <li key={execution.id}>
            <p className="text-sm text-tinta-suave">
              {new Date(execution.completedAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' · '}
              {execution.taskTitleAtTime}
              {execution.taskFrequencyAtTime !== 'none' &&
                ` · ${frequencyLabels[execution.taskFrequencyAtTime]}`}
            </p>
            <p className="text-sm text-tinta-suave break-words">
              {execution.description ?? 'Sem descrição'}
              {' · '}
              <button
                type="button"
                onClick={() =>
                  setEditingId(editingId === execution.id ? null : execution.id)
                }
                aria-expanded={editingId === execution.id}
                aria-label={`${editingId === execution.id ? 'Cancelar edição do' : 'Editar'} registro de ${new Date(execution.completedAt).toLocaleDateString('pt-BR')}`}
                className={inlineButtonClass}
              >
                {editingId === execution.id ? 'cancelar' : 'editar'}
              </button>
            </p>
            {editingId === execution.id && (
              <ExecutionEditForm
                execution={execution}
                onSubmit={async (changes) => {
                  await props.onEdit(execution.id, changes)
                  setEditingId(null)
                }}
              />
            )}
            {entries.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 border-l border-linha pl-3">
                <p className="text-sm text-tinta-suave">
                  Tempo: {formatDuration(totalMs)} ({entries.length}{' '}
                  {entries.length === 1 ? 'sessão' : 'sessões'})
                </p>
                {entries.map((entry) => {
                  const end = entry.endedAt ?? execution.completedAt
                  const entryMs =
                    new Date(end).getTime() -
                    new Date(entry.startedAt).getTime()
                  return (
                    <div key={entry.id}>
                      <p className="text-sm text-tinta-suave">
                        {new Date(entry.startedAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        -
                        {new Date(end).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        ({formatDuration(entryMs)}){' · '}
                        <button
                          type="button"
                          onClick={() =>
                            setEditingEntryId(
                              editingEntryId === entry.id ? null : entry.id,
                            )
                          }
                          aria-expanded={editingEntryId === entry.id}
                          className={inlineButtonClass}
                        >
                          {editingEntryId === entry.id ? 'cancelar' : 'editar'}
                        </button>
                      </p>
                      {editingEntryId === entry.id && (
                        <TimeEntryEditForm
                          entry={entry}
                          onSubmit={async (changes) => {
                            await props.onEditTimeEntry(entry.id, changes)
                            setEditingEntryId(null)
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default ExecutionHistory
