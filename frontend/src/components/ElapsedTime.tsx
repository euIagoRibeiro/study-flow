import { useEffect, useState } from 'react'
import { formatClock } from '../dates'

function ElapsedTime(props: { startedAt: string }) {
  // Recalcula a cada segundo — sem isso "agora" só seria lido uma vez
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval) // limpa ao desmontar
  }, [])

  return (
    <span>
      {formatClock(now.getTime() - new Date(props.startedAt).getTime())}
    </span>
  )
}

export default ElapsedTime
