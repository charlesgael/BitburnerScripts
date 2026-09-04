import type { NS } from '@ns'
import type { StockPrice, StockTickEntry } from './types'
import { addLog, parseLog } from '../../../utils/log-helper'
import { stockTickSchema } from './types'

export const STOCK_STATS_LOG_FILE = 'log/stock-readings.txt'

/**
 * log-helper's own default trim window (500 entries) is tuned for rare
 * events like contract solves, not a ~6s-cadence stock tick time series -
 * at that cadence 500 entries is under an hour of history. 3000 keeps
 * roughly 5 hours of per-tick history before the oldest rows roll off.
 */
const STOCK_STATS_MAX_ENTRIES = 3000

export function recordStockTick(ns: NS, prices: Record<string, StockPrice>) {
  addLog(ns, STOCK_STATS_LOG_FILE, { prices }, undefined, STOCK_STATS_MAX_ENTRIES)
}

export function parseStockStatsLog(raw: string): StockTickEntry[] {
  return parseLog(raw, stockTickSchema)
}
