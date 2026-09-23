import { useEffect, useState } from 'react'

function ElapsedTime(props: { startedAt: string }) {
  // Recalcula a cada segundo — sem isso "agora" só seria lido uma vez
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval) // limpa ao desmontar
  }, [])

  const totalSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(props.startedAt).getTime()) / 1000),
  )
  const pad = (n: number) => String(n).padStart(2, '0')
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return (
    <span>
      {pad(hours)}:{pad(minutes)}:{pad(seconds)}
    </span>
  )
}

export default ElapsedTime
