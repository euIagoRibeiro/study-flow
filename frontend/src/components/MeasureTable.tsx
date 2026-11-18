import { formatQuantity } from '../numbers'

export type MeasureRow = {
  key: string
  name: string
  quantity: number
  share: string // o % do total, já formatado
}

// Uma linha por tipo da medida: a quantidade e, embaixo, o % do total. Mesmas regras
// de largura da TimeTable (nome com mínimo de 10 caracteres, que só quebra como último
// recurso), pra caber no cartão em 320px
function MeasureTable(props: { caption: string; rows: MeasureRow[] }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">{props.caption}</caption>
      <thead className="text-meta text-tinta-suave">
        <tr>
          <th scope="col" className="pb-1 font-normal">
            Tipo
          </th>
          <th scope="col" className="pb-1 text-right font-normal">
            Quantidade
          </th>
        </tr>
      </thead>
      <tbody className="font-dados tabular-nums">
        {props.rows.map((row) => (
          <tr key={row.key} className="border-t border-linha">
            <td className="py-1 pr-1.5 wrap-anywhere">
              <span className="flex min-h-9 items-center">
                <span className="min-w-[10ch]">{row.name}</span>
              </span>
            </td>
            <td className="py-1 text-right whitespace-nowrap">
              <span className="block">{formatQuantity(row.quantity)}</span>
              <span className="block text-meta text-tinta-suave">
                {row.share}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default MeasureTable
