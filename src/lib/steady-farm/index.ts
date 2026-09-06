import type { NS } from '@ns'
import type { AddLogInput, SteadyFarmLogEntry } from './types'
import { addLog, parseLog } from '../../utils/log-helper'
import { steadyFarmLogEntrySchema } from './types'

/**
 * Steady Farm's own activity log — separate file from `money-farm-log.txt`
 * on purpose (see `daemons/steady-farm.daemon.ts`'s header comment): a
 * shared log would need a `source` field and shared-port draining, both
 * avoidable by just not sharing. Uses the plain `addLog`/`parseLog` pair
 * from `utils/log-helper.ts` directly — no rollup mechanism, unlike
 * money-farm's own log, since this daemon's low log volume doesn't need
 * one (see `types.ts`'s header comment).
 */
export const STEADY_FARM_LOG_FILE = 'log/steady-farm-log.txt'
export const STEADY_FARM_LOG_MAX_ENTRIES = 2000
export const STEADY_FARM_LOG_CLEAN_ROUNDS = 50

export function parseSteadyFarmLog(raw: string): SteadyFarmLogEntry[] {
  return parseLog(raw, steadyFarmLogEntrySchema)
}

export function addSteadyFarmLog(ns: NS, obj: AddLogInput) {
  addLog(ns, STEADY_FARM_LOG_FILE, obj, STEADY_FARM_LOG_CLEAN_ROUNDS, STEADY_FARM_LOG_MAX_ENTRIES)
}
