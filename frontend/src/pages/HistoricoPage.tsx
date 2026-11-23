import { useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { countByDay, isDayKey, parseDayKey } from '../calendar'
import ExecutionHistory from '../components/ExecutionHistory'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import HistoryCalendar from '../components/HistoryCalendar'
import FrequencySelect, {
  type FrequencyFilter,
} from '../components/FrequencySelect'
import {
  formatDayLabel,
  localDayKey,
  matchesPeriod,
  type PeriodFilter,
} from '../dates'
import { focusRing, secondaryButtonClass } from '../styles'
import type {
  Measure,
  Selection,
  WorkoutCatalog,
  WorkPicker,
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

// "hoje", "ontem", "sex, 20 nov": o rótulo do dia em minúscula
function dayText(day: string): string {
  const d = parseDayKey(day)
  if (!d) return day
  const label = formatDayLabel(
    new Date(d.year, d.month - 1, d.day, 12).toISOString(),
  )
  return label.charAt(0).toLowerCase() + label.slice(1)
}

function HistoricoPage(props: {
  executions: TaskExecution[]
  timeEntries: TimeEntry[]
  tags: Tag[]
  measures: Measure[]
  selections: Selection[]
  workoutCatalog: WorkoutCatalog
  workPicker: WorkPicker
  onEditExecution: (
    executionId: string,
    changes: ExecutionChanges,
  ) => Promise<void>
  onEditTimeEntry: (
    entryId: string,
    changes: { startedAt: string; endedAt: string },
  ) => Promise<void>
  onDeleteTimeEntry: (entryId: string) => Promise<void>
}) {
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [frequency, setFrequency] = useState<FrequencyFilter>('all')
  const [searchParams, setSearchParams] = useSearchParams()
  const [cleared, setCleared] = useState(0)
  const filtersRef = useRef<HTMLDivElement>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarButton = useRef<HTMLButtonElement>(null)
  const calendarId = useId()

  // ?dia=AAAA-MM-DD (dia LOCAL, o mesmo do agrupamento); inválido é ignorado sem erro
  const rawDay = searchParams.get('dia')
  const day = rawDay !== null && isDayKey(rawDay) ? rawDay : null

  // O dia substitui o Período (o estado dele fica guardado); a Frequência continua valendo
  const filtered = props.executions.filter(isCompleted).filter(
    (execution) =>
      (day !== null
        ? localDayKey(execution.completedAt) === day
        : matchesPeriod(execution.completedAt, period)) &&
      // Filtra pelo snapshot (taskFrequencyAtTime), nunca pela frequência
      // atual da tarefa — mesmo princípio do resto do app
      (frequency === 'all' || execution.taskFrequencyAtTime === frequency),
  )

  // Os dias com registro: filtrados só pela Frequência (nem o Período nem o dia entram)
  const dayCounts = countByDay(
    props.executions
      .filter(isCompleted)
      .filter(
        (execution) =>
          frequency === 'all' || execution.taskFrequencyAtTime === frequency,
      )
      .map((execution) => localDayKey(execution.completedAt)),
  )

  function closeCalendar() {
    setCalendarOpen(false)
    calendarButton.current?.focus()
  }

  // Escolher um dia entra no histórico do navegador (o Voltar abre o anterior); o dia que já
  // está ativo só fecha o calendário
  function pickDay(key: string) {
    if (key !== day) {
      const next = new URLSearchParams(searchParams)
      next.set('dia', key)
      setSearchParams(next)
    }
    closeCalendar()
  }

  // Tocar num chip de Período (até o que já está guardado) sai do filtro por dia,
  // e remove o parâmetro mesmo quando ele era inválido
  function dropDayParam() {
    if (!searchParams.has('dia')) return
    const next = new URLSearchParams(searchParams)
    next.delete('dia')
    setSearchParams(next, { replace: true })
  }

  function clearDay() {
    dropDayParam()
    setCleared((n) => n + 1)
  }

  // O botão "Limpar" some: o foco vai ao chip do Período que volta a valer
  useEffect(() => {
    if (cleared === 0) return
    const label = periodOptions.find((o) => o.value === period)?.label
    const chip = [
      ...(filtersRef.current?.querySelectorAll('[role="group"] button') ?? []),
    ].find((b) => b.textContent?.trim() === label)
    ;(chip as HTMLElement | undefined)?.focus()
    // só quando o "Limpar" é tocado: o Período em si não deve refocar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleared])

  const when = day === null ? '' : dayText(day)
  const emptyDay = `Nenhum registro ${
    when === 'hoje' || when === 'ontem' ? when : `em ${when}`
  }${frequency === 'all' ? '' : ' com essa frequência'}.`

  return (
    <div className="flex flex-col gap-6">
      <div
        ref={filtersRef}
        className="flex flex-col gap-1.5 border-b border-linha pb-3.5"
      >
        <FilterChips
          label="Período"
          options={periodOptions}
          value={day === null ? period : null}
          onChange={(value) => {
            setPeriod(value)
            dropDayParam()
          }}
        />
        <button
          ref={calendarButton}
          type="button"
          aria-expanded={calendarOpen}
          aria-controls={calendarOpen ? calendarId : undefined}
          onClick={() => setCalendarOpen((open) => !open)}
          className={`self-start ${secondaryButtonClass}`}
        >
          Calendário
        </button>
        {calendarOpen && (
          <div id={calendarId}>
            <HistoryCalendar
              dayCounts={dayCounts}
              activeDay={day}
              todayKey={localDayKey(new Date().toISOString())}
              emptyText={
                frequency === 'all'
                  ? 'Nenhum registro ainda.'
                  : 'Nenhum registro com essa frequência.'
              }
              onPick={pickDay}
              onClose={closeCalendar}
            />
          </div>
        )}
        {day !== null && (
          <div className="flex flex-wrap items-center gap-x-3 font-dados text-meta text-tinta-suave">
            <span>
              Dia:{' '}
              <span className="font-interface text-sm font-semibold text-tinta">
                {when}
              </span>
            </span>
            <button
              type="button"
              aria-label="Limpar filtro do dia"
              onClick={clearDay}
              className={`inline-flex min-h-11 items-center rounded-md px-1 font-interface text-sm font-medium text-tinta underline decoration-dotted underline-offset-2 ${focusRing}`}
            >
              Limpar
            </button>
          </div>
        )}
        <FrequencySelect value={frequency} onChange={setFrequency} />
      </div>
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-suave">
          {day === null
            ? 'Nenhuma execução encontrada com esses filtros.'
            : emptyDay}
        </p>
      ) : (
        <ExecutionHistory
          executions={filtered}
          timeEntries={props.timeEntries}
          tags={props.tags}
          measures={props.measures}
          selections={props.selections}
          workoutCatalog={props.workoutCatalog}
          workPicker={props.workPicker}
          onEdit={props.onEditExecution}
          onEditTimeEntry={props.onEditTimeEntry}
          onDeleteTimeEntry={props.onDeleteTimeEntry}
        />
      )}
    </div>
  )
}

export default HistoricoPage
