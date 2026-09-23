const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta'

// <a> não centraliza sozinho como <button> — precisa ser explícito
const centered = 'flex items-center justify-center'

export const fieldClass = `h-11 rounded-md border border-tinta-suave bg-papel px-3 text-base text-tinta aria-invalid:border-2 aria-invalid:border-tinta ${focusRing}`

// Botão primário: usa o marca-texto (um dos dois usos permitidos do amarelo)
export const primaryButtonClass = `h-11 ${centered} rounded-md bg-marca-texto px-4 font-semibold text-sobre-marca hover:brightness-95 active:brightness-90 ${focusRing}`

export const secondaryButtonClass = `min-h-11 shrink-0 ${centered} rounded-md border border-tinta-suave px-3 text-sm text-tinta-suave hover:text-tinta ${focusRing}`

// Página atual: invertido — não usa marca-texto, só os 2 usos já combinados
export const activeNavLinkClass = `h-11 ${centered} rounded-md border border-tinta bg-tinta px-3 text-sm font-semibold text-papel ${focusRing}`

// Item de lista, texto à esquerda — sem "centered" de propósito
export const pickerButtonClass = `h-11 w-full rounded-md border border-tinta-suave px-3 text-left text-base text-tinta hover:bg-linha/30 ${focusRing}`

// Botão só-ícone (Editar/Arquivar/Histórico): 44px de toque, ícone de 20px
export const iconButtonClass = `h-11 w-11 shrink-0 ${centered} rounded-md border border-tinta-suave text-tinta-suave hover:text-tinta ${focusRing}`

// <button> estilizado como link — nunca <a>, não há navegação aqui
export const inlineButtonClass = `underline decoration-dotted underline-offset-2 hover:text-tinta ${focusRing}`
