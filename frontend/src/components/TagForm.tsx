import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../styles'
import FormError from './FormError'

// Criar (raiz ou subtag) e renomear. Sempre empilhado: mora dentro de
// cartão (a lição do TaskForm)
function TagForm(props: {
  label: string
  submitLabel: string
  initialName?: string
  onSubmit: (name: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = useState(props.initialName ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('Escreva um nome para a tag.')
      return
    }
    setSubmitting(true)
    try {
      await props.onSubmit(trimmed)
    } catch (err) {
      // 400/409 trazem o motivo do servidor (ex.: nome repetido aqui);
      // o resto vira a mensagem genérica. O texto digitado fica
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 409)
          ? err.message
          : 'Não foi possível salvar. Tente de novo.',
      )
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 py-2 pr-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">{props.label}</span>
        <input
          type="text"
          value={name}
          maxLength={50}
          onChange={(event) => {
            setName(event.target.value)
            setError('')
          }}
          aria-invalid={error !== ''}
          autoFocus
          className={fieldClass}
        />
      </label>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          className={`flex-1 ${secondaryButtonClass}`}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={`flex-1 ${primaryButtonClass}`}
        >
          {props.submitLabel}
        </button>
      </div>
    </form>
  )
}

export default TagForm
