import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, onSessionEnded } from '../api/client'
import { checkSession, logout } from '../api/session'
import { secondaryButtonClass } from '../styles'
import EntryScreen from './EntryScreen'

// O Render grátis dorme: a 1ª resposta pode levar dezenas de segundos
const SLOW_MS = 3000

type Phase = 'checking' | 'unreachable' | 'out' | 'in' | 'expired'

// Rascunhos e memória do painel têm texto pessoal: o Sair apaga; o 401 no meio
// do uso, não (a pessoa entra de novo e continua de onde estava)
function clearSessionStorage() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('studyflow:')) sessionStorage.removeItem(key)
    }
  } catch {
    // Sem acesso ao armazenamento: não há o que apagar
  }
}

// Confere a sessão antes de montar o app; sem ela, a tela de entrada. Um 401
// no meio do uso abre a entrada por cima do app, com o resto inert
function SessionGate(props: {
  render: (onLogout: () => Promise<void>) => ReactNode
}) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [attempt, setAttempt] = useState(0)
  const [slow, setSlow] = useState(false)
  // Onde o foco estava quando a sessão venceu: volta pra lá depois de entrar.
  // O último focado, não o activeElement da hora: o botão tocado costuma estar
  // desligado (enviando) quando o 401 chega, e o foco já caiu no body
  const returnFocus = useRef<HTMLElement | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    function remember(event: FocusEvent) {
      const target = event.target
      if (target instanceof HTMLElement && !target.closest('[role="dialog"]')) {
        lastFocus.current = target
      }
    }
    document.addEventListener('focusin', remember)
    return () => document.removeEventListener('focusin', remember)
  }, [])
  // O ouvinte do 401 lê a fase sem se registrar de novo; só age com o app aberto
  // (o 401 da conferência inicial também passa por ele)
  const phaseNow = useRef(phase)
  useEffect(() => {
    phaseNow.current = phase
  }, [phase])

  useEffect(() => {
    let ignore = false
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    checkSession().then(
      () => {
        if (!ignore) setPhase('in')
      },
      (error: unknown) => {
        if (ignore) return
        setPhase(
          error instanceof ApiError && error.status === 401
            ? 'out'
            : 'unreachable',
        )
      },
    )
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [attempt])

  // Vários 401 juntos: o primeiro guarda o foco, e o diálogo é um só
  useEffect(
    () =>
      onSessionEnded(() => {
        if (phaseNow.current !== 'in') return
        if (!returnFocus.current) returnFocus.current = lastFocus.current
        setPhase((current) => (current === 'in' ? 'expired' : current))
      }),
    [],
  )

  function entered() {
    const target = returnFocus.current
    returnFocus.current = null
    setPhase('in')
    // Depois do inert sair: elemento inert não recebe foco
    if (target) requestAnimationFrame(() => target.focus())
  }

  async function signOut() {
    await logout()
    clearSessionStorage()
    setPhase('out')
  }

  function retry() {
    setSlow(false)
    setPhase('checking')
    setAttempt((n) => n + 1)
  }

  if (phase === 'checking') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-2 px-4">
        {slow && (
          <>
            <p role="status" className="font-semibold">
              Acordando o servidor…
            </p>
            <p className="font-texto text-sm text-tinta-suave">
              Ele dorme quando ninguém usa e pode levar até um minuto.
            </p>
          </>
        )}
      </main>
    )
  }
  if (phase === 'unreachable') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-alerta/40 bg-alerta/[0.08] px-4 py-4"
        >
          <p className="font-semibold text-alerta">
            Não foi possível falar com o servidor.
          </p>
          <button
            type="button"
            onClick={retry}
            className={secondaryButtonClass}
          >
            Tentar de novo
          </button>
        </div>
      </main>
    )
  }
  if (phase === 'out') {
    return <EntryScreen onEntered={() => setPhase('in')} />
  }
  return (
    <>
      <div inert={phase === 'expired'}>{props.render(signOut)}</div>
      {phase === 'expired' && <EntryScreen dialog onEntered={entered} />}
    </>
  )
}

export default SessionGate
