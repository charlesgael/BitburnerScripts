import type { NS } from '@ns'
import type { TraderLogEntry } from './types'
import { addLog, parseLog } from '../../../utils/log-helper'
import { traderEventSchema } from './types'

export const TRADER_LOG_FILE = 'log/trader-log.txt'

/**
 * Same reasoning as stock-stats: a ~6s-cadence log needs a much bigger
 * window than log-helper's 500-entry default. Trade/snapshot rows are
 * smaller than stock-stats' full per-symbol price map, so this can afford
 * to keep more history for a similar file-size budget.
 */
const TRADER_MAX_ENTRIES = 5000

export function recordTraderEvent(ns: NS, event: Omit<TraderLogEntry, 'ts'>) {
  addLog(ns, TRADER_LOG_FILE, event, undefined, TRADER_MAX_ENTRIES)
}

export function parseTraderLog(raw: string): TraderLogEntry[] {
  return parseLog(raw, traderEventSchema)
}
