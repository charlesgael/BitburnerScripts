import React from '@react'

interface LoadingDotProps {
  min?: number
  max?: number
}

export function LoadingDot(props: LoadingDotProps) {
  const {
    min = 1,
    max = 3,
  } = props
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <label>
      {''.padEnd(dots % (max - min + 1) + min, '.')}
    </label>
  )
}
