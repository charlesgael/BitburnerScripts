import type { NS } from '@ns'
import type { AddLogInput, MoneyFarmLogEntry } from './types'
import { addLog, parseLog } from '../../../utils/log-helper'
import { moneyFarmLogEntrySchema } from './types'

/**
 * Money Farm's activity log — one line per completed hack()/grow()/
 * weaken() call, written by `daemons/money-farm.daemon.ts` (via
 * `addLog`/`utils/log-helper.ts`) after draining `ports.lib.ts`'s
 * `MONEY_FARM_PORT`, which `hack.daemon.ts`/`grow.daemon.ts`/
 * `weaken.daemon.ts` write a status object to after each completed action
 * when launched with `--port` — see those files' own header comments for
 * why `money`/`deltaSecurity` are sometimes filled in by the daemon rather
 * than the worker itself (a per-thread RAM-cost concern, not a laziness
 * one).
 *
 * A fourth `action` value, `'set-security'`, isn't a completed hack/grow/
 * weaken call at all — `tickSession` writes one on every mode transition,
 * carrying the target's actual live `security` (via `ns.getServer`) with
 * `threads`/`duration` both 0. Every other entry's `deltaSecurity` is a
 * change*, not an absolute value, from one worker's own action, and
 * grow's in particular is never exact (see `grow.daemon.ts`'s header
 * comment), so summing deltas alone drifts from reality over time —
 * `'set-security'`'s `security` is a checkpoint a reader should re-anchor
 * its running total to rather than trusting an ever-compounding sum. The
 * two fields are named differently on purpose (`deltaSecurity` vs.
 * `security`) so a reader can't accidentally sum a `'set-security'` entry's
 * absolute value into a running delta total.
 *
 * Mirrors `contracts/state-file/`'s exact shape (`logSchema` wrapping a
 * content schema, `parseLog` for schema-validated reads) — this file is
 * that pattern's money-farm equivalent, kept under `ui/utils/` alongside
 * `money-farm-config.ts` rather than a separate top-level folder, matching
 * how the rest of this feature's shared constants/types are organized.
 */
export const MONEY_FARM_LOG_FILE = 'log/money-farm-log.txt'
export const MONEY_FARM_LOG_MAX_ENTRIES = 2000
export const MONEY_FARM_LOG_CLEAN_ROUNDS = 50

export function parseMoneyFarmLog(raw: string): MoneyFarmLogEntry[] {
  return parseLog(raw, moneyFarmLogEntrySchema)
}

export function addMoneyFarmLog(ns: NS, obj: AddLogInput) {
  addLog(ns, MONEY_FARM_LOG_FILE, obj, MONEY_FARM_LOG_CLEAN_ROUNDS, MONEY_FARM_LOG_MAX_ENTRIES)
}
