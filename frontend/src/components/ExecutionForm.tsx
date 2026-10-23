import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, secondaryButtonClass } from '../styles'
import { phaseApplies } from '../phases'
import { indexTags, pathToChoice } from '../tags'
import type { Phase, QuantityChoice, Tag, TagChoice } from '../types'
import { MINUTES_ERROR, parseMinutes, parseQuantity } from '../numbers'
import EstimateField from './EstimateField'
import FormError from './FormError'
import PhaseField from './PhaseField'
import QuantityFields from './QuantityFields'
import TagFields from './TagFields'

// Registrar sem cronômetro: botão secundário — na mesma tela, o amarelo é
// do "Iniciar cronômetro" (um botão principal por estado)
function ExecutionForm(props: {
  tags: Tag[]
  initialPath: string[] // pré-seleção: o contexto do último registro
  suggestPhase: (path: string[]) => Phase | null
  suggestUnit: (path: string[]) => string | null
  units: string[]
  onSubmit: (
    description: string,
    completedAt: string,
    tags: TagChoice,
    estimatedMinutes: number | null,
    quantity: QuantityChoice,
  ) => Promise<unknown>
}) {
  const [description, setDescription] = useState('')
  // "Quando" começa na hora em que o formulário abriu; sem mexer, grava a
  // hora do clique (preencher não deixa o registro no passado)
  const [openedAt] = useState(() =>
    toDatetimeLocalValue(new Date().toISOString()),
  )
  const [when, setWhen] = useState(openedAt)
  const [minutes, setMinutes] = useState('')
  const [path, setPath] = useState(props.initialPath)
  const [phase, setPhase] = useState(() => props.suggestPhase(path))
  const [quantity, setQuantity] = useState('')
  // Só a unidade é pré-preenchida, nunca o número. Depois que a pessoa mexe
  // nela, trocar o caminho não apaga o que foi digitado
  const [unit, setUnit] = useState(() => props.suggestUnit(path) ?? '')
  const [unitTouched, setUnitTouched] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const showPhase = phaseApplies(path, indexTags(props.tags))

  // Caminho novo, pré-seleção nova
  function changePath(next: string[]) {
    setPath(next)
    setPhase(props.suggestPhase(next))
    if (!unitTouched) setUnit(props.suggestUnit(next) ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const estimate = parseMinutes(minutes)
    if (estimate === null) {
      setError(MINUTES_ERROR)
      return
    }
    const parsed = parseQuantity(quantity, unit, !unitTouched)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setSubmitting(true)
    try {
      await props.onSubmit(
        description,
        when === openedAt
          ? new Date().toISOString()
          : fromDatetimeLocalValue(when),
        pathToChoice(path, showPhase ? phase : null),
        estimate === '' ? null : estimate,
        parsed.value ?? { quantity: null, quantityUnit: null },
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
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">Quando</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          required
          className={fieldClass}
        />
      </label>
      <EstimateField value={minutes} onChange={setMinutes} />
      <TagFields tags={props.tags} value={path} onChange={changePath} />
      {showPhase && <PhaseField value={phase} onChange={setPhase} />}
      <QuantityFields
        quantity={quantity}
        unit={unit}
        units={props.units}
        onQuantityChange={setQuantity}
        onUnitChange={(value) => {
          setUnit(value)
          setUnitTouched(true)
        }}
      />
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
