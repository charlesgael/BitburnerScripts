import type { TraderLogEntry } from './types'

/// TYPES

export interface ClosedRoundTrip {
  symbol: string
  side: 'L' | 'S'
  entryPrice: number
  exitPrice: number
  entryTs: number
  exitTs: number
  returnPct: number
  holdMin: number
  reason: string
}

export interface OpenPosition {
  symbol: string
  side: 'L' | 'S'
  entryPrice: number
  shares: number
  heldMin: number
  strength: number
}

export interface WindowSummary {
  windowIndex: number
  startTs: number
  endTs: number
  startPortfolioValue: number
  endPortfolioValue: number
  returnPct: number
  ratePerMin: number
  buyCount: number
  sellCount: number
  closedRoundTrips: number
  winRatePct: number | null
  meanRawReturnPct: number | null
}

export interface ReturnHistogramBucket {
  label: string
  count: number
}

export interface TraderLogSummary {
  entryCount: number
  spanMin: number
  startTs: number | null
  endTs: number | null
  startPortfolioValue: number | null
  endPortfolioValue: number | null
  returnPct: number | null
  byType: Record<string, number>
  byAction: Record<string, number>
  byReason: Record<string, number>
  halts: { ts: number, type: string, portfolioValue: number }[]
  closedRoundTrips: ClosedRoundTrip[]
  winRatePct: number | null
  meanRawReturnPct: number | null
  medianRawReturnPct: number | null
  minRawReturnPct: number | null
  maxRawReturnPct: number | null
  returnHistogram: ReturnHistogramBucket[]
  meanHoldMin: number | null
  stopLossCount: number
  topGainers: ClosedRoundTrip[]
  topLosers: ClosedRoundTrip[]
  openPositions: OpenPosition[]
}

/// HELPERS

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const v of values)
    counts[v] = (counts[v] ?? 0) + 1
  return counts
}

/**
 * Half-open [min, max) buckets over closed round-trip returns - a mean can
 * look great while hiding that most wins are modest and a couple of huge
 * outlier rides are doing the heavy lifting (or the reverse), which is
 * exactly the ambiguity a single meanRawReturnPct number can't resolve.
 */
const RETURN_HISTOGRAM_BUCKETS: { label: string, min: number, max: number }[] = [
  { label: '<0%', min: -Infinity, max: 0 },
  { label: '0-10%', min: 0, max: 10 },
  { label: '10-25%', min: 10, max: 25 },
  { label: '25-50%', min: 25, max: 50 },
  { label: '50-100%', min: 50, max: 100 },
  { label: '>=100%', min: 100, max: Infinity },
]

function histogramReturns(values: number[]): ReturnHistogramBucket[] {
  return RETURN_HISTOGRAM_BUCKETS.map(b => ({
    label: b.label,
    count: values.filter(v => v >= b.min && v < b.max).length,
  }))
}

/**
 * How many round-trips formatTraderLogSummary lists per gainers/losers
 * table - enough to see whether a fat tail is one freak trade or a real
 * cluster, without dumping the entire closedRoundTrips list.
 */
const TOP_N_ROUND_TRIPS = 5

function topRoundTrips(trips: ClosedRoundTrip[], n: number, direction: 'desc' | 'asc'): ClosedRoundTrip[] {
  // "Losers" only ever means an actual loss - otherwise a mostly-winning
  // run pads the list to n with modest winners mislabeled as losers.
  const pool = direction === 'asc' ? trips.filter(t => t.returnPct < 0) : trips
  return [...pool]
    .sort((a, b) => direction === 'desc' ? b.returnPct - a.returnPct : a.returnPct - b.returnPct)
    .slice(0, n)
}

/// Summary

/**
 * Pairs each buy/buyShort with its later matching sell/sellShort for the
 * same symbol - a position is always fully closed before re-entering (see
 * trader.app.ts's tryExit) - to get realized round-trips, plus whatever's
 * still open at the end of the log.
 */
