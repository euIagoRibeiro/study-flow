import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { formatClock, formatDuration } from '../dates'
import {
  cardClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import { phaseApplies } from '../phases'
import {
  executionSelection,
  indexTags,
  pathToChoice,
  type TagSelection,
} from '../tags'
import type {
  Exercise,
  Measure,
  MeasureValue,
  Phase,
  Tag,
  TagChoice,
  TaskExecution,
  TimeEntry,
  WorkoutExercise,
} from '../types'
import { useMeasure } from '../useMeasure'
import { useWorkoutSync, type WorkoutTarget } from '../useWorkoutSync'
import { describeWorkout, workoutMarker } from '../workouts'
import ElapsedTime from './ElapsedTime'
import FormError from './FormError'
import MeasureFields, { MeasureWarning } from './MeasureFields'
import PhaseField from './PhaseField'
import TagFields from './TagFields'
import WorkoutSection from './WorkoutSection'

function TimerPanel(props: {
  execution: TaskExecution
  entries: TimeEntry[] // todas as sessões dessa execução
  runningEntry: TimeEntry | undefined // undefined = pausado
  tags: Tag[]
  measures: Measure[]
  exercises: Exercise[]
  // Recentes no contexto (pela tag marcadora)
  recentExerciseIds: (markerId: string) => string[]
  // tags null = caminho já gravado, só o treino
  onSaveWorkout: (
    executionId: string,
    workout: WorkoutExercise[],
    tags: TagChoice | null,
  ) => Promise<unknown>
  // Tags que o registro já tem (ex.: voltou pelo Desfazer) ou, sem elas,
  // a pré-seleção do contexto
  initial: TagSelection
  suggestPhase: (path: string[]) => Phase | null
  onStop: (entryId: string) => Promise<unknown>
  onResume: (executionId: string) => Promise<unknown>
  onFinish: (
    executionId: string,
    description: string,
    tags: Partial<TagChoice>,
    measureValues: MeasureValue[] | undefined,
  ) => Promise<unknown>
}) {
  // Desestruturado: runningEntry como const local permite o TypeScript
  // estreitar o tipo dentro dos closures dos botões, sem precisar de "!"
  const { execution, entries, runningEntry, onStop, onResume, onFinish } = props
  const [description, setDescription] = useState(execution.description ?? '')
  const [selection, setSelection] = useState(props.initial)
  // Voltou pelo Desfazer: começa na fase que tinha
  const [phase, setPhase] = useState(
    () => execution.phase ?? props.suggestPhase(props.initial.path),
  )
  const tagsById = indexTags(props.tags)
  const showPhase = phaseApplies(selection.path, tagsById)
  // Voltou pelo Desfazer com medida: os campos começam nos valores dela
  // A medida do registro como estava ao abrir: a gravação do caminho (treino
  // ao vivo) pode tirá-la do servidor, e voltar o caminho tem que trazê-la
  const [openedMeasure] = useState(execution.measure)
  const measure = useMeasure(selection.path, props.measures, openedMeasure)
  // Treino ao vivo: o caminho GRAVADO (o servidor) pode ficar diferente do
  // da tela até o 1º exercício
  const serverPathKey = executionSelection(execution, tagsById).path.join('/')
  const [mountedPathKey] = useState(serverPathKey)
  const targetFor = (path: string[], phaseValue: Phase | null) =>
    ({
      pathKey: path.join('/'),
      tags: pathToChoice(
        path,
        phaseApplies(path, tagsById) ? phaseValue : null,
      ),
      marked: workoutMarker(path, tagsById) !== null,
    }) satisfies WorkoutTarget
  const workout = useWorkoutSync(
    execution.workout ?? [],
    mountedPathKey,
    (exercises, tags) => props.onSaveWorkout(execution.id, exercises, tags),
  )
  const marker = workoutMarker(selection.path, tagsById)
  // Treino gravado + caminho sem treino: nada sai agora, o Finalizar remove
  const workoutWarning =
    marker === null && execution.workout
      ? `Finalizar com esse caminho vai remover o treino (${describeWorkout(execution.workout)}).`
      : undefined
  const workoutBlocks =
    workout.status === 'saving' ||
    (workout.status === 'error' && marker !== null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Pausar/Retomar esperando o servidor: sem isso, clique duplo mandaria
  // duas requisições. Os erros deles o App já trata (aviso no Layout)
  const [busy, setBusy] = useState(false)

  // Tempo das sessões já encerradas — derivado, igual à soma do Histórico
  const closedMs = entries
    .filter((entry) => entry.endedAt !== null)
    .reduce(
      (sum, entry) =>
        sum +
        (new Date(entry.endedAt ?? entry.startedAt).getTime() -
          new Date(entry.startedAt).getTime()),
      0,
    )
  const sessions = entries.length

  async function runTimerAction(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  // Se falhar, o cronômetro continua rodando: nada parou ainda
  async function handleFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (workoutBlocks) return
    // O caminho gravado mudou durante a sessão: a medida vai explícita
    const sent = measure.toSend(serverPathKey !== mountedPathKey)
    if ('error' in sent) {
      setError(sent.error)
      return
    }
    setSubmitting(true)
    try {
      await onFinish(
        execution.id,
        description,
        // Registro com mais de uma folha, sem mexer nas tags: não manda tags
        selection.legacyCount > 0
          ? {}
          : pathToChoice(selection.path, showPhase ? phase : null),
        sent.values,
      )
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : 'Não foi possível finalizar. Tente de novo.',
      )
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`${cardClass} flex flex-col items-center gap-3 py-7 text-center`}
      >
        {runningEntry ? (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-andamento">
            <span className="h-2 w-2 animate-pulsa rounded-full bg-current" />
            Rodando
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-tinta-suave">
            <span className="h-2 w-2 rounded-full border-[1.5px] border-current" />
            Pausado
          </p>
        )}
        {/* Rodando: a sessão atual, andando. Pausado: o total até agora, parado */}
        <p className="font-dados text-[3.5rem] leading-none font-bold tracking-tight tabular-nums">
          {runningEntry ? (
            <ElapsedTime startedAt={runningEntry.startedAt} />
          ) : (
            formatClock(closedMs)
          )}
        </p>
        <p className="font-dados text-meta text-tinta-suave">
          {runningEntry
            ? closedMs > 0
              ? `Sessão ${sessions} · antes: ${formatDuration(closedMs)}`
              : 'Primeira sessão'
            : `${sessions} ${sessions === 1 ? 'sessão' : 'sessões'} até agora`}
        </p>
        <button
          type="button"
          onClick={() =>
            runTimerAction(() =>
              runningEntry ? onStop(runningEntry.id) : onResume(execution.id),
            )
          }
          disabled={busy}
          className={`w-full ${secondaryButtonClass}`}
        >
          {runningEntry ? 'Pausar' : 'Retomar'}
        </button>
      </div>
      {/* O Finalizar fica fora do <form>, ligado por form=: o treino entra
          entre os campos e o botão sem ficar dentro do formulário */}
      <div className="flex flex-col gap-3">
        <form
          id={`finalizar-${execution.id}`}
          onSubmit={handleFinish}
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
          <TagFields
            tags={props.tags}
            value={selection.path}
            onChange={(path) => {
              const nextPhase = props.suggestPhase(path)
              setSelection({ path, legacyCount: 0 })
              setPhase(nextPhase)
              measure.changePath(path)
              workout.retarget(targetFor(path, nextPhase))
            }}
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
            draft={workout.draft}
            exercises={props.exercises}
            recentIds={props.recentExerciseIds(marker)}
            markerName={tagsById.get(marker)?.name ?? ''}
            status={workout.status}
            error={workout.error}
            savedExercises={workout.savedExercises}
            onChange={(next) =>
              workout.update(next, targetFor(selection.path, phase))
            }
            onRetry={workout.retry}
          />
        )}
        <button
          type="submit"
          form={`finalizar-${execution.id}`}
          disabled={submitting || workoutBlocks}
          className={`w-full ${primaryButtonClass}`}
        >
          Finalizar
        </button>
        {workoutBlocks && (
          <p className="text-center text-sm text-tinta-suave">
            {workout.status === 'saving'
              ? 'Salvando o treino…'
              : 'Salve o treino antes de finalizar.'}
          </p>
        )}
        {error && <FormError>{error}</FormError>}
      </div>
    </div>
  )
}

export default TimerPanel
