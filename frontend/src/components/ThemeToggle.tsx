import { useState } from 'react'

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
    <button
      type="button"
      onClick={toggle}
      className="min-h-11 rounded-md border border-tinta-suave px-3 text-sm text-tinta-suave hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
    >
      {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
    </button>
  )
}

export default ThemeToggle
