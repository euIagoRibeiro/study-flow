import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../dates'
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../styles'
import { phaseApplies } from '../phases'
import { executionSelection, indexTags, pathToChoice } from '../tags'
import type {
  CompletedExecution,
  ExecutionChanges,
  Measure,
  Tag,
  WorkoutCatalog,
  WorkoutExercise,
} from '../types'
import { MINUTES_ERROR, parseMinutes } from '../numbers'
import { useMeasure } from '../useMeasure'
import { describeWorkout, emptyExerciseError, workoutMarker } from '../workouts'
import EstimateField from './EstimateField'
import FormError from './FormError'
import MeasureFields, { MeasureWarning } from './MeasureFields'
import PhaseField from './PhaseField'
import TagFields from './TagFields'
import WorkoutSection from './WorkoutSection'

function ExecutionEditForm(props: {
  execution: CompletedExecution
  tags: Tag[]
  measures: Measure[]
  estimateMinutes: number | null // a estimativa que o registro já tem
  workoutCatalog: WorkoutCatalog
  onSubmit: (changes: ExecutionChanges) => Promise<unknown>
  // Fecha sem gravar (o formulário com treino é longo: o lápis que abriu
  // fica lá em cima)
  onCancel: () => void
}) {
  const { execution } = props
  const [description, setDescription] = useState(execution.description ?? '')
  const [completedAt, setCompletedAt] = useState(
    toDatetimeLocalValue(execution.completedAt),
  )
  const initialMinutes = props.estimateMinutes?.toString() ?? ''
  const [minutes, setMinutes] = useState(initialMinutes)
  const byId = indexTags(props.tags)
  const [selection, setSelection] = useState(() =>
    executionSelection(execution, byId),
  )
  const [phase, setPhase] = useState(execution.phase)
  const showPhase = phaseApplies(selection.path, byId)
  // Começa nos valores do próprio registro (não é sugestão)
  const measure = useMeasure(selection.path, props.measures, execution.measure)
  // Treino: rascunho na tela, vai só no Salvar
  const [draft, setDraft] = useState<WorkoutExercise[]>(execution.workout ?? [])
  const [originalPathKey] = useState(() =>
    executionSelection(execution, byId).path.join('/'),
  )
  const marker = workoutMarker(selection.path, byId)
  const workoutWarning =
    marker === null && execution.workout
      ? `Salvar com esse caminho vai remover o treino (${describeWorkout(execution.workout)}).`
      : undefined
  const [error, setError] = useState('')

  // Outro projeto: "Sem fase", sem chutar o passado com dado de hoje. De
  // volta ao projeto do registro, a fase dele volta junto
  function changePath(path: string[]) {
    const original = executionSelection(execution, byId).path
    setSelection({ path, legacyCount: 0 })
    setPhase(path.at(-1) === original.at(-1) ? execution.phase : null)
    measure.changePath(path)
  }
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const estimate = parseMinutes(minutes)
    if (estimate === null) {
      setError(MINUTES_ERROR)
      return
    }
    const sent = measure.toSend()
    if ('error' in sent) {
      setError(sent.error)
      return
    }
    const empty =
      marker !== null &&
      emptyExerciseError(draft, props.workoutCatalog.exercises)
    if (empty) {
      setError(empty)
      return
    }
    // Só vai se mexeu, ou se o caminho mudou pra outro com treino: sem ele,
    // a marcadora antiga sai do caminho e o servidor apagaria o treino
    const sendWorkout =
      marker !== null &&
      (JSON.stringify(draft) !== JSON.stringify(execution.workout ?? []) ||
        selection.path.join('/') !== originalPathKey)
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
        // Idem: sem mexer (nem no caminho), o servidor mantém a medida
        ...(sent.values ? { measureValues: sent.values } : {}),
        ...(sendWorkout ? { workout: draft } : {}),
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
    <div className="mt-3 flex flex-col gap-2">
      {/* Sempre empilhado: o form vive dentro de um cartão, e na linha única
          (antes, a partir de sm) os campos de data não encolhiam e empurravam
          o Salvar pra fora do cartão. O Salvar fica fora do <form>, ligado
          por form=: o treino (que tem formulários próprios) entra entre os
          campos e o botão */}
      <div className="flex flex-col gap-3">
        <form
          id={`editar-${execution.id}`}
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
        >
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
          <MeasureFields
            measure={measure.measure}
            texts={measure.texts}
            onChange={measure.change}
            keptKindIds={measure.keptKindIds}
            oldValues={measure.oldValues}
          />
          <MeasureWarning text={measure.warning} />
          <MeasureWarning text={workoutWarning} />
        </form>
        {marker !== null && (
          <WorkoutSection
            draft={draft}
            exercises={props.workoutCatalog.exercises}
            recentIds={props.workoutCatalog.recentIds(marker)}
            markerName={byId.get(marker)?.name ?? ''}
            onChange={setDraft}
            onCreateExercise={props.workoutCatalog.create}
          />
        )}
        {/* Cancelar + Salvar lado a lado, como no formulário de tarefa */}
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
            form={`editar-${execution.id}`}
            disabled={submitting}
            className={`flex-1 ${primaryButtonClass}`}
          >
            Salvar
          </button>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
    </div>
  )
}

export default ExecutionEditForm
