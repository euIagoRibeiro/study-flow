import { useState } from 'react'
import { isSameLocalDay } from '../dates'
import { frequencyLabels } from '../frequency'
import { secondaryButtonClass } from '../styles'
import type {
  CompletedExecution,
  Task as TaskModel,
  TaskExecution,
} from '../types'
import ExecutionForm from './ExecutionForm'

// Type guard: dentro do filter, o TypeScript passa a saber que sobrou só
// execução com completedAt preenchido
function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

function Task(props: {
  task: TaskModel
  executions: TaskExecution[]
  onExecute: (taskId: string, description: string) => void
}) {
  const { id, title, frequency } = props.task
  const [isOpen, setIsOpen] = useState(false)

  // Tudo abaixo é derivado de executions: nada disso é guardado em estado
  const completed = props.executions.filter(isCompleted)

  // A ISO em UTC tem sempre o mesmo formato, então comparar como string
  // equivale a comparar as datas
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

  return (
    <li className="border-b border-linha py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? 'Cancelar' : 'Efetuar'} ${title}`}
          className={secondaryButtonClass}
        >
          {isOpen ? 'Cancelar' : 'Efetuar'}
        </button>
      </div>
      {isOpen && (
        <ExecutionForm
          onSubmit={(description) => {
            props.onExecute(id, description)
            setIsOpen(false)
          }}
        />
      )}
    </li>
  )
}

export default Task
