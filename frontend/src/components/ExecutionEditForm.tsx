import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, primaryButtonClass } from '../styles'
import { executionSelection, indexTags, pathToChoice } from '../tags'
import type { CompletedExecution, ExecutionChanges, Tag } from '../types'
import FormError from './FormError'
import TagFields from './TagFields'

function ExecutionEditForm(props: {
  execution: CompletedExecution
  tags: Tag[]
  onSubmit: (changes: ExecutionChanges) => Promise<unknown>
}) {
  const { execution } = props
  const [description, setDescription] = useState(execution.description ?? '')
  const [completedAt, setCompletedAt] = useState(
    toDatetimeLocalValue(execution.completedAt),
  )
  const [selection, setSelection] = useState(() =>
    executionSelection(execution, indexTags(props.tags)),
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
        // Registro antigo com mais de uma folha, sem mexer nas tags: não
        // manda tags, e o servidor mantém as que estavam
        ...(selection.legacyCount > 0 ? {} : pathToChoice(selection.path)),
      })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : 'Não foi possível salvar. Tente de novo.',
      )
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
        <TagFields
          tags={props.tags}
          value={selection.path}
          onChange={(path) => setSelection({ path, legacyCount: 0 })}
          // Tudo que o registro já tem continua escolhível, mesmo arquivado
          keep={[
            ...(execution.rootTagId ? [execution.rootTagId] : []),
            ...execution.tagIds,
          ]}
          legacyCount={selection.legacyCount}
        />
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
