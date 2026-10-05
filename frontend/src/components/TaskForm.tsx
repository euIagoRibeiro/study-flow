import { useState, type FormEvent } from 'react'
import { frequencyLabels } from '../frequency'
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../styles'
import type { Frequency, NewTask, Task } from '../types'
import FormError from './FormError'

function TaskForm(props: {
  task?: Task
  onSubmit: (task: NewTask) => Promise<unknown>
  // Com onCancel, aparece o botão "Cancelar" (o form abre dentro de um cartão)
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [title, setTitle] = useState(props.task?.title ?? '')
  const [frequency, setFrequency] = useState<Frequency>(
    props.task?.frequency ?? 'none',
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Com task: formulário de edição, preenchido e sem limpar ao salvar.
  // Sem task: formulário de criação, o de sempre.
  const isEditing = props.task !== undefined

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (trimmedTitle === '') {
      setError('Escreva um título para a tarefa.')
      return
    }

    setSubmitting(true)
    try {
      await props.onSubmit({ title: trimmedTitle, frequency })
    } catch {
      // Campos continuam preenchidos: nada do que foi digitado se perde
      setError('Não foi possível salvar. Tente de novo.')
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
    if (!isEditing) {
      setTitle('')
      setFrequency('none')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {/* Sempre empilhado: ele mora em cartões de no máximo 544px − padding,
          e em linha (decidido pela largura da janela) vazava no desktop */}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-tinta-suave">
            {isEditing ? 'Título' : 'Nova tarefa'}
          </span>
          <input
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setError('')
            }}
            aria-invalid={error !== ''}
            autoFocus={props.autoFocus}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-tinta-suave">Frequência</span>
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as Frequency)}
            className={fieldClass}
          >
            {Object.entries(frequencyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          {props.onCancel && (
            <button
              type="button"
              onClick={props.onCancel}
              className={`flex-1 ${secondaryButtonClass}`}
            >
              Cancelar
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className={`flex-1 ${primaryButtonClass}`}
          >
            {isEditing ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  )
}

export default TaskForm
