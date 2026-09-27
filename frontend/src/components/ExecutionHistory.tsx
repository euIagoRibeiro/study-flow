import { useState } from 'react'
import {
  formatDayLabel,
  formatDuration,
  formatTime,
  localDayKey,
} from '../dates'
import { frequencyLabels } from '../frequency'
import { cardClass, chipClass, textButtonClass } from '../styles'
import type { CompletedExecution, TimeEntry } from '../types'
import CompactIconButton from './CompactIconButton'
import ExecutionEditForm from './ExecutionEditForm'
import { ChevronDownIcon, PencilIcon } from './icons'
import TimeEntryEditForm from './TimeEntryEditForm'

type Item = {
  execution: CompletedExecution
  entries: TimeEntry[]
  totalMs: number
}

// Sessão encerrada usa o próprio fim; a última de uma execução finalizada
// fecha junto com ela (transação do servidor)
function entryMs(entry: TimeEntry, execution: CompletedExecution) {
  const end = entry.endedAt ?? execution.completedAt
  return new Date(end).getTime() - new Date(entry.startedAt).getTime()
}

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
  // Sessões começam recolhidas: guarda só as execuções abertas
  const [openSessions, setOpenSessions] = useState<Set<string>>(() => new Set())

  function toggleSessions(id: string) {
    setOpenSessions((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sorted = [...props.executions].sort((a, b) =>
    a.completedAt < b.completedAt ? 1 : -1,
  )

  // Agrupa por dia local; como já vem ordenado, cada dia é um bloco contínuo
  const now = new Date()
  const groups: { key: string; label: string; items: Item[] }[] = []
  for (const execution of sorted) {
    const entries = props.timeEntries
      .filter((entry) => entry.taskExecutionId === execution.id)
      .sort((a, b) => (a.startedAt > b.startedAt ? 1 : -1))
    const totalMs = entries.reduce(
      (sum, entry) => sum + entryMs(entry, execution),
      0,
    )
    const item = { execution, entries, totalMs }
    const key = localDayKey(execution.completedAt)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(item)
    else
      groups.push({
        key,
        label: formatDayLabel(execution.completedAt, now),
        items: [item],
      })
  }

  function renderCard({ execution, entries, totalMs }: Item) {
    const dateLabel = new Date(execution.completedAt).toLocaleDateString(
      'pt-BR',
    )
    const editing = editingId === execution.id
    const sessionsOpen = openSessions.has(execution.id)

    return (
      <article className={`${cardClass} flex flex-col gap-1`}>
        <div className="flex items-baseline gap-3">
          <h4 className="min-w-0 flex-1 font-titulo text-base font-semibold break-words">
            {execution.taskTitleAtTime}
          </h4>
          {entries.length > 0 && (
            <span className="shrink-0 font-dados text-conteudo font-semibold tabular-nums">
              {formatDuration(totalMs)}
            </span>
          )}
        </div>
        {execution.description && (
          <p className="font-texto text-conteudo break-words">
            {execution.description}
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-dados text-meta text-tinta-suave">
            <span className="tabular-nums">
              {formatTime(execution.completedAt)}
            </span>
            {execution.taskFrequencyAtTime !== 'none' && (
              <span className={chipClass}>
                {frequencyLabels[execution.taskFrequencyAtTime]}
              </span>
            )}
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => toggleSessions(execution.id)}
                aria-expanded={sessionsOpen}
                className={textButtonClass}
              >
                {entries.length} {entries.length === 1 ? 'sessão' : 'sessões'}
                <ChevronDownIcon
                  className={`h-4 w-4 transition-transform ${sessionsOpen ? 'rotate-180' : ''}`}
                />
              </button>
            )}
          </div>
          <CompactIconButton
            onClick={() => setEditingId(editing ? null : execution.id)}
            expanded={editing}
            label={`${editing ? 'Cancelar edição do' : 'Editar'} registro de ${dateLabel}`}
            title={editing ? 'Cancelar edição' : 'Editar registro'}
            className="-my-1.5 -mr-2"
          >
            <PencilIcon />
          </CompactIconButton>
        </div>
        {editing && (
          <ExecutionEditForm
            execution={execution}
            onSubmit={async (changes) => {
              await props.onEdit(execution.id, changes)
              setEditingId(null)
            }}
          />
        )}
        {entries.length > 0 && sessionsOpen && (
          <ul className="mt-1 flex flex-col border-t border-dashed border-linha pt-1">
            {entries.map((entry) => {
              const start = formatTime(entry.startedAt)
              const end = formatTime(entry.endedAt ?? execution.completedAt)
              const editingEntry = editingEntryId === entry.id
              return (
                <li key={entry.id}>
                  <div className="flex items-center justify-between font-dados text-meta text-tinta-suave tabular-nums">
                    <span>
                      {start}–{end} ·{' '}
                      {formatDuration(entryMs(entry, execution))}
                    </span>
                    <CompactIconButton
                      onClick={() =>
                        setEditingEntryId(editingEntry ? null : entry.id)
                      }
                      expanded={editingEntry}
                      label={`${editingEntry ? 'Cancelar edição da' : 'Editar'} sessão das ${start}`}
                      title={editingEntry ? 'Cancelar edição' : 'Editar sessão'}
                      className="-mr-2"
                    >
                      <PencilIcon />
                    </CompactIconButton>
                  </div>
                  {editingEntry && (
                    <TimeEntryEditForm
                      entry={entry}
                      onSubmit={async (changes) => {
                        await props.onEditTimeEntry(entry.id, changes)
                        setEditingEntryId(null)
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </article>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        // Total do dia: soma do que está na tela, derivado — não é Dashboard
        const dayMs = group.items.reduce((sum, item) => sum + item.totalMs, 0)
        return (
          <section key={group.key} aria-label={group.label}>
            <h3 className="mb-2 flex items-baseline justify-between font-dados text-xs font-bold tracking-wider text-tinta-suave uppercase">
              <span>{group.label}</span>
              {dayMs > 0 && (
                <span className="text-meta tracking-normal normal-case tabular-nums">
                  {formatDuration(dayMs)}
                </span>
              )}
            </h3>
            <ul className="flex flex-col gap-2.5">
              {group.items.map((item) => (
                <li key={item.execution.id}>{renderCard(item)}</li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export default ExecutionHistory
