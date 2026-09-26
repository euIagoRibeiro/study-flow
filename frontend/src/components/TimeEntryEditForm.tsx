import { useState, type FormEvent } from 'react'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, primaryButtonClass } from '../styles'
import type { TimeEntry } from '../types'

function TimeEntryEditForm(props: {
  entry: TimeEntry
  onSubmit: (changes: {
    startedAt: string
    endedAt: string
  }) => Promise<unknown>
}) {
  const [startedAt, setStartedAt] = useState(
    toDatetimeLocalValue(props.entry.startedAt),
  )
  const [endedAt, setEndedAt] = useState(
    toDatetimeLocalValue(props.entry.endedAt ?? new Date().toISOString()),
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const startedIso = fromDatetimeLocalValue(startedAt)
    const endedIso = fromDatetimeLocalValue(endedAt)
    if (endedIso <= startedIso) {
      setError('O fim precisa ser depois do início.')
      return
    }

    setSubmitting(true)
    try {
      await props.onSubmit({ startedAt: startedIso, endedAt: endedIso })
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 sm:flex-1">
          <span className="text-sm text-tinta-suave">Início</span>
          <input
            type="datetime-local"
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
            required
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 sm:flex-1">
          <span className="text-sm text-tinta-suave">Fim</span>
          <input
            type="datetime-local"
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
            required
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className={primaryButtonClass}
        >
          Salvar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold">
          {error}
        </p>
      )}
    </form>
  )
}

export default TimeEntryEditForm
