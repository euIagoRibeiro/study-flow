import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import ElapsedTime from '../components/ElapsedTime'
import ThemeToggle from '../components/ThemeToggle'
import { activeNavLinkClass, secondaryButtonClass } from '../styles'

// NavLink é o Link que sabe se aponta pra rota atual, via isActive
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? activeNavLinkClass : secondaryButtonClass
}

function Layout() {
  // DEMO TEMPORÁRIA — etapa 1 da Fase 2, sai quando o cronômetro de
  // verdade entrar (etapa 3)
  const [demoStartedAt] = useState(() => new Date().toISOString())

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">StudyFlow</h1>
        <ThemeToggle />
      </header>
      <p className="mb-4 text-xs text-tinta-suave">
        Demo do relógio (temporária): <ElapsedTime startedAt={demoStartedAt} />
      </p>
      <nav className="mb-6 flex gap-2">
        {/* "end" evita que "/" fique marcada como ativa em "/executar" também */}
        <NavLink to="/" end className={navLinkClass}>
          Lista
        </NavLink>
        <NavLink to="/executar" className={navLinkClass}>
          Executar
        </NavLink>
        <NavLink to="/historico" className={navLinkClass}>
          Histórico
        </NavLink>
      </nav>
      {/* A rota filha atual (TaskListPage ou ExecutePage) é desenhada aqui */}
      <Outlet />
    </main>
  )
}

export default Layout
