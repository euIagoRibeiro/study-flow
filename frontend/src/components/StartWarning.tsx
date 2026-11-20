import { useEffect, useRef } from 'react'
import { joinFields } from '../manualFields'
import { focusRing, primaryButtonClass, secondaryButtonClass } from '../styles'

// O "Iniciar cronômetro" com campos preenchidos que ele não leva (Quando, Duração estimada, Medida):
// bloco no lugar do botão Iniciar, sem janela. O foco vai pro título ao abrir; Escape = Voltar.
// "Registrar" é o botão principal (envia o formulário de baixo, que fica na tela com o que foi
// preenchido); "Iniciar mesmo assim" fica aria-disabled (e não disabled) enquanto inicia, pra
// não perder o foco do teclado
function StartWarning(props: {
  fields: string[]
  formId: string
  starting: boolean
  onStart: () => void
  onBack: () => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus()
  }, [])

  return (
    <div
      role="alert"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          props.onBack()
        }
      }}
      className="flex flex-col gap-3 rounded-xl border border-linha bg-superficie px-4 py-4"
    >
      <h3
        ref={title}
        tabIndex={-1}
        className={`font-titulo text-base font-semibold rounded-md ${focusRing}`}
      >
        Isto não vai para o cronômetro
      </h3>
      <p className="font-texto text-sm">
        Você preencheu {joinFields(props.fields)}. Esses campos só valem no
        Registrar; no cronômetro seriam descartados.
      </p>
      <button
        type="submit"
        form={props.formId}
        className={`h-13 w-full text-base ${primaryButtonClass}`}
      >
        Registrar
      </button>
      <button
        type="button"
        onClick={props.onStart}
        aria-disabled={props.starting ? 'true' : undefined}
        className={`w-full ${secondaryButtonClass}`}
      >
        Iniciar mesmo assim
      </button>
      <button
        type="button"
        onClick={props.onBack}
        className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-tinta-suave hover:text-tinta ${focusRing}`}
      >
        Voltar
      </button>
    </div>
  )
}

export default StartWarning
