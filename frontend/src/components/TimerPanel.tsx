import { Fragment, useState, type FormEvent, type ReactNode } from 'react'
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
  Selection,
  Tag,
  TagChoice,
  Task,
  TaskExecution,
  TimeEntry,
  Work,
  WorkLink,
  WorkoutExercise,
} from '../types'
import {
  clearTimerMemory,
  isChoosablePath,
  readTimerChoices,
  readTimerMemory,
  writeTimerChoices,
  writeTimerMemory,
} from '../timerMemory'
import { isTexts } from '../formDrafts'
import type { MeasureTexts } from '../measures'
import { FORM_FIELD_ORDER, type FormField } from '../selections'
import { useMeasure } from '../useMeasure'
import { useSelectionChoices } from '../useSelectionChoices'
import { useWorkoutSync, type WorkoutTarget } from '../useWorkoutSync'
import { describeWorkout, emptyExerciseError, workoutMarker } from '../workouts'
import {
  defaultPath,
  LINK_ERROR,
  LINK_PATTERN,
  recordError,
  workMeasureNote,
} from '../works'
import ElapsedTime from './ElapsedTime'
import FormError from './FormError'
import LinkField from './LinkField'
import MeasureFields, { MeasureWarning } from './MeasureFields'
import PhaseField from './PhaseField'
import SelectionChoices from './SelectionChoices'
import TagFields from './TagFields'
import WorkField from './WorkField'
import WorkoutSection from './WorkoutSection'

// O que a memória do painel guarda, com o que acabou de mudar
type Remembered = {
  path: string[]
  phase: Phase | null
  description: string
  measureTexts: MeasureTexts
  workId: string | null
  link: string
}

