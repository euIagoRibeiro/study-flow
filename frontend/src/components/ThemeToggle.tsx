import { useEffect, useState } from 'react'
import { quietIconButtonClass } from '../styles'
import { MoonIcon, SunIcon } from './icons'

type Theme = 'light' | 'dark'

const systemQuery = '(prefers-color-scheme: dark)'

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia(systemQuery).matches ? 'dark' : 'light',
  )
  // Enquanto a pessoa não escolhe, o tema segue o sistema; depois do
  // primeiro toque, a escolha dela vale
  const [chosen, setChosen] = useState(false)

  // Sem isso, o ícone ficava errado se o celular trocasse de claro pra
  // escuro com o app aberto (o sistema só era lido uma vez)
  useEffect(() => {
    if (chosen) return
    const media = window.matchMedia(systemQuery)
    function onChange(event: MediaQueryListEvent) {
      setTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [chosen])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
    setChosen(true)
  }

  // Mostra o tema pra onde vai: no escuro, o sol
  const label = theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      // No desktop fica sobre o vidro do topo: lá, sempre `tinta`
      className={`${quietIconButtonClass} sm:text-tinta`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

export default ThemeToggle
