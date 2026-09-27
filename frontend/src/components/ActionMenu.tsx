import { useEffect, useRef, useState, type ReactNode } from 'react'
import { focusRing, quietIconButtonClass } from '../styles'
import { MoreIcon } from './icons'

export type MenuAction = {
  label: string
  icon: ReactNode
  onSelect: () => void
}

function ActionMenu(props: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  // useRef guarda o elemento real da página, pra saber se um toque foi
  // dentro ou fora do menu — mudar o ref não re-renderiza
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Os ouvintes só existem enquanto está aberto; a limpeza tira os dois
  useEffect(() => {
    if (!open) return

    // Teclado: o foco vai pro primeiro item ao abrir
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative -mt-2 -mr-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        title="Mais ações"
        className={`${quietIconButtonClass} aria-expanded:bg-tinta/[0.07] aria-expanded:text-tinta`}
      >
        <MoreIcon />
      </button>
      {open && (
        // Sombra só aqui: é o único tipo de elemento que flutua por cima
        <div
          role="menu"
          aria-label={props.label}
          className="absolute top-11 right-0 z-20 min-w-52 rounded-xl border border-linha bg-superficie p-1.5 shadow-lg shadow-black/15"
        >
          {props.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm whitespace-nowrap hover:bg-tinta/[0.07] ${focusRing}`}
            >
              <span className="text-tinta-suave">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ActionMenu
