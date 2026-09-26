import { Link } from 'react-router'
import { isSameLocalDay } from '../dates'
import { frequencyLabels } from '../frequency'
import { iconButtonClass, inlineButtonClass } from '../styles'
import type {
  CompletedExecution,
  NewTask,
  Task as TaskModel,
  TaskExecution,
  TimeEntry,
} from '../types'
import { ArchiveIcon, HistoryIcon, PencilIcon, UnarchiveIcon } from './icons'
import ExecutionEditForm from './ExecutionEditForm'
import ExecutionHistory from './ExecutionHistory'
import TaskForm from './TaskForm'

// Type guard: garante completedAt não-nulo pro TypeScript
function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

// Exportado pro Tasks.tsx coordenar entre linhas
export type OpenForm = 'edit' | 'edit-execution' | 'history' | null

function Task(props: {
  task: TaskModel
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  openForm: OpenForm
  onToggle: (form: NonNullable<OpenForm>) => void
  onEdit: (taskId: string, changes: NewTask) => Promise<void>
  onArchive: (taskId: string) => void
  onReactivate: (taskId: string) => void
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => void
}) {
  const { id, title, frequency, active } = props.task
  const { openForm, onToggle } = props

  // Tudo abaixo é derivado de executions: nada disso é guardado em estado
  const completed = props.executions.filter(isCompleted)

  const last = completed.reduce<CompletedExecution | null>(
    (latest, execution) =>
      latest === null || execution.completedAt > latest.completedAt
        ? execution
        : latest,
    null,
  )

  const now = new Date()
  const doneToday = completed.some((execution) =>
    isSameLocalDay(new Date(execution.completedAt), now),
  )

  const openExecution = props.executions.find(
    (execution) => execution.completedAt === null,
  )

  function handleArchive() {
    const confirmed = window.confirm(
      `Arquivar "${title}"? A tarefa some da lista, mas pode ser vista de novo ligando "Mostrar arquivadas" — o histórico de execuções continua guardado.`,
    )
    if (confirmed) props.onArchive(id)
  }

  return (
    <li className="border-b border-linha py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <p className="font-semibold break-words">
            <span
              // transition-colors fixo aqui, não junto do grifo — senão não há o que animar
              className={`transition-colors duration-300 ${
                doneToday
                  ? '-mx-1 box-decoration-clone bg-marca-texto px-1 text-sobre-marca'
                  : ''
              }`}
            >
              {title}
            </span>
            {!active && (
              <span className="ml-2 text-sm font-normal text-tinta-suave">
                (arquivada)
              </span>
            )}
          </p>
          {frequency !== 'none' && (
            <p className="text-sm text-tinta-suave">
              {frequencyLabels[frequency]}
            </p>
          )}
          {openExecution && (
            <p className="text-sm text-tinta-suave">
              Em andamento{' · '}
              <Link to={`/executar?tarefa=${id}`} className={inlineButtonClass}>
                retomar
              </Link>
            </p>
          )}
          {last !== null && (
            <p className="text-sm text-tinta-suave">
              Feita {completed.length}{' '}
              {completed.length === 1 ? 'vez' : 'vezes'}, última em{' '}
              {new Date(last.completedAt).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
              })}
              {' · '}
              <button
                type="button"
                onClick={() => onToggle('edit-execution')}
                aria-expanded={openForm === 'edit-execution'}
                aria-label={`${openForm === 'edit-execution' ? 'Cancelar edição do' : 'Editar'} último registro de ${title}`}
                className={inlineButtonClass}
              >
                {openForm === 'edit-execution' ? 'cancelar' : 'editar'}
              </button>
            </p>
          )}
          {last?.description && (
            <p className="text-sm text-tinta-suave break-words">
              Último registro: {last.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {active && (
            <button
              type="button"
              onClick={() => onToggle('edit')}
              aria-expanded={openForm === 'edit'}
              aria-label={`${openForm === 'edit' ? 'Cancelar edição de' : 'Editar'} ${title}`}
              title={openForm === 'edit' ? 'Cancelar' : 'Editar'}
              className={iconButtonClass}
            >
              <PencilIcon />
            </button>
          )}
          {completed.length > 0 && (
            <button
              type="button"
              onClick={() => onToggle('history')}
              aria-expanded={openForm === 'history'}
              aria-label={`${openForm === 'history' ? 'Fechar' : 'Ver'} histórico de ${title}`}
              title={openForm === 'history' ? 'Fechar' : 'Histórico'}
              className={iconButtonClass}
            >
              <HistoryIcon />
            </button>
          )}
          {!active && (
            <button
              type="button"
              onClick={() => props.onReactivate(id)}
              aria-label={`Reativar ${title}`}
              title="Reativar"
              className={iconButtonClass}
            >
              <UnarchiveIcon />
            </button>
          )}
          {active && (
            <button
              type="button"
              onClick={handleArchive}
              aria-label={`Arquivar ${title}`}
              title="Arquivar"
              className={iconButtonClass}
            >
              <ArchiveIcon />
            </button>
          )}
        </div>
      </div>
      {active && openForm === 'edit' && (
        <TaskForm
          task={props.task}
          onSubmit={async (changes) => {
            await props.onEdit(id, changes)
            onToggle('edit')
          }}
        />
      )}
      {openForm === 'edit-execution' && last !== null && (
        <ExecutionEditForm
          execution={last}
          onSubmit={async (changes) => {
            await props.onEditExecution(last.id, changes)
            onToggle('edit-execution')
          }}
        />
      )}
      {openForm === 'history' && (
        <ExecutionHistory
          executions={completed}
          timeEntries={props.timeEntries}
          onEdit={props.onEditExecution}
          onEditTimeEntry={props.onEditTimeEntry}
        />
      )}
    </li>
  )
}

export default Task
