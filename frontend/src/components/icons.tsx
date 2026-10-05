// Ícones próprios, sem dependência nova: são poucos e simples, não justifica
// uma lib inteira (mesma lógica de "sem ORM" do resto do projeto).
// stroke="currentColor" herda a cor do texto do botão, então funcionam nos
// dois temas sem CSS extra.

const commonProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-5 w-5',
  'aria-hidden': true,
}

export function PencilIcon() {
  return (
    <svg {...commonProps}>
      <path d="M4 20l1-4.5L15.5 5A2.1 2.1 0 0 1 18.5 8L8 18.5 4 20Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
}

export function ArchiveIcon() {
  return (
    <svg {...commonProps}>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
      <path d="M10 13h4" />
    </svg>
  )
}

export function UnarchiveIcon() {
  return (
    <svg {...commonProps}>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
      <path d="M12 17v-5" />
      <path d="M9.5 14.5L12 12l2.5 2.5" />
    </svg>
  )
}

export function HistoryIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}

export function ListIcon() {
  return (
    <svg {...commonProps}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="0.75" />
      <circle cx="4.5" cy="12" r="0.75" />
      <circle cx="4.5" cy="18" r="0.75" />
    </svg>
  )
}

export function TimerIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 1.5M10 3h4" />
    </svg>
  )
}

export function SunIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function MoonIcon() {
  return (
    <svg {...commonProps}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  )
}

export function ChevronDownIcon(props: { className?: string }) {
  return (
    <svg {...commonProps} className={props.className ?? 'h-4 w-4'}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function MoreIcon() {
  return (
    <svg {...commonProps} fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg {...commonProps} className="h-4 w-4" fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg {...commonProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function TagIcon() {
  return (
    <svg {...commonProps}>
      <path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5z" />
      <circle cx="8" cy="8" r="1.25" />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg {...commonProps} className="h-4 w-4 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  )
}
