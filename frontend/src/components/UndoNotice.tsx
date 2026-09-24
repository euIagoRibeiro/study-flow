import { useEffect, useState } from 'react'
import { inlineButtonClass } from '../styles'

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
    <p className="text-sm text-tinta-suave">
      Finalizado{' · '}
      <button type="button" onClick={onUndo} className={inlineButtonClass}>
        Desfazer
      </button>{' '}
      ({remaining}s)
    </p>
  )
}

export default UndoNotice
