import { useState, type FormEvent } from 'react'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, primaryButtonClass } from '../styles'
import type { CompletedExecution } from '../types'

function ExecutionEditForm(props: {
  execution: CompletedExecution
  onSubmit: (changes: { description: string; completedAt: string }) => void
}) {
  const [description, setDescription] = useState(
    props.execution.description ?? '',
  )
  const [completedAt, setCompletedAt] = useState(
    toDatetimeLocalValue(props.execution.completedAt),
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onSubmit({
      description: description.trim(),
      completedAt: fromDatetimeLocalValue(completedAt),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
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
      <label className="flex flex-col gap-1">
        <span className="text-sm text-tinta-suave">Quando</span>
        <input
          type="datetime-local"
          value={completedAt}
          onChange={(event) => setCompletedAt(event.target.value)}
          required
          className={fieldClass}
        />
      </label>
      <button type="submit" className={primaryButtonClass}>
        Salvar
      </button>
    </form>
  )
}

export default ExecutionEditForm
