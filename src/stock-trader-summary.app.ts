import type { NS } from '@ns'
import { parseTraderLog, TRADER_LOG_FILE } from './lib/trader/state-file'
import {
  formatTraderLogSummary,
  formatTraderLogSummaryByWindow,
  summarizeTraderLog,
  summarizeTraderLogByWindow,
} from './lib/trader/state-file/make-stats'
import { arg, parseArgs } from './utils/args'
import { formatMoney } from './utils/format/game'

/**
 * One-shot: prints a compact summary of log/trader-log.txt straight to the
 * terminal, instead of downloading the (potentially large, thousands-of-
 * lines) raw log to read it externally. Safe to re-run any time - nothing
 * needs to keep running afterward, same as assets.app.ts.
 *
 * ns.read is 0 GB, so this costs essentially nothing to run.
 */
export async function main(ns: NS) {
  ns.disableLog('ALL')

  const flags = parseArgs(ns, [
    arg('window', 30, 'Window size in minutes for the growth-by-window breakdown', 'w'),
  ])
  const windowMin = Number(flags.window) || 30
  ns.ui.openTail(ns.pid)
  ns.ui.resizeTail(1600, 800)

  const raw = ns.read(TRADER_LOG_FILE)
  if (!raw) {
    ns.print(`No log found at ${TRADER_LOG_FILE} - has trader.app.js been run yet?`)
    return
  }

  const entries = parseTraderLog(raw)
  const summary = summarizeTraderLog(entries)
  for (const line of formatTraderLogSummary(summary))
    ns.print(line)
  for (const line of formatTraderLogSummaryByWindow(summarizeTraderLogByWindow(entries, windowMin), windowMin))
    ns.print(line)

  // Live-only addition: formatTraderLogSummary's own P&L line stops at
  // realized (closed) trades, since a static log parser has no way to know
  // a still-open position's current market value. This script does have
  // live ns.stock access, so it can mark every open position to market and
  // report one combined score - the actual net contribution of this
  // strategy alone, realized and unrealized together, isolated from
  // whatever else is happening in this life (see make-stats.ts's own
  // comment on why portfolioValue can't be used for that).
  if (summary.openPositions.length > 0) {
    let unrealizedPnl = 0
    ns.print('Open positions marked to market:')
    for (const p of summary.openPositions) {
      const currentValue = ns.stock.getSaleGain(p.symbol, p.shares, p.side)
      const pnl = currentValue - p.costBasis
      unrealizedPnl += pnl
      ns.print(`  ${p.symbol} (${p.side}): cost ${formatMoney(p.costBasis)} -> current ${formatMoney(currentValue)} (${pnl >= 0 ? '+' : ''}${formatMoney(pnl)})`)
    }
    const totalScore = summary.netRealizedPnl + unrealizedPnl
    ns.print(
      `Total trading score (realized + unrealized, live mark-to-market): `
      + `${totalScore >= 0 ? '+' : ''}${formatMoney(totalScore)}`,
    )
  }
}
