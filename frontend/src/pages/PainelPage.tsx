import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  getTimeByContext,
  getTimeByPeriod,
  getTimeByPhase,
  getTimeBySubtag,
} from '../api/dashboard'
import BarChart from '../components/BarChart'
import FilterChips, { type ChipOption } from '../components/FilterChips'
import { ChevronDownIcon } from '../components/icons'
import PieChart from '../components/PieChart'
import { formatDuration } from '../dates'
import {
  barLabel,
  barsBy,
  categoryAt,
  contains,
  deviceTimeZone,
  monthName,
  percent,
  periodAt,
  periodFromParams,
  periodLabel,
  periodNoun,
  shift,
  toParams,
  toSlices,
  type Period,
  type PeriodKind,
} from '../painel'
import { phaseLabels } from '../phases'
import {
  quietIconButtonClass,
  secondaryButtonClass,
  textButtonClass,
} from '../styles'
import { indexTags } from '../tags'
import type { Phase, Tag, TimeByContext } from '../types'

const kindOptions: ChipOption<PeriodKind>[] = [
  { value: 'dia', label: 'Dia' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
  { value: 'ano', label: 'Ano' },
]

// O dia não tem barras (barsBy.dia = null)
const barsTitle = {
  dia: '',
  semana: 'Por dia',
  mes: 'Por semana',
  ano: 'Por mês',
}

type Overview = {
  context: TimeByContext
  period: { start: string; seconds: number }[] | null // null = dia, sem barras
}
type Detail = {
  subtags: { tagId: string | null; seconds: number }[]
  phases: { phase: Phase | null; seconds: number }[] | null // null = contexto sem fases
}
type Row = {
  key: string
  name: string
  seconds: number
  dot?: string // classe da cor (legenda); sem ela, linha sem bolinha
  onOpen?: () => void // contexto: abre o detalhe
}

// Tabela = os números exatos e a legenda dos gráficos (bolinha da cor)
function TimeTable(props: { caption: string; head: string; rows: Row[] }) {
  const total = props.rows.reduce((sum, row) => sum + row.seconds, 0)
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
          <th scope="col" className="w-14 pb-1 text-right font-normal">
            %
          </th>
        </tr>
      </thead>
      <tbody className="font-dados tabular-nums">
        {props.rows.map((row) => (
          <tr key={row.key} className="border-t border-linha">
            <td className="py-1 pr-2 break-words">
              <span className="flex min-h-9 items-center gap-2">
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
                    className={`text-left underline decoration-dotted underline-offset-2 ${textButtonClass}`}
                  >
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </span>
            </td>
            <td className="py-1 text-right whitespace-nowrap">
              {formatDuration(row.seconds * 1000)}
            </td>
            <td className="py-1 text-right text-tinta-suave">
              {percent(row.seconds, total)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Busca marcada com a chave do pedido: resposta velha (de outro período, ou
// que chegou depois da nova) é descartada pela limpeza e pela chave
function useFetched<T>(key: string | null, load: () => Promise<T>) {
  const [result, setResult] = useState<{
    key: string
    data?: T
    failed?: boolean
  } | null>(null)
  useEffect(() => {
    if (key === null) return
    let ignore = false
    load().then(
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
    // `load` é uma função nova a cada renderização; a key resume o pedido
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return result?.key === key ? result : null
}

// Painel: o seletor de período fica no topo, compartilhado; "Tempo" é a
// primeira seção (medidas e treino entram depois como seções irmãs)
function PainelPage(props: { tags: Tag[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = new Date()
  const period = periodFromParams(searchParams, today)
  const isCurrent = contains(period, today)
  const zone = deviceTimeZone()
  const tagsById = indexTags(props.tags)
  const [attempt, setAttempt] = useState(0)
  const base = `${period.start.toISOString()}|${period.end.toISOString()}|${zone}|${attempt}`

  const overview = useFetched<Overview>(base, async () => {
    const by = barsBy[period.kind]
    const [context, byPeriod] = await Promise.all([
      getTimeByContext(period.start, period.end, zone),
      by ? getTimeByPeriod(period.start, period.end, zone, by) : null,
    ])
    return { context, period: byPeriod?.items ?? null }
  })

  // Detalhe de um contexto (?contexto=), na mesma página: só raiz que existe
  const contextId = searchParams.get('contexto')
  const contextTag =
    contextId && tagsById.get(contextId)?.level === 1
      ? tagsById.get(contextId)
      : undefined
  const detail = useFetched<Detail>(
    contextTag ? `${base}|${contextTag.id}` : null,
    async () => {
      if (!contextTag) throw new Error('sem contexto')
      const [subtags, phases] = await Promise.all([
        getTimeBySubtag(period.start, period.end, zone, contextTag.id),
        contextTag.tracksPhase
          ? getTimeByPhase(period.start, period.end, zone, contextTag.id)
          : Promise.resolve(null),
      ])
      return { subtags: subtags.items, phases: phases?.items ?? null }
    },
  )

  const data = overview?.data
  const nameOf = (tagId: string | null, none: string) =>
    tagId === null ? none : (tagsById.get(tagId)?.name ?? 'Tag removida')
  const noun = periodNoun[period.kind]

  // Trocar de período mantém o contexto aberto
  function go(next: Period, contexto = contextTag?.id) {
    setSearchParams({ ...toParams(next), ...(contexto ? { contexto } : {}) })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <FilterChips
          label="Período"
          options={kindOptions}
          value={period.kind}
          // Trocar o tipo: no período de hoje, vai pro de hoje; num período
          // passado, pro que contém o começo dele
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
        {overview === null ? (
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
        ) : data.context.totalSeconds === 0 ? (
          <p className="py-6 text-center text-sm text-tinta-suave">
            Nenhum tempo dedicado {noun}.
          </p>
        ) : (
          <>
            <dl>
              <dt className="text-sm text-tinta-suave">Tempo dedicado</dt>
              <dd className="font-dados text-[2.5rem] leading-tight font-bold tabular-nums">
                {formatDuration(data.context.totalSeconds * 1000)}
              </dd>
            </dl>
            {data.context.running.length > 0 && (
              <p className="inline-flex items-start gap-2 rounded-xl bg-andamento/[0.13] px-4 py-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulsa rounded-full bg-andamento" />
                <span>
                  {data.context.running.length === 1
                    ? `Inclui 1 sessão rodando há ${formatDuration(data.context.running[0].seconds * 1000)} (${data.context.running[0].taskTitle}).`
                    : `Inclui ${data.context.running.length} sessões rodando (${data.context.running.map((r) => r.taskTitle).join(', ')}).`}
                </span>
              </p>
            )}
            {data.context.overlap && (
              <p className="font-texto text-meta text-tinta-suave">
                Inclui atividades em paralelo: a soma pode passar das horas do
                relógio.
              </p>
            )}
            <PieChart
              label="Pizza do tempo por contexto (os números estão na tabela abaixo)"
              slices={toSlices(data.context.items)}
            />
            <TimeTable
              caption="Tempo dedicado por contexto"
              head="Contexto"
              rows={data.context.items.map((item, i) => ({
                key: item.tagId ?? 'sem',
                name: nameOf(item.tagId, '(sem tag)'),
                seconds: item.seconds,
                dot: categoryAt(i).dot,
                onOpen: item.tagId
                  ? () => go(period, item.tagId ?? undefined)
                  : undefined,
              }))}
            />

            {contextTag && (
              <section
                aria-label={`Em ${contextTag.name}`}
                className="flex flex-col gap-3 rounded-[14px] border border-linha bg-superficie px-4 py-3.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 font-titulo text-base font-semibold break-words">
                    Em {contextTag.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSearchParams(toParams(period))}
                    className={`shrink-0 text-sm text-tinta-suave ${textButtonClass}`}
                  >
                    Fechar
                  </button>
                </div>
                {detail === null ? (
                  <p className="text-sm text-tinta-suave">Carregando…</p>
                ) : !detail.data ? (
                  <p role="alert" className="text-sm font-semibold text-alerta">
                    Não foi possível carregar {contextTag.name}.
                  </p>
                ) : detail.data.subtags.length === 0 ? (
                  <p className="text-sm text-tinta-suave">
                    Nenhum tempo em {contextTag.name} {noun}.
                  </p>
                ) : (
                  <>
                    <PieChart
                      label={`Pizza do tempo por subtag em ${contextTag.name} (os números estão na tabela abaixo)`}
                      slices={toSlices(detail.data.subtags)}
                    />
                    <TimeTable
                      caption={`Tempo dedicado por subtag em ${contextTag.name}`}
                      head="Subtag"
                      rows={detail.data.subtags.map((item, i) => ({
                        key: item.tagId ?? 'sem',
                        name: nameOf(item.tagId, '(sem subtag)'),
                        seconds: item.seconds,
                        dot: categoryAt(i).dot,
                      }))}
                    />
                    {detail.data.phases && detail.data.phases.length > 0 && (
                      <TimeTable
                        caption={`Tempo dedicado por fase em ${contextTag.name}`}
                        head="Fase"
                        rows={detail.data.phases.map((item) => ({
                          key: item.phase ?? 'sem',
                          name:
                            item.phase === null
                              ? '(sem fase)'
                              : phaseLabels[item.phase],
                          seconds: item.seconds,
                        }))}
                      />
                    )}
                  </>
                )}
              </section>
            )}

            {data.period && (
              <>
                <h3 className="mt-2 font-titulo text-base font-semibold">
                  {barsTitle[period.kind]}
                </h3>
                {/* No ano, 12 barras: sem o valor em cima, a tabela dá o número */}
                <BarChart
                  label={`Barras do tempo ${barsTitle[period.kind].toLowerCase()} (${period.kind === 'ano' ? 'os números estão na tabela abaixo' : 'o valor está escrito em cima de cada barra'})`}
                  hideValues={period.kind === 'ano'}
                  bars={data.period.map((item, i) => ({
                    value: item.seconds,
                    valueLabel: formatDuration(item.seconds * 1000),
                    label: barLabel(period.kind, item.start, i),
                  }))}
                />
                {period.kind === 'ano' && (
                  <TimeTable
                    caption="Tempo dedicado por mês"
                    head="Mês"
                    rows={data.period.map((item) => ({
                      key: item.start,
                      name: monthName(item.start),
                      seconds: item.seconds,
                    }))}
                  />
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  )
}

export default PainelPage
