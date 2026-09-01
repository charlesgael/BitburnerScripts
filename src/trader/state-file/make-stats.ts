import type { TraderLogEntry } from './types'

/// TYPES

export interface ClosedRoundTrip {
  symbol: string
  side: 'L' | 'S'
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
  meanHoldMin: number | null
  stopLossCount: number
  openPositions: OpenPosition[]
}

/// HELPERS

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const v of values)
    counts[v] = (counts[v] ?? 0) + 1
  return counts
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
      meanHoldMin: null,
      stopLossCount: 0,
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
    meanHoldMin: closedRoundTrips.length > 0 ? mean(closedRoundTrips.map(c => c.holdMin)) : null,
    stopLossCount: closedRoundTrips.filter(c => c.reason === 'stop-loss').length,
    openPositions,
  }
}

/// Formatting

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
    lines.push('Note: "raw return" is entry/exit price only - excludes spread/commission/impact, which portfolioValue above already accounts for.')
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
