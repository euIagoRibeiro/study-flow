import { useState, type FormEvent } from 'react'
import { fieldClass, primaryButtonClass } from '../styles'

function ExecutionForm(props: { onSubmit: (description: string) => void }) {
  const [description, setDescription] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onSubmit(description)
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
      <button type="submit" className={primaryButtonClass}>
        Registrar
      </button>
    </form>
  )
}

export default ExecutionForm
