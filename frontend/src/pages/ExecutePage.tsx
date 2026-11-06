import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
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
  focusRing,
  pickerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles'
import { clearDraft, draftKeys } from '../formDrafts'
import {
  NO_PATH,
  readShortcut,
  recentPaths,
  worksInProgress,
} from '../shortcuts'
import { executionSelection, indexTags, lastRootPath, tagPath } from '../tags'
import { progressLine } from '../works'
import type {
  Exercise,
  Frequency,
  NewTask,
  Measure,
  MeasureValue,
  Selection,
  StartDraft,
  Tag,
  TagChoice,
  Task,
  TaskExecution,
  TimeEntry,
  Work,
  WorkLink,
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
  selections: Selection[]
  exercises: Exercise[]
  works: Work[]
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
    selectionOptionIds: string[],
    link: WorkLink,
  ) => Promise<void>
  onStartTimer: (taskId: string, draft?: StartDraft) => Promise<string | null>
  onStopTimer: (timeEntryId: string) => Promise<void>
  onResumeTimer: (executionId: string) => Promise<string | null>
  onFinishExecution: (
    executionId: string,
    description: string,
    tags: Partial<TagChoice>,
    measureValues: MeasureValue[] | undefined,
    selectionOptionIds: string[] | undefined,
    link: Partial<WorkLink>,
    endedAt: string | null,
  ) => Promise<void>
  onUndoFinishExecution: (
    executionId: string,
    previousDescription: string | null,
    previousTags: TagChoice,
    previousMeasureValues: MeasureValue[],
    previousWorkout: WorkoutExercise[],
    previousSelectionOptionIds: string[],
    previousLink: Partial<WorkLink>,
    resumeEntryId: string | null,
  ) => Promise<void>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  // A tarefa aberta mora na URL (?tarefa=<id>): o voltar do navegador (e o
  // do Android) volta da tarefa pra lista de tarefas, sem sair do Executar
  const selectedTaskId = searchParams.get('tarefa')
  // Janela de desfazer depois de finalizar — só existe enquanto essa
  // mesma tela continua montada e só vale pra tarefa dela (a tarefa pode
  // mudar pelo voltar do navegador, sem passar por selectTask)
  const [pendingUndo, setPendingUndo] = useState<{
    taskId: string
    executionId: string
    previousDescription: string | null
    previousTags: TagChoice
    previousMeasureValues: MeasureValue[]
    previousWorkout: WorkoutExercise[]
    previousSelectionOptionIds: string[]
    previousLink: Partial<WorkLink>
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
  const undo = pendingUndo?.taskId === selectedTaskId ? pendingUndo : null
  const tagsById = indexTags(props.tags)
  // Atalho (O5) na URL: lido ao abrir a tarefa e tirado em seguida (recarregar
  // não aplica de novo; quem guarda o que está na tela é o rascunho).
  // Inválido: a tarefa abre normal, sem erro
  const shortcut = readShortcut(searchParams, props.works, tagsById)
  const hasShortcutParams =
    searchParams.has('obra') || searchParams.has('caminho')
  useEffect(() => {
    if (!hasShortcutParams || selectedTask === undefined) return
    setSearchParams(
      { tarefa: selectedTask.id },
      { replace: true, state: location.state },
    )
  }, [hasShortcutParams, selectedTask, setSearchParams, location.state])

  // Abrir uma tarefa empilha (o voltar volta pra lista), marcado no estado
  // da navegação: o "← Tarefas" sabe que pode só voltar. Trocar de tarefa
  // limpa a janela de desfazer e o rascunho (reabrir a mesma tarefa não pode
  // mostrar o aviso de uma finalização antiga)
  function selectTask(taskId: string) {
    setSearchParams({ tarefa: taskId }, { state: { fromPicker: true } })
    setPendingUndo(null)
    setDraft(null)
  }

  // Atalho: abre a tarefa com a obra ou o caminho, empilhado como a lista.
  // Tarefa já aberta (rodando ou pausada): abre o painel como está
  function openShortcut(taskId: string, param: Record<string, string>) {
    if (openStateOf(taskId)) return selectTask(taskId)
    setSearchParams(
      { tarefa: taskId, ...param },
      { state: { fromPicker: true } },
    )
    setPendingUndo(null)
    setDraft(null)
  }

  // "← Tarefas": aberta pela lista daqui, é um voltar de verdade (o próximo
  // voltar sai do Executar, sem pingue-pongue); aberta direto (cartão da
  // Lista, link), troca pela lista sem empilhar
  function backToTasks() {
    setPendingUndo(null)
    setDraft(null)
    const state = location.state as { fromPicker?: boolean } | null
    if (state?.fromPicker) navigate(-1)
    else setSearchParams({}, { replace: true })
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
    selectionOptionIds: string[],
    link: WorkLink,
  ) {
    if (selectedTask === undefined) return
    await props.onExecute(
      selectedTask.id,
      description,
      completedAt,
      tags,
      estimatedMinutes,
      measureValues,
      selectionOptionIds,
      link,
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
    // finalizar, então o rascunho não pode ir de novo no próximo Iniciar, nem
    // reaparecer como "Rascunho recuperado" (o conteúdo já foi usado)
    if (started) {
      setDraft(null)
      clearDraft(draftKeys.registrar(selectedTask.id))
    }
  }

  // Capturado antes do await: depois dele, a execução já está finalizada
  async function handleFinish(
    executionId: string,
    description: string,
    tags: Partial<TagChoice>,
    measureValues: MeasureValue[] | undefined,
    selectionOptionIds: string[] | undefined,
    link: Partial<WorkLink>,
    endedAt: string | null,
  ) {
    const execution = props.executions.find((e) => e.id === executionId)
    const resumeEntry = props.timeEntries.find(
      (entry) =>
        entry.taskExecutionId === executionId && entry.endedAt === null,
    )
    await props.onFinishExecution(
      executionId,
      description,
      tags,
      measureValues,
      selectionOptionIds,
      link,
      endedAt,
    )
    setPendingUndo({
      taskId: selectedTask?.id ?? '',
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
      // [] = nenhuma: idem
      previousSelectionOptionIds:
        execution?.selections.flatMap((item) => item.optionIds) ?? [],
      // Simétrico ao Finalizar: só o que ele mudou, com o valor de antes
      // (null limpa)
      previousLink: {
        ...('workId' in link ? { workId: execution?.workId ?? null } : {}),
        ...('linkUrl' in link ? { linkUrl: execution?.linkUrl ?? null } : {}),
      },
      resumeEntryId: resumeEntry?.id ?? null,
    })
  }

  async function handleUndo() {
    if (!undo) return
    setUndoing(true)
    await props.onUndoFinishExecution(
      undo.executionId,
      undo.previousDescription,
      undo.previousTags,
      undo.previousMeasureValues,
      undo.previousWorkout,
      undo.previousSelectionOptionIds,
      undo.previousLink,
      undo.resumeEntryId,
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

  const pathLabel = (leafId: string | undefined) => {
    const leaf = leafId ? tagsById.get(leafId) : undefined
    return leaf ? tagPath(leaf, tagsById) : 'sem contexto'
  }

  // A tarefa do atalho já aberta: o item diz, e o toque abre o painel sem aplicar
  function openNote(taskId: string) {
    const state = openStateOf(taskId)
    if (!state) return null
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-tinta-suave">
        <span className={chipAndamentoClass}>
          <span
            className={`h-2 w-2 rounded-full ${state === 'rodando' ? 'animate-pulsa bg-current' : 'border-[1.5px] border-current'}`}
          />
          {state === 'rodando' ? 'Rodando' : 'Pausado'}
        </span>
        A tarefa já está aberta.
      </span>
    )
  }

  function renderWorkItem(work: Work) {
    const task = props.tasks.find((t) => t.id === work.defaultTaskId)
    const lines = (
      <>
        <span className="font-titulo [overflow-wrap:anywhere]">
          {work.title}
        </span>
        <span className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave">
          {task?.title ?? 'Tarefa não encontrada'} ·{' '}
          {pathLabel(work.defaultTagId)}
        </span>
        <span className="font-dados text-meta text-tinta-suave">
          {progressLine(
            work,
            props.measures.find((m) => m.id === work.measureId),
          )}
        </span>
      </>
    )
    // Tarefa padrão arquivada: não abre (a tarefa não aparece no Executar)
    if (!task?.active) {
      return (
        <li key={work.id}>
          <div className="flex min-h-11 flex-col items-start gap-0.5 rounded-xl border border-linha bg-superficie px-3 py-2 text-base">
            {lines}
            <span className="font-texto text-meta text-tinta-suave">
              A tarefa padrão desta obra está arquivada.
            </span>
          </div>
        </li>
      )
    }
    return (
      <li key={work.id}>
        <button
          type="button"
          onClick={() => openShortcut(task.id, { obra: work.id })}
          className={`${pickerButtonClass} flex flex-col items-start gap-0.5`}
        >
          {lines}
          {openNote(task.id)}
        </button>
      </li>
    )
  }

  function renderRecentItem(recent: { taskId: string; path: string[] }) {
    const task = activeTasks.find((t) => t.id === recent.taskId)
    const leaf = recent.path.at(-1)
    return (
      <li key={`${recent.taskId}|${leaf ?? ''}`}>
        <button
          type="button"
          onClick={() =>
            openShortcut(recent.taskId, { caminho: leaf ?? NO_PATH })
          }
          className={`${pickerButtonClass} flex flex-col items-start gap-0.5`}
        >
          <span className="font-titulo [overflow-wrap:anywhere]">
            {task?.title}
          </span>
          <span className="font-texto text-meta [overflow-wrap:anywhere] text-tinta-suave">
            {pathLabel(leaf)}
          </span>
          {openNote(recent.taskId)}
        </button>
      </li>
    )
  }

  if (selectedTask === undefined) {
    const works = worksInProgress(props.works, props.executions)
    const recents = recentPaths(
      props.executions,
      props.tasks,
      props.works,
      tagsById,
    )
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
        {works.length > 0 && (
          <section data-shortcuts="">
            <h2 className="mb-3 font-titulo text-base font-semibold">
              Obras em andamento
            </h2>
            <ul className="flex flex-col gap-2">{works.map(renderWorkItem)}</ul>
          </section>
        )}
        {recents.length > 0 && (
          <section data-shortcuts="">
            <h2 className="mb-3 font-titulo text-base font-semibold">
              Recentes
            </h2>
            <ul className="flex flex-col gap-2">
              {recents.map(renderRecentItem)}
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
      <div className="flex flex-col items-start gap-1.5">
        {/* Voltar à vista, no lugar de sempre (em cima, à esquerda); 44px de
            altura pra tocar. Substitui o "trocar tarefa", que não parecia
            um voltar */}
        <button
          type="button"
          onClick={backToTasks}
          className={`-mt-2 mb-1 inline-flex min-h-11 items-center rounded-md text-sm text-tinta-suave hover:text-tinta ${focusRing}`}
        >
          ← Tarefas
        </button>
        <h2 className="min-w-0 font-titulo text-xl font-bold break-words">
          {selectedTask.title}
        </h2>
        {selectedTask.frequency !== 'none' && (
          <span className={chipClass}>
            {frequencyLabels[selectedTask.frequency]}
          </span>
        )}
      </div>

      {undoing ? (
        <p className="text-sm text-tinta-suave">Desfazendo…</p>
      ) : undo ? (
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
          selections={props.selections}
          exercises={props.exercises}
          works={props.works}
          tasks={props.tasks}
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
            selections={props.selections}
            works={props.works}
            taskId={selectedTask.id}
            tasks={props.tasks}
            shortcut={shortcut}
            onSubmit={handleExecute}
            draftKey={draftKeys.registrar(selectedTask.id)}
            onDraftChange={(value) =>
              setDraft(value ? { taskId: selectedTask.id, value } : null)
            }
          />
        </>
      )}
    </div>
  )
}

export default ExecutePage
