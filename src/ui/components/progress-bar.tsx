import React from '@react'

export function ProgressBar({
  progress,
  max,
  guard,
}: {
  progress: number
  max: number
  guard?: number
}) {
  const pct = React.useMemo(() => Math.max(0, Math.min(progress, max)) / max * 100, [progress, max])
  const guardPct = React.useMemo(() => guard ? Math.max(0, Math.min(guard, max)) / max * 100 : null, [guard, max])

  return (
    <div className="bb-progress bb-progress--thin">
      <div
        className={`bb-progress-fill${pct > 90 ? ' bb-progress-fill--danger' : ''}`}
        style={{ width: `${pct}%` }}
      />
      {guardPct ? <div className="bb-progress-guard" style={{ width: `${guardPct}%` }} /> : null}
    </div>
  )
}
