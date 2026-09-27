import { AlertIcon } from './icons'

// Erro de formulário: um lugar só pro visual (cor alerta + ícone), usado
// pelos 5 formulários
function FormError(props: { children: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-1.5 text-sm font-semibold text-alerta"
    >
      <AlertIcon />
      {props.children}
    </p>
  )
}

export default FormError
