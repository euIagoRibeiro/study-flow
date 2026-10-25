import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { getTimeByContext } from '../api/dashboard'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import { ChevronDownIcon } from '../components/icons'
import { formatDuration } from '../dates'
import {
  contains,
  deviceTimeZone,
  periodAt,
  periodFromParams,
  periodLabel,
  shift,
  toParams,
  type PeriodKind,
} from '../painel'
import { quietIconButtonClass, secondaryButtonClass } from '../styles'
import { indexTags } from '../tags'
import type { Tag, TimeByContext } from '../types'

const kindOptions: ChipOption<PeriodKind>[] = [
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
]

function percent(part: number, total: number) {
  const value = (part / total) * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

// Painel: o seletor de período fica no topo, compartilhado; "Tempo" é a
// primeira seção (medidas e treino entram depois como seções irmãs)
function PainelPage(props: { tags: Tag[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = new Date()
  const period = periodFromParams(searchParams, today)
  const isCurrent = contains(period, today)
  const zone = deviceTimeZone()

  // A resposta guarda de qual pedido ela é (key): enquanto a do período da
  // tela não chega, é "carregando". Mudar `attempt` refaz o pedido
  const [attempt, setAttempt] = useState(0)
  const key = `${period.start.toISOString()}|${period.end.toISOString()}|${zone}|${attempt}`
  const [result, setResult] = useState<{
    key: string
    data?: TimeByContext
    failed?: boolean
  } | null>(null)

  // Busca quando o período muda (os dados dependem dele, então não dá pra
  // carregar tudo no início, como o App faz com o resto). A limpeza marca a
  // resposta como velha: trocando de semana rápido, a de uma semana anterior
  // pode chegar depois da nova e não pode sobrescrevê-la
  useEffect(() => {
    let ignore = false
    getTimeByContext(period.start, period.end, zone).then(
      (data) => {
        if (!ignore) setResult({ key, data })
      },
      (error: unknown) => {
        console.error(error)
        if (!ignore) setResult({ key, failed: true })
      },
    )
    return () => {
      ignore = true
    }
    // period.start/end mudam de objeto a cada renderização; a key resume os dois
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Só vale a resposta do período da tela
  const current = result?.key === key ? result : null
  const data = current?.data
  const tagsById = indexTags(props.tags)
  const nameOf = (tagId: string | null) =>
    tagId === null ? '(sem tag)' : (tagsById.get(tagId)?.name ?? 'Tag removida')
  const noun = period.kind === 'mes' ? 'neste mês' : 'nesta semana'

  function go(next: ReturnType<typeof periodAt>) {
    setSearchParams(toParams(next))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <FilterChips
          label="Período"
          options={kindOptions}
          value={period.kind}
          // Trocar semana ↔ mês: no período de hoje, vai pro de hoje; num
          // período passado, pro que contém o começo dele
          onChange={(kind) =>
            go(periodAt(kind, isCurrent ? today : period.start))
          }
        />
        <div
          role="group"
          aria-label="Navegar no período"
          className="flex items-center justify-between gap-2"
        >
          <button
            type="button"
            onClick={() => go(shift(period, -1))}
            aria-label="Período anterior"
            title="Período anterior"
            className={quietIconButtonClass}
          >
            <ChevronDownIcon className="h-5 w-5 rotate-90" />
          </button>
          <p
            aria-live="polite"
            className="min-w-0 text-center font-titulo text-base font-semibold"
          >
            {periodLabel(period, today)}
          </p>
          {/* No período de hoje não há "próximo": o futuro não tem tempo */}
          <button
            type="button"
            onClick={() => go(shift(period, 1))}
            disabled={isCurrent}
            aria-label="Próximo período"
            title="Próximo período"
            className={`${quietIconButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <ChevronDownIcon className="h-5 w-5 -rotate-90" />
          </button>
        </div>
      </div>

      <section aria-label="Tempo" className="flex flex-col gap-3">
        <h2 className="font-titulo text-base font-semibold">Tempo</h2>
        {current === null ? (
          <p className="text-sm text-tinta-suave">Carregando…</p>
        ) : !data ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-alerta/40 bg-alerta/[0.08] px-4 py-4"
          >
            <p className="font-semibold text-alerta">
              Não foi possível carregar o painel.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className={secondaryButtonClass}
            >
              Tentar de novo
            </button>
          </div>
        ) : data.totalSeconds === 0 ? (
          <p className="py-6 text-center text-sm text-tinta-suave">
            Nenhum tempo dedicado {noun}.
          </p>
        ) : (
          <>
            <dl>
              <dt className="text-sm text-tinta-suave">Tempo dedicado</dt>
              <dd className="font-dados text-[2.5rem] leading-tight font-bold tabular-nums">
                {formatDuration(data.totalSeconds * 1000)}
              </dd>
            </dl>
            {data.running.length > 0 && (
              <p className="inline-flex items-start gap-2 rounded-xl bg-andamento/[0.13] px-4 py-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulsa rounded-full bg-andamento" />
                <span>
                  {data.running.length === 1
                    ? `Inclui 1 sessão rodando há ${formatDuration(data.running[0].seconds * 1000)} (${data.running[0].taskTitle}).`
                    : `Inclui ${data.running.length} sessões rodando (${data.running.map((r) => r.taskTitle).join(', ')}).`}
                </span>
              </p>
            )}
            {data.overlap && (
              <p className="font-texto text-meta text-tinta-suave">
                Inclui atividades em paralelo: a soma pode passar das horas do
                relógio.
              </p>
            )}
            <table className="w-full text-left">
              <caption className="sr-only">Tempo dedicado por contexto</caption>
              <thead className="text-meta text-tinta-suave">
                <tr>
                  <th scope="col" className="pb-1 font-normal">
                    Contexto
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    Tempo
                  </th>
                  <th scope="col" className="w-14 pb-1 text-right font-normal">
                    %
                  </th>
                </tr>
              </thead>
              <tbody className="font-dados tabular-nums">
                {data.items.map((item) => (
                  <tr
                    key={item.tagId ?? 'sem'}
                    className="border-t border-linha"
                  >
                    <td className="py-2.5 pr-2 break-words">
                      {nameOf(item.tagId)}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {formatDuration(item.seconds * 1000)}
                    </td>
                    <td className="py-2.5 text-right text-tinta-suave">
                      {percent(item.seconds, data.totalSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  )
}

export default PainelPage
