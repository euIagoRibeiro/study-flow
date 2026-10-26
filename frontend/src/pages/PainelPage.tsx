import { useState } from 'react'
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
import TagCompare from '../components/TagCompare'
import TimeTable from '../components/TimeTable'
import { formatDuration } from '../dates'
import {
  barLabel,
  barsBy,
  categoryAt,
  comparisonFor,
  comparisonLabel,
  contains,
  daysCounted,
  deviceTimeZone,
  formatDiff,
  chosenTagIds,
  monthName,
  periodAt,
  periodFromParams,
  periodLabel,
  periodNoun,
  shift,
  toParams,
  toSlices,
  withPrevious,
  type Comparison,
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
import { useFetched } from '../useFetched'

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

type TagTime = { tagId: string | null; seconds: number }
type PhaseTime = { phase: Phase | null; seconds: number }
type Overview = {
  context: TimeByContext
  period: { start: string; seconds: number }[] | null // null = dia, sem barras
  comparison: Comparison
  previous: { totalSeconds: number; items: TagTime[] }
}
type Detail = {
  subtags: TagTime[]
  phases: PhaseTime[] | null // null = contexto sem fases
  previous: { subtags: TagTime[]; phases: PhaseTime[] }
}
// O anterior sem pedido: "até" no começo dele (agora = meia-noite exata)
const NOTHING = { totalSeconds: 0, items: [] }

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

  // O anterior vem na mesma busca: período e comparação chegam juntos
  const overview = useFetched<Overview>(base, async () => {
    const by = barsBy[period.kind]
    const comparison = comparisonFor(period, new Date())
    const prev = comparison.previous
    const [context, byPeriod, previous] = await Promise.all([
      getTimeByContext(period.start, period.end, zone),
      by ? getTimeByPeriod(period.start, period.end, zone, by) : null,
      comparison.until > prev.start
        ? getTimeByContext(prev.start, comparison.until, zone)
        : NOTHING,
    ])
    return {
      context,
      period: byPeriod?.items ?? null,
      comparison,
      previous,
    }
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
      const { previous: prev, until } = comparisonFor(period, new Date())
      const asked = until > prev.start
      const [subtags, phases, prevSubtags, prevPhases] = await Promise.all([
        getTimeBySubtag(period.start, period.end, zone, contextTag.id),
        contextTag.tracksPhase
          ? getTimeByPhase(period.start, period.end, zone, contextTag.id)
          : null,
        asked
          ? getTimeBySubtag(prev.start, until, zone, contextTag.id)
          : NOTHING,
        contextTag.tracksPhase && asked
          ? getTimeByPhase(prev.start, until, zone, contextTag.id)
          : NOTHING,
      ])
      return {
        subtags: subtags.items,
        phases: phases?.items ?? null,
        previous: { subtags: prevSubtags.items, phases: prevPhases.items },
      }
    },
  )

  const data = overview?.data
  const nameOf = (tagId: string | null, none: string) =>
    tagId === null ? none : (tagsById.get(tagId)?.name ?? 'Tag removida')
  const noun = periodNoun[period.kind]
  const days = daysCounted(period, today)
  const totalDiff = data
    ? formatDiff(data.context.totalSeconds, data.previous.totalSeconds)
    : null
  // "vs. semana passada, até seg., 15h32: +3h00 (+8%)"
  const comparisonLine = data && totalDiff && (
    <p className="text-sm">
      <span className="text-tinta-suave">
        {comparisonLabel(period.kind, data.comparison)}:
      </span>{' '}
      <span className="font-dados tabular-nums">
        {totalDiff.percent
          ? `${totalDiff.text} ${totalDiff.percent}`
          : totalDiff.text}
      </span>
    </p>
  )

  // Tags escolhidas pra comparar (?tags=), só as que existem, até 5
  const chosen = chosenTagIds(searchParams.get('tags'), tagsById)

  // A URL do Painel: período + contexto aberto + tags escolhidas
  function navigate(
    next: Period,
    contexto: string | undefined,
    tags: string[] = chosen,
  ) {
    setSearchParams({
      ...toParams(next),
      ...(contexto ? { contexto } : {}),
      ...(tags.length > 0 ? { tags: tags.join(',') } : {}),
    })
  }

  // Trocar de período mantém o contexto aberto e as tags escolhidas
  function go(next: Period, contexto = contextTag?.id) {
    navigate(next, contexto)
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
          <>
            <p className="py-6 text-center text-sm text-tinta-suave">
              Nenhum tempo dedicado {noun}.
            </p>
            {data.previous.totalSeconds > 0 && comparisonLine}
          </>
        ) : (
          <>
            <dl>
              <dt className="text-sm text-tinta-suave">Tempo dedicado</dt>
              <dd className="font-dados text-[2.5rem] leading-tight font-bold tabular-nums">
                {formatDuration(data.context.totalSeconds * 1000)}
              </dd>
            </dl>
            {/* No dia, a média seria o próprio total */}
            {period.kind !== 'dia' && (
              <p className="-mt-2 font-dados text-sm text-tinta-suave tabular-nums">
                {formatDuration((data.context.totalSeconds / days) * 1000)}/dia
                · {days} {days === 1 ? 'dia' : 'dias'}
              </p>
            )}
            {comparisonLine}
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
              compare
              // Só no anterior: no fim, sem bolinha (não tem fatia)
              rows={withPrevious(
                data.context.items,
                data.previous.items,
                (item) => item.tagId ?? 'sem',
              ).map((row, i) => ({
                key: row.item.tagId ?? 'sem',
                name: nameOf(row.item.tagId, '(sem tag)'),
                seconds: row.seconds,
                previous: row.previous,
                dot: row.seconds > 0 ? categoryAt(i).dot : undefined,
                onOpen: row.item.tagId
                  ? () => go(period, row.item.tagId ?? undefined)
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
                    onClick={() => navigate(period, undefined)}
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
                      compare
                      rows={withPrevious(
                        detail.data.subtags,
                        detail.data.previous.subtags,
                        (item) => item.tagId ?? 'sem',
                      ).map((row, i) => ({
                        key: row.item.tagId ?? 'sem',
                        name: nameOf(row.item.tagId, '(sem subtag)'),
                        seconds: row.seconds,
                        previous: row.previous,
                        dot: row.seconds > 0 ? categoryAt(i).dot : undefined,
                      }))}
                    />
                    {detail.data.phases && detail.data.phases.length > 0 && (
                      <TimeTable
                        caption={`Tempo dedicado por fase em ${contextTag.name}`}
                        head="Fase"
                        compare
                        rows={withPrevious(
                          detail.data.phases,
                          detail.data.previous.phases,
                          (item) => item.phase ?? 'sem',
                        ).map((row) => ({
                          key: row.item.phase ?? 'sem',
                          name:
                            row.item.phase === null
                              ? '(sem fase)'
                              : phaseLabels[row.item.phase],
                          seconds: row.seconds,
                          previous: row.previous,
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

      <TagCompare
        tags={props.tags}
        period={period}
        zone={zone}
        chosen={chosen}
        onChange={(tags) => navigate(period, contextTag?.id, tags)}
      />
    </div>
  )
}

export default PainelPage
