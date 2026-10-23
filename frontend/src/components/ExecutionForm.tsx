import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fieldClass, secondaryButtonClass } from '../styles'
import { phaseApplies } from '../phases'
import { indexTags, pathToChoice } from '../tags'
import type { Phase, Tag, TagChoice } from '../types'
import FormError from './FormError'
import PhaseField from './PhaseField'
import TagFields from './TagFields'

// Registrar sem cronômetro: botão secundário — na mesma tela, o amarelo é
// do "Iniciar cronômetro" (um botão principal por estado)
function ExecutionForm(props: {
  tags: Tag[]
  initialPath: string[] // pré-seleção: o contexto do último registro
  suggestPhase: (path: string[]) => Phase | null
  onSubmit: (description: string, tags: TagChoice) => Promise<unknown>
}) {
  const [description, setDescription] = useState('')
  const [path, setPath] = useState(props.initialPath)
  const [phase, setPhase] = useState(() => props.suggestPhase(path))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const showPhase = phaseApplies(path, indexTags(props.tags))

  // Caminho novo, pré-seleção nova
  function changePath(next: string[]) {
    setPath(next)
    setPhase(props.suggestPhase(next))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await props.onSubmit(
        description,
        pathToChoice(path, showPhase ? phase : null),
      )
    } catch (err) {
      // 400: o servidor recusou com motivo (ex.: tag arquivada em outra aba)
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : 'Não foi possível registrar. Tente de novo.',
      )
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
      <TagFields tags={props.tags} value={path} onChange={changePath} />
      {showPhase && <PhaseField value={phase} onChange={setPhase} />}
      <button
        type="submit"
        disabled={submitting}
        className={`w-full ${secondaryButtonClass}`}
      >
        Registrar
      </button>
      {error && <FormError>{error}</FormError>}
    </form>
  )
}

export default ExecutionForm
