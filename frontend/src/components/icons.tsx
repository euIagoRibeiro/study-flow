// Ícones próprios, sem dependência nova: são só 3, não justifica uma lib
// inteira (mesma lógica de "sem ORM, sem Supabase Auth" do resto do
// projeto). stroke="currentColor" herda a cor do texto do botão, então
// funcionam nos dois temas sem CSS extra.

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

export function HistoryIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}
