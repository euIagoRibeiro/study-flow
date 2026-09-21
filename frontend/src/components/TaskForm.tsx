import { useState, type FormEvent } from 'react'
import { frequencyLabels } from '../frequency'
import { fieldClass, primaryButtonClass } from '../styles'
import type { Frequency, NewTask } from '../types'

function TaskForm(props: { onAdd: (task: NewTask) => void }) {
  const [title, setTitle] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('none')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (trimmedTitle === '') {
      setError('Escreva um título para a tarefa.')
      return
    }

    props.onAdd({ title: trimmedTitle, frequency })
    setTitle('')
    setFrequency('none')
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 sm:flex-1">
          <span className="text-sm text-tinta-suave">Nova tarefa</span>
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
        <button type="submit" className={primaryButtonClass}>
          Adicionar
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
