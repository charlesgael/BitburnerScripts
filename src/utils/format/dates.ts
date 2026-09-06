/**
 * Formats a duration as `"XhYm"`/`"XmYs"`/`"Xs"`, dropping whichever leading
 * units are zero. Returns `'—'` for a negative or non-finite input rather
 * than throwing.
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0)
    return '—'
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0)
    return `${h}h ${m}m`
  if (m > 0)
    return `${m}m ${sec}s`
  return `${sec}s`
}

/** Formats `ts` as a short 24-hour clock time (`"HH:MM"`), locale `en-US`. */
export function formatHour(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(new Date(ts))
}

/** Formats `ts` as a 24-hour clock time with seconds (`"HH:MM:SS"`), locale `en-US`. */
export function formatMediumHour(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(new Date(ts))
}
