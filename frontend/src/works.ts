import { ApiError } from './api/client'
import { formatDuration } from './dates'
import { applicableMeasure } from './measures'
import { formatQuantity } from './numbers'
import { compareNames, indexTags, tagLineage } from './tags'
import type { Measure, Tag, Task, Work, WorkStatus } from './types'

// Ordem do menu, do filtro e do formulário
export const WORK_STATUSES: WorkStatus[] = [
  'em_andamento',
  'pausado',
  'concluido',
  'abandonado',
]

// "Obra" é feminino: o chip e o campo dizem o estado de uma obra
export const statusLabel: Record<WorkStatus, string> = {
  em_andamento: 'Em andamento',
  pausado: 'Pausada',
  concluido: 'Concluída',
  abandonado: 'Abandonada',
}

// Os chips do filtro falam de um grupo
export const filterLabel: Record<WorkStatus, string> = {
  em_andamento: 'Em andamento',
  pausado: 'Pausadas',
  concluido: 'Concluídas',
  abandonado: 'Abandonadas',
}

// O atalho do menu ⋯ (os 3 outros status)
export const statusAction: Record<WorkStatus, string> = {
  em_andamento: 'Retomar',
  pausado: 'Pausar',
  concluido: 'Concluir',
  abandonado: 'Abandonar',
}

export function registros(count: number) {
  return count === 1 ? '1 registro' : `${count} registros`
}

// "6 de 113 capítulos · 2 registros", "6 capítulos · 2 registros" (sem total),
// "2 registros · 54min" (sem medida). Nem toda sessão anota quantidade: o
// contador vai junto
export function progressLine(work: Work, measure: Measure | undefined) {
  const count = registros(work.records)
  if (work.measureId === null || !measure) {
    return work.records === 0
      ? count
      : `${count} · ${formatDuration(work.seconds * 1000)}`
  }
  const done = work.progress ?? 0
  const amount =
    work.total !== null
      ? `${formatQuantity(done)} de ${formatQuantity(work.total)} ${measure.name}`
      : `${formatQuantity(done)} ${done === 1 ? measure.singular : measure.name}`
  return `${amount} · ${count}`
}

// A decisão vem só do campo do GET (measureCurrent). Falso com medida = a árvore
// mudou depois (a API não deixa gravar outra); falso sem medida = a pessoa
// escolheu "Nenhuma" num caminho que mede: escolha, não mudança, sem marca
export type MeasureMismatch = 'trocada' | 'sem medida' | null

export function measureMismatch(work: Work): MeasureMismatch {
  if (work.measureCurrent) return null
  return work.measureId === null ? 'sem medida' : 'trocada'
}

// A medida do caminho padrão pela regra do formulário (a mesma função que
// preenche a mais próxima): ativa, ou a da obra se ela for a mais próxima
export function pathMeasure(
  path: string[],
  measures: Measure[],
  work?: Work,
): Measure | null {
  const keep = work?.measureCurrent ? (work.measureId ?? undefined) : undefined
  return applicableMeasure(path, measures, keep)
}

export function defaultPath(work: Work, tags: Tag[]): string[] {
  const byId = indexTags(tags)
  const tag = byId.get(work.defaultTagId)
  return tag ? tagLineage(tag, byId).map((t) => t.id) : []
}

// O texto da obra "trocada", na linha (`form` falso) ou no formulário. Só monta
// as palavras: se a conta da tela não achar uma medida diferente da obra (a mais
// próxima arquivada, por exemplo), cai pro texto sem nomes
export function mismatchText(
  work: Work,
  tags: Tag[],
  measures: Measure[],
  form: boolean,
): string | null {
  if (measureMismatch(work) !== 'trocada') return null
  const own = measures.find((m) => m.id === work.measureId)
  const current = pathMeasure(defaultPath(work, tags), measures, work)
  if (!own || !current || current.id === own.id) {
    return 'A medida desta obra não é a do caminho.'
  }
  return form
    ? `Esta obra soma «${own.name}», e a medida deste caminho é «${current.name}». Escolha qual somar.`
    : `Soma «${own.name}»; a medida deste caminho é «${current.name}».`
}

