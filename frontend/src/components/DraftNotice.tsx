import { inlineButtonClass } from '../styles'

// "Rascunho recuperado": o formulário voltou preenchido com o que ficou
// digitado antes (dias podem passar entre uma visita e outra; sem o aviso,
// não daria pra saber se o texto é de agora). "descartar" volta ao intocado
function DraftNotice(props: { onDiscard: () => void }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-tinta-suave">
      Rascunho recuperado.
      <button
        type="button"
        onClick={props.onDiscard}
        className={inlineButtonClass}
      >
        descartar
      </button>
    </p>
  )
}

export default DraftNotice