export function summarizeTraderLog(entries: TraderLogEntry[]): TraderLogSummary {
  if (entries.length === 0) {
    return {
      entryCount: 0,
      spanMin: 0,
      startTs: null,
      endTs: null,
      startPortfolioValue: null,
      endPortfolioValue: null,
      returnPct: null,
      byType: {},
      byAction: {},
      byReason: {},
      halts: [],
      closedRoundTrips: [],
      winRatePct: null,
      meanRawReturnPct: null,
      medianRawReturnPct: null,
      minRawReturnPct: null,
      maxRawReturnPct: null,
      returnHistogram: [],
      meanHoldMin: null,
      stopLossCount: 0,
      topGainers: [],
      topLosers: [],
      openPositions: [],
    }
  }

  const first = entries[0]
  const last = entries[entries.length - 1]

  const trades = entries.filter(e => e.type === 'trade')
  const halts = entries
    .filter(e => e.type === 'halt' || e.type === 'resume')
    .map(e => ({ ts: e.ts, type: e.type, portfolioValue: e.portfolioValue }))

  interface OpenLeg {
    entryPrice: number
    shares: number
    side: 'L' | 'S'
    entryTs: number
    strength: number
  }
  const open = new Map<string, OpenLeg>()
  const closedRoundTrips: ClosedRoundTrip[] = []

  for (const t of trades) {
    if (!t.symbol || !t.action || t.price === undefined)
      continue
    if (t.action === 'buy' || t.action === 'buyShort') {
      open.set(t.symbol, {
        entryPrice: t.price,
        shares: t.shares ?? 0,
        side: t.action === 'buy' ? 'L' : 'S',
        entryTs: t.ts,
        strength: t.signal?.strength ?? 0,
      })
    }
    else {
      const leg = open.get(t.symbol)
      if (!leg)
        continue
      const returnPct = (leg.side === 'L' ? t.price / leg.entryPrice - 1 : leg.entryPrice / t.price - 1) * 100
      closedRoundTrips.push({
        symbol: t.symbol,
        side: leg.side,
        entryPrice: leg.entryPrice,
        exitPrice: t.price,
        entryTs: leg.entryTs,
        exitTs: t.ts,
        returnPct,
        holdMin: (t.ts - leg.entryTs) / 60000,
        reason: t.reason ?? 'unknown',
      })
      open.delete(t.symbol)
    }
  }

  const openPositions: OpenPosition[] = [...open].map(([symbol, leg]) => ({
    symbol,
    side: leg.side,
    entryPrice: leg.entryPrice,
    shares: leg.shares,
    heldMin: (last.ts - leg.entryTs) / 60000,
    strength: leg.strength,
  }))

  return {
    entryCount: entries.length,
    spanMin: (last.ts - first.ts) / 60000,
    startTs: first.ts,
    endTs: last.ts,
    startPortfolioValue: first.portfolioValue,
    endPortfolioValue: last.portfolioValue,
    returnPct: (last.portfolioValue / first.portfolioValue - 1) * 100,
    byType: countBy(entries.map(e => e.type)),
    byAction: countBy(trades.map(t => t.action).filter((a): a is string => a !== undefined)),
    byReason: countBy(trades.map(t => t.reason).filter((r): r is string => r !== undefined)),
    halts,
    closedRoundTrips,
    winRatePct: closedRoundTrips.length > 0
      ? 100 * closedRoundTrips.filter(c => c.returnPct > 0).length / closedRoundTrips.length
      : null,
    meanRawReturnPct: closedRoundTrips.length > 0 ? mean(closedRoundTrips.map(c => c.returnPct)) : null,
    medianRawReturnPct: closedRoundTrips.length > 0 ? median(closedRoundTrips.map(c => c.returnPct)) : null,
    minRawReturnPct: closedRoundTrips.length > 0 ? Math.min(...closedRoundTrips.map(c => c.returnPct)) : null,
    maxRawReturnPct: closedRoundTrips.length > 0 ? Math.max(...closedRoundTrips.map(c => c.returnPct)) : null,
    returnHistogram: closedRoundTrips.length > 0 ? histogramReturns(closedRoundTrips.map(c => c.returnPct)) : [],
    meanHoldMin: closedRoundTrips.length > 0 ? mean(closedRoundTrips.map(c => c.holdMin)) : null,
    stopLossCount: closedRoundTrips.filter(c => c.reason === 'stop-loss').length,
    topGainers: topRoundTrips(closedRoundTrips, TOP_N_ROUND_TRIPS, 'desc'),
    topLosers: topRoundTrips(closedRoundTrips, TOP_N_ROUND_TRIPS, 'asc'),
    openPositions,
  }
}

/**
 * Buckets entries into fixed-size time windows (default 30 min) and reports
 * portfolioValue growth per window, so a slowdown (or acceleration) shows
 * up directly instead of needing to eyeball two separate cumulative
 * checkpoints against each other - the return% and win rate for a whole
 * run can look fine while masking a big change partway through (this is
 * exactly what surfaced comparing this project's own 1h vs 3h trader-log
 * checkpoints: +42.7% in the first 89 min, only +4.7% in the next 118).
 *
 * Each window's start value/time is carried forward from the previous
 * window's actual last entry (not an idealized window boundary), so a
 * window with no entries (e.g. the daemon was down) just carries forward
 * unchanged instead of producing a divide-by-zero or a misleading value,
 * and the final, likely-partial window still gets an accurate per-minute
 * rate rather than being diluted by the nominal window size.
 */
