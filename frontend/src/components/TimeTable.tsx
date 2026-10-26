import { formatDuration } from '../dates'
import { formatDiff, percent } from '../painel'
import { textButtonClass } from '../styles'

export type Row = {
  key: string
  name: string
  seconds: number
  previous?: number // com comparação: o tempo no período anterior
  dot?: string // classe da cor (legenda); sem ela, linha sem bolinha
  onOpen?: () => void // contexto: abre o detalhe
}

// Diferença com o anterior: o sinal e a palavra, o % embaixo
function Diff(props: { current: number; previous: number }) {
  const diff = formatDiff(props.current, props.previous)
  return (
    <>
      <span className="block">{diff.text}</span>
      {diff.percent && (
        <span className="block text-meta text-tinta-suave">{diff.percent}</span>
      )}
    </>
  )
}

// Tabela = os números exatos e a legenda dos gráficos (bolinha da cor). Um
// formato só, em qualquer largura: o % do total embaixo do tempo (com a 4ª
// coluna, "%" espremia e encostava no tempo em 320px). Com `compare`, a
// coluna "vs. anterior". Nome quebra dentro da palavra só como último
// recurso: até 10 caracteres não quebra (sem o mínimo, a tabela encolhia o
// nome primeiro e partia "Vestibul/ar" em 320px); maior que isso, quebra em
// vez de empurrar a tabela pra fora da tela. 10 = o que cabe no cartão do
// detalhe em 320 (com a barra de rolagem clássica), com a bolinha, o tempo e
// a diferença, e os vãos de 6px (com 8px, faltava 1,4px). O mínimo vai no
// texto, não na caixa com a bolinha. `percentOf`: o % sobre outro total que
// não a soma das linhas (tags aninhadas: a soma passaria de 100%)
function TimeTable(props: {
  caption: string
  head: string
  rows: Row[]
  compare?: boolean
  percentOf?: number
}) {
  const total =
    props.percentOf ?? props.rows.reduce((sum, row) => sum + row.seconds, 0)
  return (
    <table className="w-full text-left">
      <caption className="sr-only">{props.caption}</caption>
      <thead className="text-meta text-tinta-suave">
        <tr>
          <th scope="col" className="pb-1 font-normal">
            {props.head}
          </th>
          <th scope="col" className="pb-1 text-right font-normal">
            Tempo
          </th>
          {props.compare && (
            <th scope="col" className="pb-1 pl-1.5 text-right font-normal">
              vs. anterior
            </th>
          )}
        </tr>
      </thead>
      <tbody className="font-dados tabular-nums">
        {props.rows.map((row) => (
          <tr key={row.key} className="border-t border-linha">
            <td className="py-1 pr-1.5 wrap-anywhere">
              <span className="flex min-h-9 items-center gap-1.5">
                {row.dot && (
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.dot}`}
                  />
                )}
                {row.onOpen ? (
                  <button
                    type="button"
                    onClick={row.onOpen}
                    className={`min-w-[10ch] text-left underline decoration-dotted underline-offset-2 ${textButtonClass}`}
                  >
                    {row.name}
                  </button>
                ) : (
                  <span className="min-w-[10ch]">{row.name}</span>
                )}
              </span>
            </td>
            <td className="py-1 text-right whitespace-nowrap">
              <span className="block">
                {formatDuration(row.seconds * 1000)}
              </span>
              <span className="block text-meta text-tinta-suave">
                {total > 0 ? percent(row.seconds, total) : '0%'}
              </span>
            </td>
            {props.compare && (
              <td className="py-1 pl-1.5 text-right">
                <Diff current={row.seconds} previous={row.previous ?? 0} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default TimeTable
