import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/client'
import { login } from '../api/session'
import { cardClass, fieldClass, primaryButtonClass } from '../styles'
import FormError from './FormError'

// Entrada: a página inteira (sem sessão ao abrir) ou um diálogo por cima do app
// (a sessão venceu no meio do uso; o resto da página fica inert, e o que estava
// digitado continua lá). Escape não fecha: sem entrar, nada funciona atrás
function EntryScreen(props: { dialog?: boolean; onEntered: () => void }) {
  const titleId = useId()
  const passwordRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 429: o botão espera o Retry-After e volta sozinho
  const [waitUntil, setWaitUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (waitUntil === null) return
    const timer = setInterval(() => {
      const t = Date.now()
      if (t >= waitUntil) setWaitUntil(null)
      else setNow(t)
    }, 250)
    return () => clearInterval(timer)
  }, [waitUntil])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting || waitUntil !== null) return
    setSubmitting(true)
    setError('')
    try {
      await login(password)
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 429) {
        const t = Date.now()
        setNow(t)
        setWaitUntil(t + (err.retryAfter ?? 60) * 1000)
        return
      }
      // 401 do /login: o motivo do servidor ("Senha incorreta."), nunca o de
      // sessão vencida
      setError(
        err instanceof ApiError && err.status === 401
          ? err.message
          : 'Não foi possível entrar. Tente de novo.',
      )
      passwordRef.current?.select()
      return
    }
    props.onEntered()
  }

  const seconds =
    waitUntil === null ? 0 : Math.max(1, Math.ceil((waitUntil - now) / 1000))

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/* Pro gerenciador de senhas guardar o par: o login é de um usuário só */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        defaultValue="studyflow"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Senha</span>
        <input
          ref={passwordRef}
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={fieldClass}
        />
      </label>
      {error && <FormError>{error}</FormError>}
      {waitUntil !== null && (
        <p role="status" className="text-sm font-semibold text-alerta">
          Muitos pedidos. Tente de novo em {seconds} s.
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || waitUntil !== null}
        className={primaryButtonClass}
      >
        {submitting ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )

  if (!props.dialog) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-10">
        <h1
          id={titleId}
          className="font-titulo text-xl font-bold tracking-tight"
        >
          StudyFlow
        </h1>
        <div className={cardClass}>{form}</div>
      </main>
    )
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-papel/85 px-4 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${cardClass} mx-auto mt-[10vh] flex max-w-sm flex-col gap-3 shadow-lg shadow-black/10`}
      >
        <h2 id={titleId} className="font-titulo text-lg font-bold">
          Sua sessão terminou
        </h2>
        <p className="font-texto text-sm text-tinta-suave">
          Entre de novo para continuar. O que você digitou continua aqui.
        </p>
        {form}
      </div>
    </div>
  )
}

export default EntryScreen
