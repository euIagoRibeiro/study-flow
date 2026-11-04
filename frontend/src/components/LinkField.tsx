import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { fieldClass, focusRing } from '../styles'

// Link do registro, recolhido: quase todo registro não tem (serve a vídeo).
// "+ Link" abre o campo e põe o foco nele no mesmo toque: no Android, o
// teclado só abre com o foco dado dentro do gesto. Aberto, fica aberto; o
// rascunho com link já começa aberto (sem foco, pra não abrir o teclado)
function LinkField(props: {
  value: string
  onChange: (text: string) => void
  startOpen: boolean
}) {
  const [open, setOpen] = useState(props.startOpen)
  const input = useRef<HTMLInputElement>(null)

  if (!open) {
    return (
      <div data-link-field="">
        <button
          type="button"
          onClick={() => {
            flushSync(() => setOpen(true))
            input.current?.focus()
          }}
          className={`inline-flex min-h-11 items-center rounded-md text-sm text-tinta-suave hover:text-tinta ${focusRing}`}
        >
          + Link
        </button>
      </div>
    )
  }
  return (
    <label data-link-field="" className="flex flex-col gap-1.5">
      <span className="text-sm text-tinta-suave">Link (opcional)</span>
      <input
        ref={input}
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={2000}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={fieldClass}
      />
    </label>
  )
}

export default LinkField
