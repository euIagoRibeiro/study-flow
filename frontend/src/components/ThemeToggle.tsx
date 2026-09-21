import { useState } from 'react'
import { secondaryButtonClass } from '../styles'

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

  return (
    <button type="button" onClick={toggle} className={secondaryButtonClass}>
      {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
    </button>
  )
}

export default ThemeToggle
