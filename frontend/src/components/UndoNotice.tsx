import { useEffect, useState } from 'react'
import { secondaryButtonClass } from '../styles'

function UndoNotice(props: {
  seconds: number
  onExpire: () => void
  onUndo: () => void
}) {
  const { onExpire, onUndo } = props
  const [remaining, setRemaining] = useState(props.seconds)

  // Reage a cada mudança de remaining: chegou a zero, dispara e para;
  // senão, agenda só o próximo segundo (não um intervalo solto correndo
  // por conta própria — evita chamar onExpire mais de uma vez)
  useEffect(() => {
    if (remaining <= 0) {
      onExpire()
      return
    }
    const timeout = setTimeout(() => setRemaining((r) => r - 1), 1000)
    return () => clearTimeout(timeout)
  }, [remaining, onExpire])

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-tinta/[0.07] px-4 py-3">
      <p className="font-semibold">Finalizado.</p>
      <button type="button" onClick={onUndo} className={secondaryButtonClass}>
        Desfazer
        <span className="font-dados text-tinta-suave tabular-nums">
          {remaining}s
        </span>
      </button>
    </div>
  )
}

export default UndoNotice
