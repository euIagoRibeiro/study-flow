import { NavLink, Outlet } from 'react-router'
import ThemeToggle from '../components/ThemeToggle'
import {
  activeNavLinkClass,
  inlineButtonClass,
  secondaryButtonClass,
} from '../styles'
import type { LoadStatus } from '../types'

// NavLink é o Link que sabe se aponta pra rota atual, via isActive
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? activeNavLinkClass : secondaryButtonClass
}

function Layout(props: {
  status: LoadStatus
  onRetry: () => void
  saveError: string | null
  onDismissSaveError: () => void
}) {
  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">StudyFlow</h1>
        <ThemeToggle />
      </header>
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
      {props.saveError && (
        <p role="alert" className="mb-6 font-semibold">
          {props.saveError}{' '}
          <button
            type="button"
            onClick={props.onDismissSaveError}
            className={`font-normal ${inlineButtonClass}`}
          >
            fechar
          </button>
        </p>
      )}
      {/* A página só monta com os dados já carregados: a ExecutePage lê
          ?tarefa= da URL uma vez só, na primeira renderização */}
      {props.status === 'loading' && (
        <p className="text-sm text-tinta-suave">Carregando…</p>
      )}
      {props.status === 'error' && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-semibold">
            Não foi possível conectar ao servidor.
          </p>
          <button
            type="button"
            onClick={props.onRetry}
            className={secondaryButtonClass}
          >
            Tentar de novo
          </button>
        </div>
      )}
      {/* A rota filha atual (TaskListPage ou ExecutePage) é desenhada aqui */}
      {props.status === 'ready' && <Outlet />}
    </main>
  )
}

export default Layout
