import { useState, type FormEvent } from 'react'
import type { Frequency, NewTask } from '../types'

const frequencyLabels: Record<Frequency, string> = {
  none: 'Sem frequência',
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal',
}

function TaskForm(props: { onAdd: (task: NewTask) => void }) {
  const [title, setTitle] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('none')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (trimmedTitle === '') return

    props.onAdd({ title: trimmedTitle, frequency })
    setTitle('')
    setFrequency('none')
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Título da tarefa"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <select
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as Frequency)}
      >
        {Object.entries(frequencyLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button type="submit">Adicionar</button>
    </form>
  )
}

export default TaskForm
