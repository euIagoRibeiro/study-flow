import { useEffect, useRef } from 'react'
import { AlertIcon } from './icons'

// Erro de formulário: um lugar só pro visual (cor alerta + ícone), usado
// pelos 5 formulários. `focusSignal` > 0 leva o foco (e a rolagem) até a
// mensagem a cada vez que o número muda (o Registrar com o aviso aberto)
function FormError(props: { children: string; focusSignal?: number }) {
  const box = useRef<HTMLParagraphElement>(null)
  const signal = props.focusSignal ?? 0
  useEffect(() => {
    if (signal > 0) box.current?.focus()
  }, [signal])
  return (
    <p
      ref={box}
      tabIndex={-1}
      role="alert"
      className="flex items-center gap-1.5 text-sm font-semibold text-alerta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
    >
      <AlertIcon />
      {props.children}
    </p>
  )
}

export default FormError
