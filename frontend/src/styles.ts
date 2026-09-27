export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta'

// <a> não centraliza sozinho como <button> — precisa ser explícito
const centered = 'flex items-center justify-center'

// Campo é onde você escreve: fonte de texto, não a mono da interface
export const fieldClass = `h-11 rounded-[10px] border border-tinta-suave/45 bg-papel px-3 font-texto text-base text-tinta aria-invalid:border-2 aria-invalid:border-alerta ${focusRing}`

// Botão primário: usa o marca-texto (um dos dois usos permitidos do amarelo)
export const primaryButtonClass = `h-11 ${centered} gap-2 rounded-xl bg-marca-texto px-4 font-semibold text-sobre-marca hover:brightness-95 active:brightness-90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`

export const secondaryButtonClass = `min-h-11 shrink-0 ${centered} gap-2 rounded-xl border border-tinta-suave/45 px-3 text-sm font-medium text-tinta hover:bg-tinta/[0.07] disabled:cursor-wait disabled:opacity-60 ${focusRing}`

// Item de lista, texto à esquerda — sem "centered" de propósito
export const pickerButtonClass = `min-h-11 w-full rounded-xl border border-linha bg-superficie px-3 py-2 text-left text-base text-tinta hover:bg-tinta/[0.04] ${focusRing}`

// Botão só-ícone, sem borda (tema, menu ⋯, editar): 44px de toque
export const quietIconButtonClass = `h-11 w-11 shrink-0 ${centered} rounded-xl text-tinta-suave hover:bg-tinta/[0.07] hover:text-tinta ${focusRing}`

// <button> estilizado como link — nunca <a>, não há navegação aqui
export const inlineButtonClass = `underline decoration-dotted underline-offset-2 hover:text-tinta ${focusRing}`

// Texto clicável discreto, sem sublinhado (ex.: "2 sessões ▾")
export const textButtonClass = `inline-flex min-h-8 items-center gap-0.5 rounded-md hover:text-tinta ${focusRing}`

// Superfície de um item (tarefa, registro): borda, sem sombra. Sombra só
// em elemento que flutua por cima do conteúdo (menu, popover)
export const cardClass =
  'rounded-[14px] border border-linha bg-superficie px-4 py-3.5'

// Etiqueta curta: frequência, estado e, depois, as tags
export const chipClass =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-tinta/[0.07] px-2.5 py-0.5 font-dados text-xs font-medium text-tinta-suave'

export const chipAndamentoClass =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-andamento/[0.13] px-2.5 py-0.5 font-dados text-xs font-medium text-andamento'
