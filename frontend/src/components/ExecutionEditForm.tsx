import { useState, type FormEvent } from 'react'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, primaryButtonClass } from '../styles'
import type { CompletedExecution } from '../types'
import FormError from './FormError'

function ExecutionEditForm(props: {
  execution: CompletedExecution
  onSubmit: (changes: {
    description: string
    completedAt: string
  }) => Promise<unknown>
}) {
  const [description, setDescription] = useState(
    props.execution.description ?? '',
  )
  const [completedAt, setCompletedAt] = useState(
    toDatetimeLocalValue(props.execution.completedAt),
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await props.onSubmit({
        description: description.trim(),
        completedAt: fromDatetimeLocalValue(completedAt),
      })
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
      {/* Sempre empilhado: o form vive dentro de um cartão, e na linha única
          (antes, a partir de sm) os campos de data não encolhiam e empurravam
          o Salvar pra fora do cartão */}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
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
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-tinta-suave">Quando</span>
          <input
            type="datetime-local"
            value={completedAt}
            onChange={(event) => setCompletedAt(event.target.value)}
            required
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className={`w-full ${primaryButtonClass}`}
        >
          Salvar
        </button>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  )
}

export default ExecutionEditForm
