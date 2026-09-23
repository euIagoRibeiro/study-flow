import { useState, type FormEvent } from 'react'
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../styles'
import type { TaskExecution, TimeEntry } from '../types'
import ElapsedTime from './ElapsedTime'

function TimerPanel(props: {
  execution: TaskExecution
  runningEntry: TimeEntry | undefined // undefined = pausado
  onStop: (entryId: string) => void
  onResume: (executionId: string) => void
  onFinish: (executionId: string, description: string) => void
}) {
  // Desestruturado: runningEntry como const local permite o TypeScript
  // estreitar o tipo dentro dos closures dos botões, sem precisar de "!"
  const { execution, runningEntry, onStop, onResume, onFinish } = props
  const [description, setDescription] = useState(execution.description ?? '')

  function handleFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onFinish(execution.id, description)
  }

  return (
    <div className="flex flex-col gap-3">
      {runningEntry ? (
        <div className="flex items-center justify-between">
          <p className="text-2xl font-semibold tabular-nums">
            <ElapsedTime startedAt={runningEntry.startedAt} />
          </p>
          <button
            type="button"
            onClick={() => onStop(runningEntry.id)}
            className={secondaryButtonClass}
          >
            Pausar
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-tinta-suave">Pausado</p>
          <button
            type="button"
            onClick={() => onResume(execution.id)}
            className={secondaryButtonClass}
          >
            Retomar
          </button>
        </div>
      )}
      <form
        onSubmit={handleFinish}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label className="flex flex-col gap-1 sm:flex-1">
          <span className="text-sm text-tinta-suave">
            O que foi feito (opcional)
          </span>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldClass}
          />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Finalizar
        </button>
      </form>
    </div>
  )
}

export default TimerPanel
