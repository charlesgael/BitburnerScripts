import type { NS } from '@ns'

let saves = 0
const AUTO_CLEAN_ROUNDS = 50
const LOG_MAX_ENTRIES = 500

export function trimLogIfNeeded(ns: NS, logFile: string, cleanDelay = AUTO_CLEAN_ROUNDS, maxEntries = LOG_MAX_ENTRIES) {
  if (saves % cleanDelay !== 0)
    return
  const raw = ns.read(logFile)
  if (!raw)
    return
  const lines = raw.split(`\n`).filter(l => l.trim())
  if (lines.length <= maxEntries)
    return
  ns.write(logFile, `${lines.slice(-maxEntries).join(`\n`)}\n`, `w`)
}

export function addLog(ns: NS, logFile: string, line: string, cleanDelay = AUTO_CLEAN_ROUNDS, maxEntries = LOG_MAX_ENTRIES) {
  ns.write(logFile, `${line}\n`, `a`)
  saves++
  trimLogIfNeeded(ns, logFile, cleanDelay, maxEntries)
}
