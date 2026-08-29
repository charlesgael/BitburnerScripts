import type { NS } from '@ns'
import type { Contract, SolveResult } from '../contracts.lib'

export const CONTRACTS_LOG_FILE = 'log/contracts-log.txt'
const CONTRACTS_LOG_MAX_ENTRIES = 500
export const CONTRACTS_SCRIPT = 'contracts.app.js'
export const CONTRACTS_HOST = 'home'

function trimLogIfNeeded(ns: NS, logFile: string, maxEntries: number) {
  const raw = ns.read(logFile)
  if (!raw)
    return
  const lines = raw.split(`\n`).filter(l => l.trim())
  if (lines.length <= maxEntries)
    return
  ns.write(logFile, `${lines.slice(-(maxEntries * 0.8)).join(`\n`)}\n`, `w`)
}
export function recordContractResult(ns: NS, result: SolveResult, contract: Contract) {
  // ns.print(`Game vs ${opponent} over - ${resultLabel} (${summary}).`)
  // ns.toast(
  //   `IPvGO vs ${opponent}: ${resultLabel} (${summary})`,
  //   result === `win` ? `success` : result === `loss` ? `warning` : `info`,
  //   5000,
  // )

  ns.write(CONTRACTS_LOG_FILE, `${JSON.stringify({ ...result, ...contract })}\n`, `a`)
  trimLogIfNeeded(ns, CONTRACTS_LOG_FILE, CONTRACTS_LOG_MAX_ENTRIES)
}
