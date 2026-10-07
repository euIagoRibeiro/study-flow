import { Link } from 'react-router'
import { formatDayLabel, isSameLocalDay } from '../dates'
import { frequencyLabels } from '../frequency'
import {
  cardClass,
  chipAndamentoClass,
  chipClass,
  secondaryButtonClass,
} from '../styles'
import type {
  CompletedExecution,
  NewTask,
  Task as TaskModel,
  TaskExecution,
  TimeEntry,
} from '../types'
import ActionMenu, { type MenuAction } from './ActionMenu'
import ElapsedTime from './ElapsedTime'
import ExecutionHistory from './ExecutionHistory'
import {
  ArchiveIcon,
  HistoryIcon,
  PencilIcon,
  PlayIcon,
  UnarchiveIcon,
} from './icons'
import TaskForm from './TaskForm'

// Type guard: garante completedAt não-nulo pro TypeScript
function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

// Curto de propósito: no cartão, "seg, 21 set" quebrava linha no celular
function lastLabel(iso: string, now: Date) {
  const label = formatDayLabel(iso, now)
  if (label === 'Hoje' || label === 'Ontem') return label.toLowerCase()
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })
}

// Exportado pro Tasks.tsx coordenar entre linhas
export type OpenForm = 'edit' | 'history' | null

function Task(props: {
  task: TaskModel
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  openForm: OpenForm
  onToggle: (form: NonNullable<OpenForm>) => void
  onEdit: (taskId: string, changes: NewTask) => Promise<void>
  onArchive: (taskId: string) => void
  onReactivate: (taskId: string) => void
  onEditExecution: (
    executionId: string,
    changes: { description: string; completedAt: string },
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
}) {
  const { id, title, frequency, active } = props.task
  const { openForm, onToggle } = props

  // Tudo abaixo é derivado de executions: nada disso é guardado em estado
  const completed = props.executions.filter(isCompleted)

  const last = completed.reduce<CompletedExecution | null>(
    (latest, execution) =>
      latest === null || execution.completedAt > latest.completedAt
        ? execution
        : latest,
    null,
  )

  const now = new Date()
  const doneToday = completed.some((execution) =>
    isSameLocalDay(new Date(execution.completedAt), now),
  )

  const openExecution = props.executions.find(
    (execution) => execution.completedAt === null,
  )
  const runningEntry = openExecution
    ? props.timeEntries.find(
        (entry) =>
          entry.taskExecutionId === openExecution.id && entry.endedAt === null,
      )
    : undefined

  function handleArchive() {
    const confirmed = window.confirm(
      `Arquivar "${title}"? A tarefa some da lista, mas pode ser vista de novo ligando "Mostrar arquivadas". O histórico de execuções continua guardado.`,
    )
    if (confirmed) props.onArchive(id)
  }

  const actions: MenuAction[] = []
  if (active)
    actions.push({
      label: openForm === 'edit' ? 'Cancelar edição' : 'Editar tarefa',
      icon: <PencilIcon />,
      onSelect: () => onToggle('edit'),
    })
  if (completed.length > 0)
    actions.push({
      label: openForm === 'history' ? 'Fechar histórico' : 'Ver histórico',
      icon: <HistoryIcon />,
      onSelect: () => onToggle('history'),
    })
  actions.push(
    active
      ? { label: 'Arquivar', icon: <ArchiveIcon />, onSelect: handleArchive }
      : {
          label: 'Reativar',
          icon: <UnarchiveIcon />,
          onSelect: () => props.onReactivate(id),
        },
  )

  const hasChips = openExecution || frequency !== 'none' || !active

  return (
    <li>
      {/* Arquivada: tinta-suave + chip, sem opacity no cartão (apagar duas
          vezes derrubava o contraste). Uma cor por estado: o grifo ganha */}
      <article className={`${cardClass} flex flex-col gap-2`}>
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 pt-1.5 font-titulo text-base font-semibold break-words">
            <span
              // transition-colors fixo aqui, não junto do grifo — senão não há o que animar
              className={`transition-colors duration-300 ${
                doneToday
                  ? '-mx-1 box-decoration-clone bg-marca-texto px-1 text-sobre-marca'
                  : active
                    ? ''
                    : 'text-tinta-suave'
              }`}
            >
              {title}
            </span>
          </h3>
          <ActionMenu label={`Mais ações de ${title}`} actions={actions} />
        </div>

        {hasChips && (
          <div className="flex flex-wrap gap-1.5">
            {openExecution &&
              (runningEntry ? (
                <span className={chipAndamentoClass}>
                  <span className="h-2 w-2 animate-pulsa rounded-full bg-current" />
                  Rodando · <ElapsedTime startedAt={runningEntry.startedAt} />
                </span>
              ) : (
                <span className={chipAndamentoClass}>
                  <span className="h-2 w-2 rounded-full border-[1.5px] border-current" />
                  Pausado
                </span>
              ))}
            {frequency !== 'none' && (
              <span className={chipClass}>{frequencyLabels[frequency]}</span>
            )}
            {!active && <span className={chipClass}>Arquivada</span>}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          {/* Duas linhas fixas, de propósito: numa linha só, o texto ficava
              no limite ao lado do botão e quebrava deixando uma palavra
              sozinha (360/375px, ou com contagem de 2 dígitos). Cabem na
              altura do botão (44px), então o cartão não cresce */}
          <p className="flex flex-col font-dados text-meta text-tinta-suave">
            {last ? (
              <>
                <span>Feita {completed.length}×</span>
                <span>última {lastLabel(last.completedAt, now)}</span>
              </>
            ) : (
              'Ainda não feita'
            )}
          </p>
          {active && (
            // Navegação de verdade: <Link>, não <button>
            <Link
              to={`/executar?tarefa=${id}`}
              aria-label={`${openExecution ? 'Retomar' : 'Executar'} ${title}`}
              // Mesmo papel, nunca aparecem juntos: mesmo ícone e mesma
              // largura mínima, pra não mudar de peso de um cartão pro outro
              className={`min-w-30 ${secondaryButtonClass}`}
            >
              <PlayIcon />
              {openExecution ? 'Retomar' : 'Executar'}
            </Link>
          )}
        </div>

        {active && openForm === 'edit' && (
          <div className="mt-1 border-t border-dashed border-linha pt-3">
            <TaskForm
              task={props.task}
              onSubmit={async (changes) => {
                await props.onEdit(id, changes)
                onToggle('edit')
              }}
              onCancel={() => onToggle('edit')}
            />
          </div>
        )}
        {openForm === 'history' && (
          <div className="mt-1 border-t border-dashed border-linha pt-3">
            <ExecutionHistory
              executions={completed}
              timeEntries={props.timeEntries}
              onEdit={props.onEditExecution}
              onEditTimeEntry={props.onEditTimeEntry}
            />
          </div>
        )}
      </article>
    </li>
  )
}

export default Task