export function summarizeTraderLogByWindow(entries: TraderLogEntry[], windowMin = 30): WindowSummary[] {
  if (entries.length === 0)
    return []

  const firstTs = entries[0].ts
  const windowMs = windowMin * 60000

  const buckets = new Map<number, TraderLogEntry[]>()
  for (const e of entries) {
    const idx = Math.floor((e.ts - firstTs) / windowMs)
    const bucket = buckets.get(idx)
    if (bucket)
      bucket.push(e)
    else
      buckets.set(idx, [e])
  }

  // Closed round-trips grouped by the bucket their EXIT falls into - same
  // open/close pairing as summarizeTraderLog, just keyed by window instead
  // of kept as one flat list.
  const trades = entries.filter(e => e.type === 'trade')
  interface OpenLeg { entryPrice: number, side: 'L' | 'S' }
  const open = new Map<string, OpenLeg>()
  const closedReturnsByBucket = new Map<number, number[]>()
  for (const t of trades) {
    if (!t.symbol || !t.action || t.price === undefined)
      continue
    if (t.action === 'buy' || t.action === 'buyShort') {
      open.set(t.symbol, { entryPrice: t.price, side: t.action === 'buy' ? 'L' : 'S' })
    }
    else {
      const leg = open.get(t.symbol)
      if (!leg)
        continue
      const returnPct = (leg.side === 'L' ? t.price / leg.entryPrice - 1 : leg.entryPrice / t.price - 1) * 100
      const idx = Math.floor((t.ts - firstTs) / windowMs)
      const list = closedReturnsByBucket.get(idx)
      if (list)
        list.push(returnPct)
      else
        closedReturnsByBucket.set(idx, [returnPct])
      open.delete(t.symbol)
    }
  }

  const maxIdx = Math.max(...buckets.keys())
  const windows: WindowSummary[] = []
  let carryValue = entries[0].portfolioValue
  let carryTs = firstTs

  for (let idx = 0; idx <= maxIdx; idx++) {
    const windowEntries = buckets.get(idx)

    if (!windowEntries) {
      windows.push({
        windowIndex: idx,
        startTs: carryTs,
        endTs: carryTs,
        startPortfolioValue: carryValue,
        endPortfolioValue: carryValue,
        returnPct: 0,
        ratePerMin: 0,
        buyCount: 0,
        sellCount: 0,
        closedRoundTrips: 0,
        winRatePct: null,
        meanRawReturnPct: null,
      })
      continue
    }

    const startTs = carryTs
    const startValue = carryValue
    const endEntry = windowEntries[windowEntries.length - 1]
    const endTs = endEntry.ts
    const endValue = endEntry.portfolioValue
    const elapsedMin = Math.max((endTs - startTs) / 60000, 1 / 60)
    const returnPct = (endValue / startValue - 1) * 100
    const closes = closedReturnsByBucket.get(idx) ?? []

    windows.push({
      windowIndex: idx,
      startTs,
      endTs,
      startPortfolioValue: startValue,
      endPortfolioValue: endValue,
      returnPct,
      ratePerMin: returnPct / elapsedMin,
      buyCount: windowEntries.filter(e => e.type === 'trade' && (e.action === 'buy' || e.action === 'buyShort')).length,
      sellCount: windowEntries.filter(e => e.type === 'trade' && (e.action === 'sell' || e.action === 'sellShort')).length,
      closedRoundTrips: closes.length,
      winRatePct: closes.length > 0 ? 100 * closes.filter(r => r > 0).length / closes.length : null,
      meanRawReturnPct: closes.length > 0 ? mean(closes) : null,
    })

    carryValue = endValue
    carryTs = endTs
  }

  return windows
}

/// Formatting

function formatRoundTrip(t: ClosedRoundTrip): string {
  return `${t.symbol} (${t.side}): ${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(2)}% `
    + `(entry ${t.entryPrice.toFixed(2)} @ ${new Date(t.entryTs).toLocaleTimeString()} `
    + `-> exit ${t.exitPrice.toFixed(2)} @ ${new Date(t.exitTs).toLocaleTimeString()}), `
    + `held ${t.holdMin.toFixed(1)} min, reason ${t.reason}`
}

/**
 * Plain text lines, one summary per array entry - environment-agnostic
 * (no ns.tprint/console.log inside) so both trader-log-summary.app.ts
 * (ns.tprint per line) and test-trader-log.tmp.ts (console.log per line)
 * render the exact same summary instead of maintaining two formatters.
 */
