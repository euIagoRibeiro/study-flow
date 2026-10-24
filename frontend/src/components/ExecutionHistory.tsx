import { useState } from 'react'
import {
  formatDayLabel,
  formatDuration,
  formatTime,
  localDayKey,
} from '../dates'
import { frequencyLabels } from '../frequency'
import { describeValue } from '../measures'
import { phaseLabels } from '../phases'
import { cardClass, chipClass, tagChipClass, textButtonClass } from '../styles'
import { indexTags, leafTags, tagLineage } from '../tags'
import type {
  CompletedExecution,
  ExecutionChanges,
  Measure,
  Tag,
  TimeEntry,
  WorkoutCatalog,
} from '../types'
import { formatSets } from '../workouts'
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
  tags: Tag[]
  measures: Measure[]
  workoutCatalog: WorkoutCatalog
  onEdit: (executionId: string, changes: ExecutionChanges) => Promise<void>
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
  // Treino também começa recolhido ("3 exercícios ⌄"), independente das sessões
  const [openWorkouts, setOpenWorkouts] = useState<Set<string>>(() => new Set())

  function toggle(setter: typeof setOpenSessions, id: string) {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSessions = (id: string) => toggle(setOpenSessions, id)
  // Nome de hoje (renomear é dinâmico, como as tags); arquivado sem marca:
  // o registro é do passado
  const exerciseName = (id: string) =>
    props.workoutCatalog.exercises.find((x) => x.id === id)?.name ?? 'Exercício'

  const tagsById = indexTags(props.tags)

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
    const workoutOpen = openWorkouts.has(execution.id)
    const workout = execution.workout
    const leaves = leafTags(execution, tagsById)
    const estimate = entries.find((entry) => entry.estimated)
    const recordedMeasure = props.measures.find(
      (measure) => measure.id === execution.measure?.measureId,
    )
    // Tempo todo estimado: o cabeçalho diz. Misto (cronômetro + estimativa):
    // quem diz é a sessão estimada, na lista
    const allEstimated =
      entries.length > 0 && entries.every((entry) => entry.estimated)

    return (
      <article className={`${cardClass} flex flex-col gap-1`}>
        <div className="flex items-baseline gap-3">
          <h4 className="min-w-0 flex-1 font-titulo text-base font-semibold break-words">
            {execution.taskTitleAtTime}
          </h4>
          {entries.length > 0 && (
            <span className="shrink-0 font-dados text-conteudo font-semibold tabular-nums">
              {formatDuration(totalMs)}
              {allEstimated && (
                <span className="ml-1.5 text-meta font-normal text-tinta-suave">
                  estimado
                </span>
              )}
            </span>
          )}
        </div>
        {execution.description && (
          <p className="font-texto text-conteudo break-words">
            {execution.description}
          </p>
        )}
        {leaves.length > 0 && (
          <ul aria-label="Tags" className="flex flex-wrap gap-1.5 py-0.5">
            {leaves.map((tag) => (
              <li key={tag.id} className={tagChipClass}>
                {tagLineage(tag, tagsById)
                  .slice(0, -1)
                  .map((ancestor) => (
                    // O espaço no fim não aparece (fim de item flex), mas
                    // fica no texto: sem ele, leitor de tela e copiar/colar
                    // juntam "Exercícios ›Corrida"
                    <span key={ancestor.id} className="wrap-anywhere">
                      {`${ancestor.name} › `}
                    </span>
                  ))}
                <span className="font-semibold wrap-anywhere text-tinta">
                  {tag.name}
                </span>
              </li>
            ))}
            {execution.phase && (
              <li className={chipClass}>
                <span className="sr-only">Fase: </span>
                {phaseLabels[execution.phase]}
              </li>
            )}
          </ul>
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
            {/* Um chip por valor: cada um quebra sozinho em 320px */}
            {recordedMeasure &&
              execution.measure?.values.map((value) => (
                <span key={value.kindId ?? ''} className={chipClass}>
                  {describeValue(value, recordedMeasure)}
                </span>
              ))}
            {workout && (
              <button
                type="button"
                onClick={() => toggle(setOpenWorkouts, execution.id)}
                aria-expanded={workoutOpen}
                className={textButtonClass}
              >
                {workout.length === 1
                  ? '1 exercício'
                  : `${workout.length} exercícios`}
                <ChevronDownIcon
                  className={`h-4 w-4 transition-transform ${workoutOpen ? 'rotate-180' : ''}`}
                />
              </button>
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
            tags={props.tags}
            estimateMinutes={
              estimate
                ? Math.round(entryMs(estimate, execution) / 60_000)
                : null
            }
            measures={props.measures}
            workoutCatalog={props.workoutCatalog}
            onSubmit={async (changes) => {
              await props.onEdit(execution.id, changes)
              setEditingId(null)
            }}
          />
        )}
        {/* Nome e séries em duas linhas: nome longo é a regra (equipamento
            no nome) */}
        {workout && workoutOpen && (
          <ul
            aria-label="Treino"
            className="mt-1 flex flex-col gap-2 border-t border-dashed border-linha pt-2"
          >
            {workout.map((item) => (
              <li key={item.exerciseId} className="flex flex-col">
                <span className="text-conteudo break-words">
                  {exerciseName(item.exerciseId)}
                </span>
                <span className="font-dados text-meta text-tinta-suave tabular-nums">
                  {formatSets(item.sets)}
                </span>
              </li>
            ))}
          </ul>
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
                      {entry.estimated && ' · estimada'}
                    </span>
                    {/* Estimada: sem lápis, ajusta-se pelo registro (a âncora) */}
                    {!entry.estimated && (
                      <CompactIconButton
                        onClick={() =>
                          setEditingEntryId(editingEntry ? null : entry.id)
                        }
                        expanded={editingEntry}
                        label={`${editingEntry ? 'Cancelar edição da' : 'Editar'} sessão das ${start}`}
                        title={
                          editingEntry ? 'Cancelar edição' : 'Editar sessão'
                        }
                        className="-mr-2"
                      >
                        <PencilIcon />
                      </CompactIconButton>
                    )}
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
