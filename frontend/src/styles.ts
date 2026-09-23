const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta'

// items-center/justify-center explícitos: <button> centraliza o próprio
// conteúdo por padrão do navegador, mas <a> (usado pelo NavLink) não — sem
// isso, "Lista"/"Executar" ficavam com o texto colado no topo da caixa
const centered = 'flex items-center justify-center'

export const fieldClass = `h-11 rounded-md border border-tinta-suave bg-papel px-3 text-base text-tinta aria-invalid:border-2 aria-invalid:border-tinta ${focusRing}`

// Botão primário: usa o marca-texto (um dos dois usos permitidos do amarelo)
export const primaryButtonClass = `h-11 ${centered} rounded-md bg-marca-texto px-4 font-semibold text-sobre-marca hover:brightness-95 active:brightness-90 ${focusRing}`

export const secondaryButtonClass = `min-h-11 shrink-0 ${centered} rounded-md border border-tinta-suave px-3 text-sm text-tinta-suave hover:text-tinta ${focusRing}`

// Item de navegação da página atual: invertido (fundo tinta, texto papel),
// pra ficar claro onde você está — não usa o marca-texto, essa cor continua
// só com os dois usos combinados (botão primário e estado "feita")
export const activeNavLinkClass = `h-11 ${centered} rounded-md border border-tinta bg-tinta px-3 text-sm font-semibold text-papel ${focusRing}`

// Botão de escolher tarefa na ExecutePage: mesmo anel de foco do resto do
// app (a versão anterior usava o padrão do navegador, mais fraco). Fica de
// fora do "centered" de propósito — é um item de lista, texto à esquerda,
// não uma ação centralizada; já mede certo verticalmente por ser <button>
export const pickerButtonClass = `h-11 w-full rounded-md border border-tinta-suave px-3 text-left text-base text-tinta hover:bg-linha/30 ${focusRing}`

// Botão de ação só com ícone (Editar/Arquivar/Histórico na Task): quadrado,
// mesma área de toque de 44px que os outros, ícone de 20px centralizado
export const iconButtonClass = `h-11 w-11 shrink-0 ${centered} rounded-md border border-tinta-suave text-tinta-suave hover:text-tinta ${focusRing}`
