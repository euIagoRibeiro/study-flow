import { useState } from 'react'
import { useSearchParams } from 'react-router'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import FrequencySelect, {
  type FrequencyFilter,
} from '../components/FrequencySelect'
import TaskForm from '../components/TaskForm'
import Tasks from '../components/Tasks'
import { PlusIcon } from '../components/icons'
import { isSameLocalDay } from '../dates'
import { frequencyLabels } from '../frequency'
import { cardClass, focusRing, inlineButtonClass } from '../styles'
import { compareNames, indexTags, lastRootPath } from '../tags'
import type {
  Measure,
  WorkoutCatalog,
  ExecutionChanges,
  NewTask,
  Tag,
  Task,
  TaskExecution,
  TimeEntry,
} from '../types'

// Filtro de contexto: 'all', 'none' (sem contexto) ou o id da raiz
const ALL = 'all'
const NO_CONTEXT = 'none'

function TaskListPage(props: {
  tasks: Task[]
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  tags: Tag[]
  measures: Measure[]
  workoutCatalog: WorkoutCatalog
  onCreate: (task: NewTask) => Promise<string>
  onEdit: (taskId: string, changes: NewTask) => Promise<void>
  onArchive: (taskId: string) => void
  onReactivate: (taskId: string) => void
  onEditExecution: (
    executionId: string,
    changes: ExecutionChanges,
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
}) {
  const [showArchived, setShowArchived] = useState(false)
  // Criar é raro, ver a lista é o uso de todo dia: o formulário fica recolhido
  const [creating, setCreating] = useState(false)
  // Filtros na URL: sobrevivem a ir pro Executar e voltar, e "Lista" na
  // navegação (que leva pra "/") limpa
  const [searchParams, setSearchParams] = useSearchParams()

  const tagsById = indexTags(props.tags)
  // Contexto da tarefa = o do registro mais recente com tag (a mesma regra
  // da pré-seleção ao registrar). Nunca teve tag, ou a raiz foi
  // arquivada: sem contexto
  const contextOf = new Map(
    props.tasks.map((task) => [
      task.id,
      lastRootPath(props.executions, task.id, tagsById)[0] ?? NO_CONTEXT,
    ]),
  )

  const frequencyParam = searchParams.get('frequencia')
  const frequency: FrequencyFilter =
    frequencyParam !== null && Object.hasOwn(frequencyLabels, frequencyParam)
      ? (frequencyParam as FrequencyFilter)
      : ALL
  const contextParam = searchParams.get('contexto') ?? ALL
  const roots = props.tags
    .filter((tag) => tag.parentId === null && tag.active)
    .sort((a, b) => compareNames(a.name, b.name))
  const context =
    contextParam === NO_CONTEXT || roots.some((r) => r.id === contextParam)
      ? contextParam
      : ALL

  function setFilter(key: 'contexto' | 'frequencia', value: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === ALL) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }
  const clearFilters = () => setSearchParams({}, { replace: true })

  // Antes do filtro de contexto: é sobre isso que os chips contam
  const byFrequency = props.tasks.filter(
    (task) =>
      (showArchived || task.active) &&
      (frequency === ALL || task.frequency === frequency),
  )
  const countIn = (value: string) =>
    byFrequency.filter((task) => contextOf.get(task.id) === value).length

  // Chip sem tarefa some, menos o escolhido: trocar em silêncio um filtro
  // que a pessoa escolheu esconderia o motivo da lista vazia
  const contextOptions: ChipOption<string>[] = [
    { value: ALL, label: 'Todos', count: byFrequency.length },
    ...roots.map((root) => ({
      value: root.id,
      label: root.name,
      count: countIn(root.id),
    })),
    { value: NO_CONTEXT, label: 'Sem contexto', count: countIn(NO_CONTEXT) },
  ].filter((option) => option.count > 0 || option.value === context)

  const visibleTasks = byFrequency
    .filter((task) => context === ALL || contextOf.get(task.id) === context)
    // ativas primeiro, sem mudar a ordem de criação dentro de cada grupo
    .sort((a, b) => Number(b.active) - Number(a.active))

  const anyTask = props.tasks.some((task) => showArchived || task.active)

  // "N de M feitas hoje": M = ativas que o filtro mostra (arquivada não é
  // tarefa a fazer); feita hoje = a mesma regra do grifo do cartão
  const now = new Date()
  const doneToday = new Set(
    props.executions
      .filter(
        (execution) =>
          execution.completedAt !== null &&
          isSameLocalDay(new Date(execution.completedAt), now),
      )
      .map((execution) => execution.taskId),
  )
  const toDo = visibleTasks.filter((task) => task.active)
  const done = toDo.filter((task) => doneToday.has(task.id)).length

  return (
    <div className="flex flex-col gap-4">
      {creating ? (
        <div className={cardClass}>
          <TaskForm
            autoFocus
            onSubmit={async (newTask) => {
              await props.onCreate(newTask)
              setCreating(false)
              // Senão a tarefa nova (sem contexto) podia nascer escondida
              clearFilters()
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={`flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-tinta-suave/55 font-semibold text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`}
        >
          <PlusIcon />
          Nova tarefa
        </button>
      )}
      <div className="flex flex-col gap-1.5 border-b border-linha pb-3.5">
        {/* Só "Todos" e "Sem contexto" não teriam o que filtrar */}
        {contextOptions.length > 2 && (
          <FilterChips
            label="Contexto"
            options={contextOptions}
            value={context}
            onChange={(value) => setFilter('contexto', value)}
          />
        )}
        <FrequencySelect
          value={frequency}
          onChange={(value) => setFilter('frequencia', value)}
        />
        <label className="flex items-center gap-2 px-0.5 text-sm text-tinta-suave">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Mostrar arquivadas
        </label>
      </div>
      {!anyTask ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          Nenhuma tarefa ainda. Crie a primeira em "Nova tarefa".
        </p>
      ) : visibleTasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          Nenhuma tarefa com esses filtros.{' '}
          <button
            type="button"
            onClick={clearFilters}
            className={inlineButtonClass}
          >
            Limpar filtros
          </button>
        </p>
      ) : (
        <>
          {toDo.length > 0 && (
            <p className="-mb-1 px-0.5 font-dados text-meta text-tinta-suave tabular-nums">
              {done} de {toDo.length} {done === 1 ? 'feita' : 'feitas'} hoje
            </p>
          )}
          <Tasks
            tasks={visibleTasks}
            executions={props.executions}
            timeEntries={props.timeEntries}
            tags={props.tags}
            measures={props.measures}
            workoutCatalog={props.workoutCatalog}
            onEdit={props.onEdit}
            onArchive={props.onArchive}
            onReactivate={props.onReactivate}
            onEditExecution={props.onEditExecution}
            onEditTimeEntry={props.onEditTimeEntry}
          />
        </>
      )}
    </div>
  )
}

export default TaskListPage