// A decisão de cada marca vem dos campos do GET; depois de arquivar tag ou
// tarefa, quem atualiza é a recarga da lista
export function workMarks(
  work: Work,
  tags: Tag[],
  measures: Measure[],
): string[] {
  const measure = mismatchText(work, tags, measures, false)
  return [
    ...(measure ? [measure] : []),
    ...(work.defaultTagActive ? [] : ['Caminho arquivado.']),
    ...(work.defaultTaskActive ? [] : ['Tarefa arquivada.']),
  ]
}

// O campo Obra dos formulários de registro: em andamento primeiro; as outras
// na ordem do filtro, com o status no nome
export function workGroups(works: Work[]) {
  const byTitle = (a: Work, b: Work) => compareNames(a.title, b.title)
  return {
    inProgress: works.filter((w) => w.status === 'em_andamento').sort(byTitle),
    others: works
      .filter((w) => w.status !== 'em_andamento')
      .sort(
        (a, b) =>
          WORK_STATUSES.indexOf(a.status) - WORK_STATUSES.indexOf(b.status) ||
          byTitle(a, b),
      ),
  }
}

export const workOptionLabel = (work: Work) =>
  work.status === 'em_andamento'
    ? work.title
    : `${work.title} (${statusLabel[work.status].toLowerCase()})`

// A medida do registro sai do caminho (regra do servidor); a obra soma só a
// dela. `measure` é a do campo do formulário. Obra sem medida: nada a dizer
export function workMeasureNote(
  work: Work,
  measure: Measure | null,
  measures: Measure[],
): string | null {
  if (work.measureId === null || measure?.id === work.measureId) return null
  const own = measures.find((m) => m.id === work.measureId)
  if (!own) return null
  return measure
    ? `Esta obra soma «${own.name}»: o que for registrado em «${measure.name}» não entra no progresso dela.`
    : `Este caminho não mede «${own.name}»: este registro não entra no progresso da obra.`
}

// No Registrar a tarefa é a da página (a obra não troca de tarefa): avisa
// quando a padrão da obra é outra
export function defaultTaskLine(
  work: Work,
  taskId: string,
  tasks: Task[],
): string | null {
  if (work.defaultTaskId === taskId) return null
  const task = tasks.find((t) => t.id === work.defaultTaskId)
  return task ? `A tarefa padrão desta obra é «${task.title}».` : null
}

// As frases do servidor sobre obra e link, no texto da tela
export function recordError(message: string): string {
  if (message.startsWith('linkUrl pode ter')) {
    return 'Link: no máximo 2000 caracteres.'
  }
  if (message.startsWith('linkUrl')) return LINK_ERROR
  if (message === 'Obra não encontrada') {
    return 'Esta obra não existe mais. Escolha outra.'
  }
  return message
}

export const TITLE_ERROR = 'Escreva um título.'
export const LINK_ERROR =
  'Link: um endereço que começa com http:// ou https://.'
export const LINK_PATTERN = /^https?:\/\/\S+$/i

export function totalError(allowsDecimal: boolean) {
  return allowsDecimal
    ? 'Total: número maior que zero, com até 2 casas (ex.: 12,5).'
    : 'Total: número inteiro maior que zero.'
}

// A validação da API fala em nome de campo ("url precisa ser…"): na tela, a
// frase do campo. O resto do 400/409 já é frase pra pessoa
export function workError(err: unknown): string {
  if (
    !(err instanceof ApiError) ||
    (err.status !== 400 && err.status !== 409)
  ) {
    return 'Não foi possível salvar. Tente de novo.'
  }
  const message = err.message
  if (message.startsWith('title pode ter')) {
    return 'Título: no máximo 100 caracteres.'
  }
  if (message.startsWith('title')) return TITLE_ERROR
  if (message.startsWith('url')) return LINK_ERROR
  if (message.startsWith('total precisa de uma medida')) {
    return 'Total só com medida: escolha a medida ou apague o total.'
  }
  if (message.startsWith('total')) return 'Total: número maior que zero.'
  return message
}
