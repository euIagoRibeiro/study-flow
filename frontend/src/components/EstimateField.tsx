import { useId } from 'react'
import { durationWords, parseDuration } from '../numbers'
import { fieldClass } from '../styles'

// "90" = minutos, "1:22" = min:s (regra em parseDuration). Teclado de texto:
// o numérico do celular não tem ":". Embaixo, o que o campo entendeu; vazio,
// a dica. Quem valida é o formulário. O texto fica com quem usa (pode ser '')
function EstimateField(props: {
  value: string
  onChange: (value: string) => void
}) {
  const noteId = useId()
  const seconds = parseDuration(props.value)
  const note =
    props.value.trim() === ''
      ? 'Minutos, ou min:s'
      : typeof seconds === 'number'
        ? `= ${durationWords(seconds)}`
        : ''

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-tinta-suave">
        Duração estimada (opcional)
      </span>
      <input
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={noteId}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={fieldClass}
      />
      <span
        id={noteId}
        aria-live="polite"
        data-estimate-note
        className="min-h-5 text-sm text-tinta-suave [overflow-wrap:anywhere]"
      >
        {note}
      </span>
    </label>
  )
}

export default EstimateField
