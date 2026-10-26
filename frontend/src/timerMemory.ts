import type { TagIndex } from './tags'
import type { Phase } from './types'

// O que foi escolhido no painel do cronômetro, só na TELA (sessão do
// navegador): sair e voltar (ou recarregar) não perde. O caminho vale até o
// 1º exercício, que grava ele no servidor; a descrição, até o Finalizar.
// Nada vai pro servidor antes disso (toque acidental não grava lixo, o motivo
// da A3e). Cada parte guarda o que o servidor tinha quando foi escolhida
// (`base`, `descriptionBase`): se o servidor mudou depois, vale o servidor.
// Sessão do navegador indisponível ou com lixo: como se não houvesse memória
export type TimerMemory = {
  base: string // o caminho do servidor (ids separados por "/") na hora
  path: string[]
  phase: Phase | null
  descriptionBase: string | null
  description: string
}

const key = (executionId: string) => `studyflow:cronometro:${executionId}`

export function readTimerMemory(executionId: string): TimerMemory | null {
  try {
    const raw = sessionStorage.getItem(key(executionId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('base' in value) ||
      typeof value.base !== 'string' ||
      !('path' in value) ||
      !Array.isArray(value.path) ||
      !value.path.every((id) => typeof id === 'string') ||
      !('description' in value) ||
      typeof value.description !== 'string'
    ) {
      return null
    }
    return value as TimerMemory
  } catch {
    return null
  }
}

// Caminho guardado que ainda dá pra escolher: começa num contexto, cada tag
// é filha da anterior, e todas existem ativas (escolha nova não aceita
// arquivada, como nos campos)
export function isChoosablePath(path: string[], byId: TagIndex): boolean {
  return path.every((id, i) => {
    const tag = byId.get(id)
    return (
      tag !== undefined &&
      tag.active &&
      (i === 0 ? tag.parentId === null : tag.parentId === path[i - 1])
    )
  })
}

export function writeTimerMemory(executionId: string, memory: TimerMemory) {
  try {
    sessionStorage.setItem(key(executionId), JSON.stringify(memory))
  } catch {
    // sem a sessão do navegador: a escolha vive só enquanto a tela está aberta
  }
}

export function clearTimerMemory(executionId: string) {
  try {
    sessionStorage.removeItem(key(executionId))
  } catch {
    // idem
  }
}
