import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import ThemeToggle from '../components/ThemeToggle'
import { HistoryIcon, ListIcon, TimerIcon } from '../components/icons'
import { focusRing, inlineButtonClass, secondaryButtonClass } from '../styles'
import type { LoadStatus } from '../types'

// Um só <nav>: no celular vira barra fixa embaixo (ícone + texto, alcance do
// polegar); a partir de sm, fica no topo como pílulas só de texto
function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = `flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-xs font-medium sm:h-10 sm:flex-row sm:rounded-full sm:px-3.5 sm:py-0 sm:text-sm ${focusRing}`
  // Sobre vidro (barra no celular, topo no desktop) o texto é sempre
  // `tinta`: o ativo se destaca pelo negrito/pílula, não pela cor dos outros
  return isActive
    ? `${base} text-tinta max-sm:font-bold sm:bg-tinta sm:text-papel`
    : `${base} text-tinta sm:hover:bg-tinta/[0.07]`
}

function NavItem(props: {
  to: string
  end?: boolean
  icon: ReactNode
  label: string
}) {
  return (
    <NavLink to={props.to} end={props.end} className={navLinkClass}>
      {({ isActive }) => (
        <>
          <span
            className={`inline-flex rounded-full px-4 py-0.5 sm:hidden ${isActive ? 'bg-tinta/[0.12]' : ''}`}
          >
            {props.icon}
          </span>
          {props.label}
        </>
      )}
    </NavLink>
  )
}

function Layout(props: {
  status: LoadStatus
  onRetry: () => void
  saveError: string | null
  onDismissSaveError: () => void
}) {
  return (
    <>
      {/* Topo fixo de vidro só a partir de sm: com backdrop-filter, ele
          viraria a referência dos filhos `fixed`, e a barra do celular
          (que mora aqui dentro) deixaria de grudar no rodapé da tela */}
      <div className="sm:sticky sm:top-0 sm:z-20 sm:border-b sm:border-vidro-fio sm:vidro">
        {/* Ordem = ordem visual do desktop (e do Tab): título, nav, tema */}
        <header className="mx-auto flex max-w-xl items-center gap-4 px-4 pt-6 pb-3 sm:h-16 sm:py-0">
          <h1 className="mr-auto font-titulo text-xl font-bold tracking-tight">
            StudyFlow
          </h1>
          <nav
            aria-label="Principal"
            className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 gap-1 border-t border-vidro-fio px-3 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] max-sm:vidro sm:static sm:flex sm:gap-1 sm:border-0 sm:p-0"
          >
            {/* "end" evita que "/" fique marcada como ativa em "/executar" também */}
            <NavItem to="/" end icon={<ListIcon />} label="Lista" />
            <NavItem to="/executar" icon={<TimerIcon />} label="Executar" />
            <NavItem to="/historico" icon={<HistoryIcon />} label="Histórico" />
          </nav>
          <ThemeToggle />
        </header>
      </div>
      <div className="mx-auto max-w-xl px-4 pb-28 sm:pt-6 sm:pb-10">
        {props.saveError && (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-alerta/40 bg-alerta/[0.08] px-4 py-3 text-sm"
          >
            <p className="font-semibold text-alerta">{props.saveError}</p>
            <button
              type="button"
              onClick={props.onDismissSaveError}
              className={`shrink-0 text-tinta-suave ${inlineButtonClass}`}
            >
              fechar
            </button>
          </div>
        )}
        <main>
          {/* A página só monta com os dados já carregados: a ExecutePage lê
            ?tarefa= da URL uma vez só, na primeira renderização */}
          {props.status === 'loading' && (
            <p className="text-sm text-tinta-suave">Carregando…</p>
          )}
          {props.status === 'error' && (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-xl border border-alerta/40 bg-alerta/[0.08] px-4 py-4"
            >
              <p className="font-semibold text-alerta">
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
          {props.status === 'ready' && <Outlet />}
        </main>
      </div>
    </>
  )
}

export default Layout
