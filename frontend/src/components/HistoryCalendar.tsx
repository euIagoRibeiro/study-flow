import { useEffect, useId, useRef, useState } from 'react'
import {
  canShiftMonth,
  clampMonth,
  dayAriaLabel,
  monthBounds,
  monthGrid,
  monthOf,
  monthTitle,
  moveFromKey,
  moveMonthKeepingDay,
  shiftMonth,
  type ArrowKey,
} from '../calendar'
import { focusRing } from '../styles'
import { ChevronDownIcon } from './icons'

const GRID_KEYS = new Set<string>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])
const WEEKDAY_HEADERS = [
  ['seg', 'segunda-feira'],
  ['ter', 'terça-feira'],
  ['qua', 'quarta-feira'],
  ['qui', 'quinta-feira'],
  ['sex', 'sexta-feira'],
  ['sáb', 'sábado'],
  ['dom', 'domingo'],
]

// Calendário do Histórico, inline abaixo do botão (empurra a lista, não flutua). Grade com UMA célula
// tabulável (roving tabindex); as setas andam por TODOS os dias, inclusive os sem registro (que ficam
// aria-disabled, não disabled: o foco passa por eles). Os limites dos meses vêm dos dias com registro.
// O aviso falado do mês (role="status") só dispara pelos botões de mês: pelo teclado, o rótulo da célula
// focada já diz o dia e o mês, e um aviso a mais seria repetição
function HistoryCalendar(props: {
  dayCounts: Map<string, number>
  activeDay: string | null
  todayKey: string
  emptyText: string
  onPick: (key: string) => void
  onClose: () => void
}) {
  const bounds = monthBounds(
    [...props.dayCounts.keys()],
    monthOf(props.todayKey),
  )
  const [viewMonth, setViewMonth] = useState(() =>
    clampMonth(
      props.activeDay ? monthOf(props.activeDay) : monthOf(props.todayKey),
      bounds,
    ),
  )
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // 1: a primeira renderização já leva o foco à célula tabulável
  const [focusTick, setFocusTick] = useState(1)
  const [announce, setAnnounce] = useState('')
  const grid = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // O mês mostrado nunca sai dos limites (a Frequência pode mudá-los com o calendário aberto)
  const shown = clampMonth(viewMonth, bounds)
  const cells = monthGrid(shown)
  // O dia ativo; senão hoje; senão o primeiro do mês
  const fallback =
    props.activeDay && monthOf(props.activeDay) === shown
      ? props.activeDay
      : monthOf(props.todayKey) === shown
        ? props.todayKey
        : `${shown}-01`
  const roving =
    focusKey !== null && cells.some((cell) => cell.key === focusKey)
      ? focusKey
      : fallback

  useEffect(() => {
    if (focusTick === 0) return
    grid.current?.querySelector<HTMLElement>('[data-roving="true"]')?.focus()
  }, [focusTick])

  function moveFocus(target: string) {
    const month = monthOf(target)
    if (month < bounds.min || month > bounds.max) return
    setFocusKey(target)
    setViewMonth(month)
    setAnnounce('')
    setFocusTick((n) => n + 1)
  }

  function shift(delta: number) {
    if (!canShiftMonth(shown, delta, bounds)) return
    const target = shiftMonth(shown, delta)
    // O mesmo dia do mês de destino (ajustado se ele é mais curto), como o PageUp/PageDown
    const base = monthOf(roving) === shown ? roving : `${shown}-01`
    setViewMonth(target)
    setFocusKey(moveMonthKeepingDay(base, delta))
    setAnnounce(monthTitle(target))
  }

  const empty = props.dayCounts.size === 0
  const prevOff = !canShiftMonth(shown, -1, bounds)
  const nextOff = !canShiftMonth(shown, 1, bounds)
  const arrowClass = `flex h-11 w-11 items-center justify-center rounded-xl text-tinta hover:bg-tinta/[0.07] aria-disabled:cursor-default aria-disabled:text-tinta-suave aria-disabled:opacity-60 aria-disabled:hover:bg-transparent ${focusRing}`

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          props.onClose()
        }
      }}
      className="flex flex-col gap-1 py-1 sm:rounded-xl sm:border sm:border-linha sm:bg-superficie sm:p-3"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Mês anterior"
          aria-disabled={prevOff ? 'true' : undefined}
          onClick={() => shift(-1)}
          className={arrowClass}
        >
          <ChevronDownIcon className="h-4 w-4 rotate-90" />
        </button>
        <div
          id={titleId}
          className="font-titulo text-sm font-semibold text-tinta"
        >
          {monthTitle(shown)}
        </div>
        <button
          type="button"
          aria-label="Próximo mês"
          aria-disabled={nextOff ? 'true' : undefined}
          onClick={() => shift(1)}
          className={arrowClass}
        >
          <ChevronDownIcon className="h-4 w-4 -rotate-90" />
        </button>
      </div>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div
        ref={grid}
        role="grid"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (!GRID_KEYS.has(event.key)) return
          event.preventDefault()
          moveFocus(moveFromKey(roving, event.key as ArrowKey))
        }}
      >
        <div role="row" className="grid grid-cols-7">
          {WEEKDAY_HEADERS.map(([short, long]) => (
            <div
              key={short}
              role="columnheader"
              aria-label={long}
              className="py-1 text-center font-dados text-meta text-tinta-suave"
            >
              {short}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} role="row" className="grid grid-cols-7">
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const count = props.dayCounts.get(cell.key) ?? 0
              const active = cell.key === props.activeDay
              const isRoving = cell.key === roving
              return (
                <div
                  key={cell.key}
                  role="gridcell"
                  aria-selected={active}
                  className="flex"
                >
                  <button
                    type="button"
                    data-day={cell.key}
                    data-roving={isRoving}
                    tabIndex={isRoving ? 0 : -1}
                    onFocus={() => setFocusKey(cell.key)}
                    aria-label={dayAriaLabel(cell.key, count)}
                    aria-disabled={count === 0 ? 'true' : undefined}
                    aria-current={
                      cell.key === props.todayKey ? 'date' : undefined
                    }
                    onClick={() => {
                      if (count > 0) props.onPick(cell.key)
                    }}
                    className={`flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg font-interface text-sm ${focusRing} ${
                      active
                        ? 'bg-tinta font-semibold text-papel'
                        : cell.inMonth
                          ? 'text-tinta hover:bg-tinta/[0.07]'
                          : 'text-tinta-suave hover:bg-tinta/[0.07]'
                    } ${count === 0 && !active ? 'cursor-default text-tinta-suave hover:bg-transparent' : ''} ${
                      cell.key === props.todayKey && !active
                        ? 'border border-tinta-suave/60'
                        : ''
                    }`}
                  >
                    <span aria-hidden="true">{cell.day}</span>
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${count > 0 ? 'bg-current' : ''}`}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {empty && (
        <p className="py-1 text-center text-sm text-tinta-suave">
          {props.emptyText}
        </p>
      )}
    </div>
  )
}

export default HistoryCalendar
