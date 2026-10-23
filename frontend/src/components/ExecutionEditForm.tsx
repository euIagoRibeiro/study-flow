import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, primaryButtonClass } from '../styles'
import { phaseApplies } from '../phases'
import { executionSelection, indexTags, pathToChoice } from '../tags'
import type { CompletedExecution, ExecutionChanges, Tag } from '../types'
import {
  MINUTES_ERROR,
  parseMinutes,
  parseQuantity,
  quantityInputValue,
} from '../numbers'
import EstimateField from './EstimateField'
import FormError from './FormError'
import PhaseField from './PhaseField'
import QuantityFields from './QuantityFields'
import TagFields from './TagFields'

function ExecutionEditForm(props: {
  execution: CompletedExecution
  tags: Tag[]
  estimateMinutes: number | null // a estimativa que o registro já tem
  units: string[] // sugestões de unidade: as já usadas
  onSubmit: (changes: ExecutionChanges) => Promise<unknown>
}) {
  const { execution } = props
  const [description, setDescription] = useState(execution.description ?? '')
  const [completedAt, setCompletedAt] = useState(
    toDatetimeLocalValue(execution.completedAt),
  )
  const initialMinutes = props.estimateMinutes?.toString() ?? ''
  const [minutes, setMinutes] = useState(initialMinutes)
  const initialQuantity = quantityInputValue(execution.quantity)
  const initialUnit = execution.quantityUnit ?? ''
  const [quantity, setQuantity] = useState(initialQuantity)
  const [unit, setUnit] = useState(initialUnit)
  const byId = indexTags(props.tags)
  const [selection, setSelection] = useState(() =>
    executionSelection(execution, byId),
  )
  const [phase, setPhase] = useState(execution.phase)
  const showPhase = phaseApplies(selection.path, byId)
  const [error, setError] = useState('')

  // Outro projeto: "Sem fase", sem chutar o passado com dado de hoje. De
  // volta ao projeto do registro, a fase dele volta junto
  function changePath(path: string[]) {
    const original = executionSelection(execution, byId).path
    setSelection({ path, legacyCount: 0 })
    setPhase(path.at(-1) === original.at(-1) ? execution.phase : null)
  }
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const estimate = parseMinutes(minutes)
    if (estimate === null) {
      setError(MINUTES_ERROR)
      return
    }
    // Aqui a unidade nunca é sugestão: é a do registro ou a digitada
    const parsed = parseQuantity(quantity, unit, false)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    const quantityChanged = quantity !== initialQuantity || unit !== initialUnit
    setSubmitting(true)
    try {
      await props.onSubmit({
        description: description.trim(),
        completedAt: fromDatetimeLocalValue(completedAt),
        // Registro antigo com mais de uma folha, sem mexer nas tags: não
        // manda tags, e o servidor mantém as que estavam
        ...(selection.legacyCount > 0
          ? {}
          : pathToChoice(selection.path, showPhase ? phase : null)),
        // Sem mexer, não vai: o servidor mantém e move junto com o "Quando"
        ...(minutes === initialMinutes
          ? {}
          : { estimatedMinutes: estimate === '' ? null : estimate }),
        // Idem: sem mexer não vai; os dois vazios limpam
        ...(quantityChanged
          ? (parsed.value ?? { quantity: null, quantityUnit: null })
          : {}),
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
        <EstimateField value={minutes} onChange={setMinutes} />
        <TagFields
          tags={props.tags}
          value={selection.path}
          onChange={changePath}
          // Tudo que o registro já tem continua escolhível, mesmo arquivado
          keep={[
            ...(execution.rootTagId ? [execution.rootTagId] : []),
            ...execution.tagIds,
          ]}
          legacyCount={selection.legacyCount}
        />
        {showPhase && <PhaseField value={phase} onChange={setPhase} />}
        <QuantityFields
          quantity={quantity}
          unit={unit}
          units={props.units}
          onQuantityChange={setQuantity}
          onUnitChange={setUnit}
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
