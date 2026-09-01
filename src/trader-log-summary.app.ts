import type { NS } from '@ns'
import { parseTraderLog, TRADER_LOG_FILE } from './trader/state-file'
import { formatTraderLogSummary, summarizeTraderLog } from './trader/state-file/make-stats'

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

  const raw = ns.read(TRADER_LOG_FILE)
  if (!raw) {
    ns.tprint(`No log found at ${TRADER_LOG_FILE} - has trader.app.js been run yet?`)
    return
  }

  const summary = summarizeTraderLog(parseTraderLog(raw))
  for (const line of formatTraderLogSummary(summary))
    ns.tprint(line)
}