function TimerPanel(props: {
  execution: TaskExecution
  entries: TimeEntry[] // todas as sessões dessa execução
  runningEntry: TimeEntry | undefined // undefined = pausado
  tags: Tag[]
  measures: Measure[]
  selections: Selection[]
  exercises: Exercise[]
  works: Work[]
  tasks: Task[]
  // Recentes no contexto (pela tag marcadora)
  recentExerciseIds: (markerId: string) => string[]
  // tags null = caminho já gravado, só o treino
  onSaveWorkout: (
    executionId: string,
    workout: WorkoutExercise[],
    tags: TagChoice | null,
  ) => Promise<unknown>
  onCreateExercise: (name: string) => Promise<Exercise>
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
    selectionOptionIds: string[] | undefined,
    // Só o que mudou em relação ao registro (ausente, o servidor mantém)
    link: Partial<WorkLink>,
  ) => Promise<unknown>
}) {
  // Desestruturado: runningEntry como const local permite o TypeScript
  // estreitar o tipo dentro dos closures dos botões, sem precisar de "!"
  const { execution, entries, runningEntry, onStop, onResume, onFinish } = props
  const tagsById = indexTags(props.tags)
  // Treino ao vivo: o caminho GRAVADO (o servidor) pode ficar diferente do
  // da tela até o 1º exercício
  const serverPathKey = executionSelection(execution, tagsById).path.join('/')
  // A escolha feita no painel antes de sair (ou recarregar), se ainda vale:
  // o caminho só se o servidor não mudou desde então (o 1º exercício grava
  // o dele) e as tags existem ativas; a descrição, se a do servidor é a mesma
  const [remembered] = useState(() => {
    const memory = readTimerMemory(execution.id)
    if (!memory) return null
    return {
      path:
        memory.base === serverPathKey && isChoosablePath(memory.path, tagsById)
          ? memory
          : null,
      description:
        memory.descriptionBase === (execution.description ?? null)
          ? memory.description
          : null,
      // Valores da medida (N3): de qual caminho eram, pra só valerem nele
      measureTexts: isTexts(memory.measureTexts) ? memory.measureTexts : null,
      measurePath: memory.path.join('/'),
      // Obra e link: se o servidor não mudou desde então; obra que sumiu, a dele
      work:
        memory.workBase === (execution.workId ?? null) &&
        (memory.workId === null ||
          (typeof memory.workId === 'string' &&
            props.works.some((w) => w.id === memory.workId)))
          ? { id: memory.workId }
          : null,
      link:
        memory.linkBase === (execution.linkUrl ?? null) &&
        typeof memory.link === 'string'
          ? memory.link
          : null,
    }
  })
  const [description, setDescription] = useState(
    remembered?.description ?? execution.description ?? '',
  )
  const [selection, setSelection] = useState<TagSelection>(
    remembered?.path
      ? { path: remembered.path.path, legacyCount: 0 }
      : props.initial,
  )
  // Voltou pelo Desfazer: começa na fase que tinha
  const [phase, setPhase] = useState(() =>
    remembered?.path
      ? remembered.path.phase
      : (execution.phase ?? props.suggestPhase(props.initial.path)),
  )
  const showPhase = phaseApplies(selection.path, tagsById)
  // A obra e o link gravados pelo Iniciar (ou os escolhidos antes de sair)
  const [workId, setWorkId] = useState(
    remembered?.work ? remembered.work.id : (execution.workId ?? null),
  )
  const work = props.works.find((w) => w.id === workId) ?? null
  const [link, setLink] = useState(remembered?.link ?? execution.linkUrl ?? '')

  // Guarda o que está na tela agora (com o que o servidor tinha), a cada
  // mudança feita aqui: sair e voltar não perde a escolha
  function remember(next: Partial<Remembered> = {}) {
    const value: Remembered = {
      path: selection.path,
      phase,
      description,
      measureTexts: measure.texts,
      workId: work?.id ?? null,
      link,
      ...next,
    }
    writeTimerMemory(execution.id, {
      base: serverPathKey,
      path: value.path,
      phase: value.phase,
      descriptionBase: execution.description ?? null,
      description: value.description,
      measureTexts: value.measureTexts,
      workBase: execution.workId ?? null,
      workId: value.workId,
      linkBase: execution.linkUrl ?? null,
      link: value.link,
    })
  }
  // Voltou pelo Desfazer com medida: os campos começam nos valores dela
  // A medida do registro como estava ao abrir: a gravação do caminho (treino
  // ao vivo) pode tirá-la do servidor, e voltar o caminho tem que trazê-la
  const [openedMeasure] = useState(execution.measure)
  // Valores da medida digitados antes de sair: só se o painel abriu no
  // mesmo caminho em que foram digitados (são da medida dele)
  const [restoredTexts] = useState(() =>
    remembered?.measureTexts &&
    Object.keys(remembered.measureTexts).length > 0 &&
    remembered.measurePath === selection.path.join('/')
      ? remembered.measureTexts
      : undefined,
  )
  const measure = useMeasure(
    selection.path,
    props.measures,
    openedMeasure,
    restoredTexts,
  )
  // Só na tela até o Finalizar, como a descrição
  const [rememberedChoices] = useState(() => readTimerChoices(execution.id))
  const choices = useSelectionChoices(
    selection.path,
    props.selections,
    rememberedChoices,
    execution.selections,
  )
  function changeChoice(selectionId: string, optionIds: string[]) {
    choices.change(selectionId, optionIds)
    writeTimerChoices(execution.id, {
      ...choices.touched,
      [selectionId]: optionIds,
    })
  }
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
  // Caminho novo: fase pela sugestão, campos da medida nova (vazios), o treino
  // segue o caminho
  function changePath(path: string[], also: Partial<Remembered> = {}) {
    const nextPhase = props.suggestPhase(path)
    setSelection({ path, legacyCount: 0 })
    setPhase(nextPhase)
    measure.changePath(path)
    workout.retarget(targetFor(path, nextPhase))
    remember({ path, phase: nextPhase, measureTexts: {}, ...also })
  }

  // Como no Registrar: a obra sobrescreve o caminho; o mesmo caminho não mexe
  // em nada; caminho padrão arquivado não preenche; "Nenhuma obra" mantém
  function chooseWork(id: string | null) {
    setWorkId(id)
    const chosen = props.works.find((w) => w.id === id)
    const next = chosen ? defaultPath(chosen, props.tags) : []
    if (
      next.length > 0 &&
      next.join('/') !== selection.path.join('/') &&
      isChoosablePath(next, tagsById)
    ) {
      changePath(next, { workId: id })
    } else {
      remember({ workId: id })
    }
  }

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
    // Exercício sem série não seria gravado: avisa em vez de descartar
    const empty =
      marker !== null && emptyExerciseError(workout.draft, props.exercises)
    if (empty) {
      setError(empty)
      return
    }
    // O caminho gravado mudou durante a sessão: a medida vai explícita
    const sent = measure.toSend(serverPathKey !== mountedPathKey)
    if ('error' in sent) {
      setError(sent.error)
      return
    }
    const url = link.trim()
    if (url !== '' && !LINK_PATTERN.test(url)) {
      setError(LINK_ERROR)
      return
    }
    // Obra e link só se mudaram em relação ao registro: uma tela velha não
    // sobrescreve o que mudou em outro aparelho
    const chosenWork = work?.id ?? null
    const changed: Partial<WorkLink> = {
      ...(chosenWork !== (execution.workId ?? null)
        ? { workId: chosenWork }
        : {}),
      ...((url || null) !== (execution.linkUrl ?? null)
        ? { linkUrl: url || null }
        : {}),
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
        // A lista vai sempre: é o que está na tela, inclusive depois de a
        // gravação do caminho (treino ao vivo) ter tirado escolhas do servidor
        selection.legacyCount > 0 ? undefined : choices.optionIds,
        changed,
      )
      // Gravado: a escolha da tela não tem mais o que guardar
      clearTimerMemory(execution.id)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? recordError(err.message)
          : 'Não foi possível finalizar. Tente de novo.',
      )
      return
    } finally {
      setSubmitting(false)
    }
    setError('')
  }

  const measureNote = work
    ? workMeasureNote(work, measure.measure, props.measures)
    : null
  const blocks: Record<FormField, ReactNode> = {
    obra: (
      <WorkField
        works={props.works}
        value={work?.id ?? null}
        onChange={chooseWork}
        tags={props.tags}
        measures={props.measures}
        taskId={execution.taskId}
        tasks={props.tasks}
      />
    ),
    link: (
      <LinkField
        value={link}
        onChange={(text) => {
          setLink(text)
          remember({ link: text })
        }}
        // Lido só na montagem: o registro (ou a memória) já tem link
        startOpen={link.trim() !== ''}
      />
    ),
    tags: (
      <TagFields
        tags={props.tags}
        value={selection.path}
        onChange={(path) => changePath(path)}
        keep={[
          ...(execution.rootTagId ? [execution.rootTagId] : []),
          ...execution.tagIds,
        ]}
        legacyCount={selection.legacyCount}
      />
    ),
    fase: showPhase && (
      <PhaseField
        value={phase}
        onChange={(next) => {
          setPhase(next)
          remember({ phase: next })
        }}
      />
    ),
    'selecoes-caminho': (
      <SelectionChoices
        selections={choices.onPath}
        valueOf={choices.valueOf}
        onChange={changeChoice}
        keptOptionIds={choices.keptOptionIds}
      />
    ),
    'selecoes-gerais': (
      <SelectionChoices
        selections={choices.general}
        valueOf={choices.valueOf}
        onChange={changeChoice}
        keptOptionIds={choices.keptOptionIds}
      />
    ),
    medida: (
      <>
        <MeasureFields
          measure={measure.measure}
          texts={measure.texts}
          onChange={(key, text) => {
            measure.change(key, text)
            remember({ measureTexts: { ...measure.texts, [key]: text } })
          }}
          keptKindIds={measure.keptKindIds}
          oldValues={measure.oldValues}
        />
        {measureNote && (
          <p
            data-work-field=""
            className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave"
          >
            {measureNote}
          </p>
        )}
      </>
    ),
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
              onChange={(event) => {
                setDescription(event.target.value)
                remember({ description: event.target.value })
              }}
              className={fieldClass}
            />
          </label>
          {FORM_FIELD_ORDER.map((field) => (
            <Fragment key={field}>{blocks[field]}</Fragment>
          ))}
          <MeasureWarning text={measure.warning} />
          <MeasureWarning text={workoutWarning} />
        </form>
        {marker !== null && (
          <WorkoutSection
            draft={workout.draft}
            exercises={props.exercises}
            recentIds={props.recentExerciseIds(marker)}
            markerName={tagsById.get(marker)?.name ?? ''}
            live={{
              status: workout.status,
              error: workout.error,
              savedExercises: workout.savedExercises,
              onRetry: workout.retry,
            }}
            onChange={(next) =>
              workout.update(next, targetFor(selection.path, phase))
            }
            onCreateExercise={props.onCreateExercise}
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
