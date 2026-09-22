import { useState } from 'react'
import { isSameLocalDay } from '../dates'
import { frequencyLabels } from '../frequency'
import { secondaryButtonClass } from '../styles'
import type {
  CompletedExecution,
  NewTask,
  Task as TaskModel,
  TaskExecution,
} from '../types'
import ExecutionForm from './ExecutionForm'
import TaskForm from './TaskForm'

// Type guard: dentro do filter, o TypeScript passa a saber que sobrou só
// execução com completedAt preenchido
function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

type OpenForm = 'execute' | 'edit' | null

function Task(props: {
  task: TaskModel
  executions: TaskExecution[]
  onExecute: (taskId: string, description: string) => void
  onEdit: (taskId: string, changes: NewTask) => void
  onArchive: (taskId: string) => void
}) {
  const { id, title, frequency } = props.task
  // Só um formulário aberto por vez: abrir um substitui o outro, em vez de
  // precisar lembrar de fechar o anterior manualmente
  const [openForm, setOpenForm] = useState<OpenForm>(null)

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

  function toggle(form: Exclude<OpenForm, null>) {
    setOpenForm(openForm === form ? null : form)
  }

  function handleArchive() {
    const confirmed = window.confirm(
      `Arquivar "${title}"? A tarefa some da lista, mas o histórico de execuções continua guardado.`,
    )
    if (confirmed) props.onArchive(id)
  }

  return (
    <li className="border-b border-linha py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <p className="font-semibold break-words">
            <span
              className={
                doneToday
                  ? '-mx-1 box-decoration-clone bg-marca-texto px-1 text-sobre-marca'
                  : ''
              }
            >
              {title}
            </span>
          </p>
          {frequency !== 'none' && (
            <p className="text-sm text-tinta-suave">
              {frequencyLabels[frequency]}
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
            </p>
          )}
          {last?.description && (
            <p className="text-sm text-tinta-suave break-words">
              Último registro: {last.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => toggle('execute')}
            aria-expanded={openForm === 'execute'}
            aria-label={`${openForm === 'execute' ? 'Cancelar' : 'Efetuar'} ${title}`}
            className={secondaryButtonClass}
          >
            {openForm === 'execute' ? 'Cancelar' : 'Efetuar'}
          </button>
          <button
            type="button"
            onClick={() => toggle('edit')}
            aria-expanded={openForm === 'edit'}
            aria-label={`${openForm === 'edit' ? 'Cancelar' : 'Editar'} ${title}`}
            className={secondaryButtonClass}
          >
            {openForm === 'edit' ? 'Cancelar' : 'Editar'}
          </button>
          <button
            type="button"
            onClick={handleArchive}
            aria-label={`Arquivar ${title}`}
            className={secondaryButtonClass}
          >
            Arquivar
          </button>
        </div>
      </div>
      {openForm === 'execute' && (
        <ExecutionForm
          onSubmit={(description) => {
            props.onExecute(id, description)
            setOpenForm(null)
          }}
        />
      )}
      {openForm === 'edit' && (
        <TaskForm
          task={props.task}
          onSubmit={(changes) => {
            props.onEdit(id, changes)
            setOpenForm(null)
          }}
        />
      )}
    </li>
  )
}

export default Task
