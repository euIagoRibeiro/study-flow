import { useState, type FormEvent } from 'react'
import { frequencyLabels } from '../frequency'
import { fieldClass, primaryButtonClass } from '../styles'
import type { Frequency, NewTask, Task } from '../types'

function TaskForm(props: {
  task?: Task
  onSubmit: (task: NewTask) => Promise<unknown>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 sm:flex-1">
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
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
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
        <button
          type="submit"
          disabled={submitting}
          className={primaryButtonClass}
        >
          {isEditing ? 'Salvar' : 'Adicionar'}
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

export default TaskForm
