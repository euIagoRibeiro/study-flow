import { useState } from 'react'
import { quietIconButtonClass } from '../styles'
import { MoonIcon, SunIcon } from './icons'

type Theme = 'light' | 'dark'

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
  }

  // Mostra o tema pra onde vai: no escuro, o sol
  const label = theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={quietIconButtonClass}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

export default ThemeToggle
