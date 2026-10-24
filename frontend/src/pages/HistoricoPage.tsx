import { useState } from 'react'
import ExecutionHistory from '../components/ExecutionHistory'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import FrequencySelect, {
  type FrequencyFilter,
} from '../components/FrequencySelect'
import { matchesPeriod, type PeriodFilter } from '../dates'
import type {
  Measure,
  WorkoutCatalog,
  CompletedExecution,
  ExecutionChanges,
  Tag,
  TaskExecution,
  TimeEntry,
} from '../types'

// Tudo primeiro: é o padrão, e numa faixa que rola de lado não pode ficar escondido no fim
const periodOptions: ChipOption<PeriodFilter>[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'year', label: 'Este ano' },
]

function isCompleted(
  execution: TaskExecution,
): execution is CompletedExecution {
  return execution.completedAt !== null
}

function HistoricoPage(props: {
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  tags: Tag[]
  measures: Measure[]
  workoutCatalog: WorkoutCatalog
  onEditExecution: (
    executionId: string,
    changes: ExecutionChanges,
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
}) {
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [frequency, setFrequency] = useState<FrequencyFilter>('all')

  const filtered = props.executions.filter(isCompleted).filter(
    (execution) =>
      matchesPeriod(execution.completedAt, period) &&
      // Filtra pelo snapshot (taskFrequencyAtTime), nunca pela frequência
      // atual da tarefa — mesmo princípio do resto do app
      (frequency === 'all' || execution.taskFrequencyAtTime === frequency),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-linha pb-3.5">
        <FilterChips
          label="Período"
          options={periodOptions}
          value={period}
          onChange={setPeriod}
        />
        <FrequencySelect value={frequency} onChange={setFrequency} />
      </div>
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          Nenhuma execução encontrada com esses filtros.
        </p>
      ) : (
        <ExecutionHistory
          executions={filtered}
          timeEntries={props.timeEntries}
          tags={props.tags}
          measures={props.measures}
          workoutCatalog={props.workoutCatalog}
          onEdit={props.onEditExecution}
          onEditTimeEntry={props.onEditTimeEntry}
        />
      )}
    </div>
  )
}

export default HistoricoPage
