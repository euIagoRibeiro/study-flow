const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta'

export const fieldClass = `h-11 rounded-md border border-tinta-suave bg-papel px-3 text-base text-tinta aria-invalid:border-2 aria-invalid:border-tinta ${focusRing}`

// Botão primário: usa o marca-texto (um dos dois usos permitidos do amarelo)
export const primaryButtonClass = `h-11 rounded-md bg-marca-texto px-4 font-semibold text-sobre-marca hover:brightness-95 active:brightness-90 ${focusRing}`

export const secondaryButtonClass = `min-h-11 shrink-0 rounded-md border border-tinta-suave px-3 text-sm text-tinta-suave hover:text-tinta ${focusRing}`
