import { useEffect, useRef, useState } from 'react'
import { focusRing } from '../styles'
import { ChevronDownIcon } from './icons'

export type ChipOption<T extends string> = {
  value: T
  label: string
  count?: number // opcional: sem ele, o chip é só o texto
}

// Genérico em T: o onChange devolve o tipo exato de quem usa (período no
// Histórico, frequência na Executar), sem precisar de "as"
function FilterChips<T extends string>(props: {
  label: string
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  // Há chip escondido à esquerda / à direita? Decide quais setas aparecem
  const [hidden, setHidden] = useState({ left: false, right: false })

  useEffect(() => {
    const scroller = scrollerRef.current
    const row = rowRef.current
    if (!scroller || !row) return

    function update() {
      if (!scroller) return
      const { scrollLeft, clientWidth, scrollWidth } = scroller
      setHidden({
        left: scrollLeft > 1,
        right: scrollLeft + clientWidth < scrollWidth - 1,
      })
    }

    // O ResizeObserver chama update logo ao começar a observar, e de novo
    // quando a janela muda OU os chips mudam de largura (contagem "6" → "12")
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    observer.observe(row)
    scroller.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', update)
    }
  }, [])

  function scrollBy(direction: 1 | -1) {
    const scroller = scrollerRef.current
    if (!scroller) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollBy({
      left: direction * scroller.clientWidth * 0.7,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  // Setas só com ponteiro fino (mouse/touchpad — o navegador não distingue
  // os dois); no toque, arrastar com o dedo já é natural. Fora da ordem do
  // Tab (tabIndex -1) e do leitor de tela: pelo teclado, Tab já leva a
  // linha até o chip focado
  const arrowClass = `absolute inset-y-0 z-10 hidden items-center ${focusRing}`
  const arrowButton =
    'flex h-8 w-8 items-center justify-center rounded-full border border-tinta-suave/40 bg-superficie text-tinta-suave hover:text-tinta'

  return (
    // -mx-4 no celular: a linha rola até a borda da tela, sem cortar no gutter
    <div className="relative -mx-4 sm:mx-0">
      {/* Sem barra (o chip cortado na borda já mostra que tem mais).
          py-1/-my-1: folga pro anel de foco, que o overflow cortaria */}
      <div
        ref={scrollerRef}
        role="group"
        aria-label={props.label}
        className="-my-1 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <div ref={rowRef} className="flex w-max gap-1.5">
          {props.options.map((option) => {
            const active = option.value === props.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => props.onChange(option.value)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${focusRing} ${
                  active
                    ? 'border-tinta bg-tinta text-papel'
                    : 'border-tinta-suave/40 text-tinta-suave hover:text-tinta'
                }`}
              >
                {option.label}
                {option.count !== undefined && (
                  <span className="font-dados tabular-nums opacity-70">
                    {option.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      {hidden.left && (
        <div
          className={`${arrowClass} left-0 bg-linear-to-r from-papel from-75% to-transparent pr-3 pl-4 pointer-fine:flex sm:pl-0`}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => scrollBy(-1)}
            className={arrowButton}
          >
            <ChevronDownIcon className="h-4 w-4 rotate-90" />
          </button>
        </div>
      )}
      {hidden.right && (
        <div
          className={`${arrowClass} right-0 bg-linear-to-l from-papel from-75% to-transparent pr-4 pl-3 pointer-fine:flex sm:pr-0`}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => scrollBy(1)}
            className={arrowButton}
          >
            <ChevronDownIcon className="h-4 w-4 -rotate-90" />
          </button>
        </div>
      )}
    </div>
  )
}

export default FilterChips
