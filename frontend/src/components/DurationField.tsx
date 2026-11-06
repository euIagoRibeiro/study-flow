import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { formatTime, isSameLocalDay } from '../dates'
import { sessionEnd } from '../sessionEnd'
import { fieldClass, focusRing } from '../styles'

// "Termina às 23:40 de ontem": o dia certo, antes de finalizar
function endLabel(end: string, now: number) {
  const day = new Date(end)
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  const when = isSameLocalDay(day, today)
    ? 'de hoje'
    : isSameLocalDay(day, yesterday)
      ? 'de ontem'
      : `em ${day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
  return `Termina às ${formatTime(end)} ${when}.`
}

// Recolhido, como o "+ Link": o botão abre o campo e põe o foco no mesmo toque
// (no Android, o teclado só abre com o foco dado dentro do gesto). Sessão longa
// (`forceOpen`): aparece aberto, sem foco
function DurationField(props: {
  value: string
  onChange: (text: string) => void
  startedAt: string
  now: number
  forceOpen: boolean
}) {
  const [open, setOpen] = useState(props.value.trim() !== '')
  const input = useRef<HTMLInputElement>(null)

  if (!open && !props.forceOpen) {
    return (
      <div data-duration-field="">
        <button
          type="button"
          onClick={() => {
            flushSync(() => setOpen(true))
            input.current?.focus()
          }}
          className={`inline-flex min-h-11 items-center rounded-md text-sm text-tinta-suave hover:text-tinta ${focusRing}`}
        >
          + Durou… (esta sessão)
        </button>
      </div>
    )
  }
  const checked = sessionEnd(props.startedAt, props.value, props.now)
  return (
    <div data-duration-field="" className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-tinta-suave">
          Durou (min, esta sessão)
        </span>
        <input
          ref={input}
          type="text"
          inputMode="numeric"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          className={fieldClass}
        />
      </label>
      {'end' in checked && checked.end && (
        <p className="font-dados text-meta text-tinta-suave">
          {endLabel(checked.end, props.now)}
        </p>
      )}
    </div>
  )
}

export default DurationField
