import type { ReactNode } from 'react'

// Área de toque de 44px (acessibilidade), mas o que se VÊ — fundo no hover,
// estado ativo e anel de foco — é um círculo de 32px dentro dela. Pra
// botão de ícone numa linha mais baixa que 44px: o destaque não invade as
// linhas vizinhas
function CompactIconButton(props: {
  label: string
  title: string
  expanded?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props.expanded}
      aria-label={props.label}
      title={props.title}
      className={`group flex h-11 w-11 shrink-0 items-center justify-center text-tinta-suave outline-none ${props.className ?? ''}`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full group-hover:bg-tinta/[0.07] group-hover:text-tinta group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-tinta group-aria-expanded:bg-tinta/[0.07] group-aria-expanded:text-tinta">
        {props.children}
      </span>
    </button>
  )
}

export default CompactIconButton
