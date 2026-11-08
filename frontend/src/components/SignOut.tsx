import { useState } from 'react'
import { secondaryButtonClass } from '../styles'
import FormError from './FormError'

// No fim da tela de tags: apaga o cookie deste navegador e os rascunhos da
// sessão. Uma cópia do cookie em outro lugar vale até vencer (o botão de pânico
// é trocar o SESSION_SECRET)
function SignOut(props: { onLogout: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function signOut() {
    setSubmitting(true)
    setError('')
    try {
      await props.onLogout()
    } catch (err) {
      console.error(err)
      setError('Não foi possível sair. Tente de novo.')
      setSubmitting(false)
    }
  }

  return (
    <section
      aria-label="Sessão"
      className="flex flex-col items-start gap-2 border-t border-linha pt-4"
    >
      <button
        type="button"
        onClick={signOut}
        disabled={submitting}
        className={secondaryButtonClass}
      >
        {submitting ? 'Saindo…' : 'Sair'}
      </button>
      {error && <FormError>{error}</FormError>}
    </section>
  )
}

export default SignOut
