import { useEffect, useState } from 'react'

// Busca marcada com a chave do pedido: resposta velha (de outro período, ou
// que chegou depois da nova) é descartada pela limpeza e pela chave
export function useFetched<T>(key: string | null, load: () => Promise<T>) {
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
