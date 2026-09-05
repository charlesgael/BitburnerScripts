import type { NS } from '@ns'
import { parseTraderLog, TRADER_LOG_FILE } from './lib/trader/state-file'
import {
  formatTraderLogSummary,
  formatTraderLogSummaryByWindow,
  summarizeTraderLog,
  summarizeTraderLogByWindow,
} from './lib/trader/state-file/make-stats'
import { arg, parseArgs } from './utils/args'

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

  const raw = ns.read(TRADER_LOG_FILE)
  if (!raw) {
    ns.tprint(`No log found at ${TRADER_LOG_FILE} - has trader.app.js been run yet?`)
    return
  }

  const entries = parseTraderLog(raw)
  for (const line of formatTraderLogSummary(summarizeTraderLog(entries)))
    ns.tprint(line)
  for (const line of formatTraderLogSummaryByWindow(summarizeTraderLogByWindow(entries, windowMin), windowMin))
    ns.tprint(line)
}
