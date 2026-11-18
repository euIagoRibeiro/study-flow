import { useState } from 'react'
import { getMeasureTotals } from '../api/dashboard'
import { formatQuantity } from '../numbers'
import { measureRows, periodNoun, recordsLabel, type Period } from '../painel'
import { secondaryButtonClass } from '../styles'
import { useFetched } from '../useFetched'
import MeasureTable from './MeasureTable'

// Painel, medidas: o que foi registrado nos registros concluídos do período (a data é a do
// registro). Seção irmã do Tempo, com carregamento, erro e "Tentar de novo" próprios. Só o
// período vale aqui: o contexto aberto no Tempo (?contexto=) e as tags escolhidas não mudam
// esta seção (a medida por matéria é a MA2)
function MeasuresSection(props: { period: Period; zone: string }) {
  const { period, zone } = props
  const [attempt, setAttempt] = useState(0)
  const measures = useFetched(
    `${period.start.toISOString()}|${period.end.toISOString()}|${zone}|${attempt}`,
    () => getMeasureTotals(period.start, period.end, zone),
  )

  return (
    <section aria-label="Medidas" className="flex flex-col gap-3">
      <h2 className="font-titulo text-base font-semibold">Medidas</h2>
      {measures === null ? (
        <p className="text-sm text-tinta-suave">Carregando…</p>
      ) : !measures.data ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-alerta/40 bg-alerta/[0.08] px-4 py-4"
        >
          <p className="font-semibold text-alerta">
            Não foi possível carregar as medidas.
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={secondaryButtonClass}
          >
            Tentar de novo
          </button>
        </div>
      ) : measures.data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-suave">
          Nenhuma medida registrada {periodNoun[period.kind]}.
        </p>
      ) : (
        <div data-measure-list className="flex flex-col gap-5">
          {measures.data.items.map((item) => {
            const rows = measureRows(item)
            return (
              <div key={item.key} className="flex flex-col gap-1.5">
                <h3 className="font-titulo text-base font-semibold break-words">
                  {item.name}
                </h3>
                <p className="font-dados text-lg font-bold tabular-nums wrap-anywhere">
                  {formatQuantity(item.total)}{' '}
                  {item.total === 1 ? item.singular : item.name}
                </p>
                <p className="font-dados text-meta text-tinta-suave tabular-nums">
                  {recordsLabel(item.executions)}
                </p>
                {rows.length > 0 && (
                  <MeasureTable
                    caption={`Quantidade por tipo em ${item.name}`}
                    rows={rows}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default MeasuresSection