export function formatTraderLogSummary(summary: TraderLogSummary): string[] {
  if (summary.entryCount === 0)
    return ['No entries in log.']

  const lines: string[] = []
  lines.push(`Entries: ${summary.entryCount}`)
  lines.push(
    `Span: ${summary.spanMin.toFixed(1)} min `
    + `(${new Date(summary.startTs!).toLocaleString()} -> ${new Date(summary.endTs!).toLocaleString()})`,
  )
  lines.push(
    `Portfolio: ${summary.startPortfolioValue!.toFixed(0)} -> ${summary.endPortfolioValue!.toFixed(0)} `
    + `(${summary.returnPct!.toFixed(2)}%)`,
  )
  lines.push(`By type: ${JSON.stringify(summary.byType)}`)
  lines.push(`By action: ${JSON.stringify(summary.byAction)}`)
  lines.push(`By reason: ${JSON.stringify(summary.byReason)}`)

  if (summary.halts.length > 0) {
    lines.push(`Halt/resume events (${summary.halts.length}):`)
    for (const h of summary.halts)
      lines.push(`  ${new Date(h.ts).toLocaleTimeString()} ${h.type} portfolioValue=${h.portfolioValue.toFixed(0)}`)
  }

  if (summary.closedRoundTrips.length > 0) {
    lines.push(
      `Closed round-trips: ${summary.closedRoundTrips.length} `
      + `(win rate ${summary.winRatePct!.toFixed(1)}%, `
      + `mean raw return ${summary.meanRawReturnPct!.toFixed(2)}%, `
      + `mean hold ${summary.meanHoldMin!.toFixed(1)} min, `
      + `${summary.stopLossCount} stop-loss exit(s))`,
    )
    lines.push(
      `Return distribution: median ${summary.medianRawReturnPct!.toFixed(2)}%, `
      + `min ${summary.minRawReturnPct!.toFixed(2)}%, max ${summary.maxRawReturnPct!.toFixed(2)}% `
      + `(a mean far above the median means a few outlier rides are doing most of the work)`,
    )
    lines.push(`Histogram: ${summary.returnHistogram.map(b => `${b.label}=${b.count}`).join(' ')}`)
    lines.push('Note: "raw return" is entry/exit price only - excludes spread/commission/impact, which portfolioValue above already accounts for.')

    if (summary.topGainers.length > 0) {
      lines.push(`Top ${summary.topGainers.length} gainer(s):`)
      for (const t of summary.topGainers)
        lines.push(`  ${formatRoundTrip(t)}`)
    }
    if (summary.topLosers.length > 0) {
      lines.push(`Top ${summary.topLosers.length} loser(s):`)
      for (const t of summary.topLosers)
        lines.push(`  ${formatRoundTrip(t)}`)
    }
  }

  if (summary.openPositions.length > 0) {
    lines.push(`Still open at end of log (${summary.openPositions.length}):`)
    for (const p of summary.openPositions) {
      lines.push(
        `  ${p.symbol} (${p.side}): entered @${p.entryPrice.toFixed(2)}, ${p.shares} shares, `
        + `held ${p.heldMin.toFixed(1)} min, entry strength ${p.strength.toFixed(3)}`,
      )
    }
  }

  return lines
}

/**
 * Same environment-agnostic plain-text-lines shape as
 * formatTraderLogSummary, one line per window from
 * summarizeTraderLogByWindow - so a slowdown/acceleration partway through a
 * run is visible directly instead of needing two cumulative checkpoints
 * compared by hand.
 */
export function formatTraderLogSummaryByWindow(windows: WindowSummary[], windowMin: number): string[] {
  if (windows.length === 0)
    return [`No entries to bucket into ${windowMin}-min windows.`]

  const lines: string[] = [`Growth by ${windowMin}-min window:`]
  for (const w of windows) {
    const range = `${new Date(w.startTs).toLocaleTimeString()}-${new Date(w.endTs).toLocaleTimeString()}`
    const trend = `${w.startPortfolioValue.toFixed(0)} -> ${w.endPortfolioValue.toFixed(0)} (${w.returnPct >= 0 ? '+' : ''}${w.returnPct.toFixed(2)}%, ${w.ratePerMin >= 0 ? '+' : ''}${w.ratePerMin.toFixed(3)}%/min)`
    const activity = w.buyCount + w.sellCount === 0
      ? 'no trades'
      : `buys=${w.buyCount} sells=${w.sellCount} closed=${w.closedRoundTrips}${
        w.winRatePct !== null ? ` winRate=${w.winRatePct.toFixed(0)}% meanReturn=${w.meanRawReturnPct!.toFixed(1)}%` : ''}`
    lines.push(`  [${range}] ${trend} - ${activity}`)
  }
  return lines
}
