import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import ExecutionForm from '../components/ExecutionForm'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import TaskForm from '../components/TaskForm'
import TimerPanel from '../components/TimerPanel'
import UndoNotice from '../components/UndoNotice'
import { frequencyLabels } from '../frequency'
import { PlayIcon } from '../components/icons'
import { lastPhase } from '../phases'
import {
  cardClass,
  chipAndamentoClass,
  chipClass,
  inlineButtonClass,
  pickerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import { executionSelection, indexTags, lastRootPath } from '../tags'
import type {
  Exercise,
  Frequency,
  NewTask,
  Measure,
  MeasureValue,
  StartDraft,
  Tag,
  TagChoice,
  Task,
  TaskExecution,
  TimeEntry,
  WorkoutExercise,
} from '../types'
import { recentExerciseIds } from '../workouts'

const UNDO_SECONDS = 6

// Ordem dos chips: das mais frequentes às avulsas
const frequencyOrder: Frequency[] = ['daily', 'weekly', 'monthly', 'none']

function ExecutePage(props: {
  tasks: Task[]
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  tags: Tag[]
  measures: Measure[]
  exercises: Exercise[]
  onSaveWorkout: (
    executionId: string,
    workout: WorkoutExercise[],
    tags: TagChoice | null,
  ) => Promise<void>
  onCreateExercise: (name: string) => Promise<Exercise>
  onCreate: (task: NewTask) => Promise<string>
  onExecute: (
    taskId: string,
    description: string,
    completedAt: string,
    tags: TagChoice,
    estimatedMinutes: number | null,
    measureValues: MeasureValue[],
  ) => Promise<void>
  onStartTimer: (taskId: string, draft?: StartDraft) => Promise<string | null>
  onStopTimer: (timeEntryId: string) => Promise<void>
  onResumeTimer: (executionId: string) => Promise<string | null>
  onFinishExecution: (
    executionId: string,
    description: string,
    tags: Partial<TagChoice>,
    measureValues: MeasureValue[] | undefined,
  ) => Promise<void>
  onUndoFinishExecution: (
    executionId: string,
    previousDescription: string | null,
    previousTags: TagChoice,
    previousMeasureValues: MeasureValue[],
    previousWorkout: WorkoutExercise[],
    resumeEntryId: string | null,
  ) => Promise<void>
}) {
  const [searchParams] = useSearchParams()
  // Lido só na 1ª renderização: "retomar" na Lista chega com ?tarefa=<id>
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    searchParams.get('tarefa'),
  )
  // Janela de desfazer depois de finalizar — só existe enquanto essa
  // mesma tela continua montada, nunca sobrevive a trocar de tarefa
  const [pendingUndo, setPendingUndo] = useState<{
    executionId: string
    previousDescription: string | null
    previousTags: TagChoice
    previousMeasureValues: MeasureValue[]
    previousWorkout: WorkoutExercise[]
    resumeEntryId: string | null
  } | null>(null)
  const [starting, setStarting] = useState(false)
  // O formulário de baixo, se foi mexido: o "Iniciar cronômetro" leva o
  // caminho e a descrição dele (antes, descartava tudo em silêncio). Marcado
  // com a tarefa: o de outra tarefa nunca vai junto
  const [draft, setDraft] = useState<{
    taskId: string
    value: StartDraft
  } | null>(null)
  // Enquanto o servidor confirma o desfazer: tira a contagem da tela (senão
  // ela poderia expirar e navegar no meio da requisição)
  const [undoing, setUndoing] = useState(false)
  const [frequencyFilter, setFrequencyFilter] = useState<Frequency | 'all'>(
    'all',
  )
  const navigate = useNavigate()

  const activeTasks = props.tasks.filter((task) => task.active)
  const selectedTask = activeTasks.find((task) => task.id === selectedTaskId)

  // Troca de tarefa sempre limpa uma janela de desfazer pendente — senão,
  // reabrir a mesma tarefa depois mostraria o aviso de uma finalização antiga
  function selectTask(taskId: string | null) {
    setSelectedTaskId(taskId)
    setPendingUndo(null)
    setDraft(null)
  }

  async function handleCreate(newTask: NewTask) {
    const id = await props.onCreate(newTask)
    selectTask(id)
  }

  // Se o servidor recusar, o erro sobe pro ExecutionForm e não navega
  async function handleExecute(
    description: string,
    completedAt: string,
    tags: TagChoice,
    estimatedMinutes: number | null,
    measureValues: MeasureValue[],
  ) {
    if (selectedTask === undefined) return
    await props.onExecute(
      selectedTask.id,
      description,
      completedAt,
      tags,
      estimatedMinutes,
      measureValues,
    )
    navigate('/')
  }

  async function handleStart() {
    if (selectedTask === undefined) return
    setStarting(true)
    const started = await props.onStartTimer(
      selectedTask.id,
      draft?.taskId === selectedTask.id ? draft.value : undefined,
    )
    setStarting(false)
    // Foi pro registro: o formulário de baixo volta limpo depois de
    // finalizar, então o rascunho não pode ir de novo no próximo Iniciar
    if (started) setDraft(null)
  }

  // Capturado antes do await: depois dele, a execução já está finalizada
  async function handleFinish(
    executionId: string,
    description: string,
    tags: Partial<TagChoice>,
    measureValues: MeasureValue[] | undefined,
  ) {
    const execution = props.executions.find((e) => e.id === executionId)
    const resumeEntry = props.timeEntries.find(
      (entry) =>
        entry.taskExecutionId === executionId && entry.endedAt === null,
    )
    await props.onFinishExecution(executionId, description, tags, measureValues)
    setPendingUndo({
      executionId,
      previousDescription: execution?.description ?? null,
      previousTags: {
        rootTagId: execution?.rootTagId ?? null,
        tagIds: execution?.tagIds ?? [],
        phase: execution?.phase ?? null,
      },
      // [] = sem medida: ausente, o servidor manteria a do Finalizar
      previousMeasureValues: execution?.measure?.values ?? [],
      // O Finalizar só sai com o treino gravado: o do estado é o da tela
      previousWorkout: execution?.workout ?? [],
      resumeEntryId: resumeEntry?.id ?? null,
    })
  }

  async function handleUndo() {
    if (!pendingUndo) return
    setUndoing(true)
    await props.onUndoFinishExecution(
      pendingUndo.executionId,
      pendingUndo.previousDescription,
      pendingUndo.previousTags,
      pendingUndo.previousMeasureValues,
      pendingUndo.previousWorkout,
      pendingUndo.resumeEntryId,
    )
    setUndoing(false)
    setPendingUndo(null)
  }

  // Estado de cada tarefa no seletor: em andamento (rodando/pausado) ou nada
  function openStateOf(taskId: string): 'rodando' | 'pausado' | null {
    const open = props.executions.find(
      (execution) =>
        execution.taskId === taskId && execution.completedAt === null,
    )
    if (!open) return null
    return props.timeEntries.some(
      (entry) => entry.taskExecutionId === open.id && entry.endedAt === null,
    )
      ? 'rodando'
      : 'pausado'
  }

  function renderPickerItem(task: Task) {
    const state = openStateOf(task.id)
    return (
      <li key={task.id}>
        <button
          type="button"
          onClick={() => selectTask(task.id)}
          className={`${pickerButtonClass} flex flex-wrap items-center gap-x-2 gap-y-1`}
        >
          <span className="font-titulo">{task.title}</span>
          {task.frequency !== 'none' && (
            <span className={chipClass}>{frequencyLabels[task.frequency]}</span>
          )}
          {state && (
            <span className={chipAndamentoClass}>
              <span
                className={`h-2 w-2 rounded-full ${state === 'rodando' ? 'animate-pulsa bg-current' : 'border-[1.5px] border-current'}`}
              />
              {state === 'rodando' ? 'Rodando' : 'Pausado'}
            </span>
          )}
        </button>
      </li>
    )
  }

  if (selectedTask === undefined) {
    // Em andamento fica fora do filtro: o que está aberto nunca some da tela
    const inProgress = activeTasks.filter((task) => openStateOf(task.id))
    const others = activeTasks.filter((task) => !openStateOf(task.id))

    // Frequência ATUAL da tarefa (não snapshot): aqui é escolher o que
    // fazer agora. Chip sem nenhuma tarefa não aparece
    const frequencyOptions: ChipOption<Frequency | 'all'>[] = [
      { value: 'all', label: 'Todas', count: others.length },
      ...frequencyOrder
        .map((frequency) => ({
          value: frequency,
          label: frequencyLabels[frequency],
          count: others.filter((task) => task.frequency === frequency).length,
        }))
        .filter((option) => option.count > 0),
    ]
    // Se o filtro escolhido ficou vazio (ex.: a última tarefa dele foi
    // iniciada e subiu pra "Em andamento"), volta pra "Todas"
    const activeFilter = frequencyOptions.some(
      (option) => option.value === frequencyFilter,
    )
      ? frequencyFilter
      : 'all'
    const filtered = others.filter(
      (task) => activeFilter === 'all' || task.frequency === activeFilter,
    )

    return (
      <div className="flex flex-col gap-6">
        {inProgress.length > 0 && (
          <section>
            <h2 className="mb-3 font-titulo text-base font-semibold">
              Em andamento
            </h2>
            <ul className="flex flex-col gap-2">
              {inProgress.map(renderPickerItem)}
            </ul>
          </section>
        )}
        {others.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-titulo text-base font-semibold">
              Escolha uma tarefa
            </h2>
            {/* Com um tipo só de frequência, os chips não teriam o que filtrar */}
            {frequencyOptions.length > 2 && (
              <FilterChips
                label="Frequência"
                options={frequencyOptions}
                value={activeFilter}
                onChange={setFrequencyFilter}
              />
            )}
            <ul className="flex flex-col gap-2">
              {filtered.map(renderPickerItem)}
            </ul>
          </section>
        )}
        <section className={cardClass}>
          <h2 className="mb-3 font-titulo text-base font-semibold">
            ou crie uma nova
          </h2>
          <TaskForm onSubmit={handleCreate} />
        </section>
      </div>
    )
  }

  const openExecution = props.executions.find(
    (execution) =>
      execution.taskId === selectedTask.id && execution.completedAt === null,
  )
  const openEntries = openExecution
    ? props.timeEntries
        .filter((entry) => entry.taskExecutionId === openExecution.id)
        .sort((a, b) => (a.startedAt > b.startedAt ? 1 : -1))
    : []
  const runningEntry = openEntries.find((entry) => entry.endedAt === null)
  const tagsById = indexTags(props.tags)
  const preselected = lastRootPath(props.executions, selectedTask.id, tagsById)
  // Fase: pelo caminho (de qualquer tarefa), não pela tarefa como o contexto
  const suggestPhase = (path: string[]) =>
    lastPhase(props.executions, path, tagsById)
  // Registro aberto que já tem tags (voltou pelo Desfazer): começa nelas
  const openSelection = openExecution
    ? executionSelection(openExecution, tagsById)
    : null
  // Rodando em OUTRA tarefa, não nessa — "Registrar" continua liberado (é
  // instantâneo, nunca fica aberto, então não conflita com essa invariante)
  const runningElsewhere = runningEntry
    ? undefined
    : props.timeEntries.find((entry) => entry.endedAt === null)
  const runningTask = runningElsewhere
    ? activeTasks.find(
        (task) =>
          task.id ===
          props.executions.find(
            (execution) => execution.id === runningElsewhere.taskExecutionId,
          )?.taskId,
      )
    : undefined

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <h2 className="font-titulo text-xl font-bold break-words">
            {selectedTask.title}
          </h2>
          {selectedTask.frequency !== 'none' && (
            <span className={chipClass}>
              {frequencyLabels[selectedTask.frequency]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => selectTask(null)}
          className={`mt-1 whitespace-nowrap text-sm text-tinta-suave ${inlineButtonClass}`}
        >
          trocar tarefa
        </button>
      </div>

      {undoing ? (
        <p className="text-sm text-tinta-suave">Desfazendo…</p>
      ) : pendingUndo ? (
        <UndoNotice
          seconds={UNDO_SECONDS}
          onExpire={() => {
            setPendingUndo(null)
            navigate('/')
          }}
          onUndo={handleUndo}
        />
      ) : openExecution ? (
        <TimerPanel
          key={openExecution.id}
          execution={openExecution}
          entries={openEntries}
          runningEntry={runningEntry}
          onStop={props.onStopTimer}
          onResume={props.onResumeTimer}
          onFinish={handleFinish}
          tags={props.tags}
          suggestPhase={suggestPhase}
          measures={props.measures}
          exercises={props.exercises}
          recentExerciseIds={(markerId) =>
            recentExerciseIds(props.executions, markerId, tagsById)
          }
          onSaveWorkout={props.onSaveWorkout}
          onCreateExercise={props.onCreateExercise}
          initial={
            openSelection && openSelection.path.length > 0
              ? openSelection
              : { path: preselected, legacyCount: 0 }
          }
        />
      ) : (
        <>
          {runningElsewhere ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-andamento/[0.13] px-4 py-3 text-sm">
              <p className="inline-flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 animate-pulsa rounded-full bg-andamento" />
                <span>
                  {runningTask ? (
                    <>
                      <strong className="font-semibold">
                        {runningTask.title}
                      </strong>{' '}
                      está rodando.
                    </>
                  ) : (
                    'Já tem um cronômetro rodando.'
                  )}
                </span>
              </p>
              {runningTask && (
                <button
                  type="button"
                  onClick={() => selectTask(runningTask.id)}
                  className={secondaryButtonClass}
                >
                  Ir pro cronômetro →
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className={`h-13 w-full text-base ${primaryButtonClass}`}
            >
              <PlayIcon />
              Iniciar cronômetro
            </button>
          )}
          <p className="flex items-center gap-3 text-sm text-tinta-suave before:h-px before:flex-1 before:bg-linha after:h-px after:flex-1 after:bg-linha">
            ou registre sem cronômetro
          </p>
          <ExecutionForm
            key={selectedTask.id}
            tags={props.tags}
            initialPath={preselected}
            suggestPhase={suggestPhase}
            measures={props.measures}
            onSubmit={handleExecute}
            onDraftChange={(value) =>
              setDraft({ taskId: selectedTask.id, value })
            }
          />
        </>
      )}
    </div>
  )
}

export default ExecutePage
