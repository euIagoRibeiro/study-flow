import { Link, Outlet } from 'react-router'
import ThemeToggle from '../components/ThemeToggle'
import { secondaryButtonClass } from '../styles'

function Layout() {
  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">StudyFlow</h1>
        <ThemeToggle />
      </header>
      <nav className="mb-6 flex gap-2">
        <Link to="/" className={secondaryButtonClass}>
          Lista
        </Link>
        <Link to="/executar" className={secondaryButtonClass}>
          Executar
        </Link>
      </nav>
      {/* A rota filha atual (TaskListPage ou ExecutePage) é desenhada aqui */}
      <Outlet />
    </main>
  )
}

export default Layout
