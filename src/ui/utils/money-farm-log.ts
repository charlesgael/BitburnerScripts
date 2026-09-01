import type { NS } from '@ns'
import type { InferSchema } from '../../utils/tiny-schema/types'
import { addLog, logSchema, parseLog } from '../../utils/log-helper'
import { number } from '../../utils/tiny-schema/number'
import { object } from '../../utils/tiny-schema/object'
import { or } from '../../utils/tiny-schema/or'
import { string } from '../../utils/tiny-schema/string'

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

const setSecuritySchema = object({
  /**
   * `'set-security'` for a mode-transition checkpoint (see above).
   */
  action: string('set-security'),
  target: string(),
  /**
   * `'set-security'` only: the target's actual *absolute* live security at
   * that moment — a checkpoint, not a delta. Never populated on a hack/
   * grow/weaken entry — see `deltaSecurity` above.
   */
  security: number().optional(),
})
const hgwSchema = object({
  /**
   * A completed hack/grow/weaken call (see above).
   */
  action: string('hack', 'grow', 'weaken'),
  target: string(),
  threads: number(),
  /**
   * Wall-clock ms this specific call took to complete — 0 for a
   * `'set-security'` checkpoint (not a timed action).
   */
  duration: number(),
  /**
   * Dollars stolen (hack only — grow/weaken/set-security never populate
   * this).
   */
  money: number().optional(),
  /**
   * hack/grow/weaken only: net security *change* from this call —
   * positive means security increased (hack/grow), negative means it
   * decreased (weaken). Never populated on a `'set-security'` entry —
   * see `security` below.
   */
  deltaSecurity: number().optional(),
})
const orSchema = or(setSecuritySchema, hgwSchema)
type AddLogInput = InferSchema<typeof orSchema>

const moneyFarmLogEntrySchema = logSchema(orSchema)
export type MoneyFarmLogEntry = InferSchema<typeof moneyFarmLogEntrySchema>

export function parseMoneyFarmLog(raw: string): MoneyFarmLogEntry[] {
  return parseLog(raw, moneyFarmLogEntrySchema)
}

export function addMoneyFarmLog(ns: NS, obj: AddLogInput) {
  addLog(ns, MONEY_FARM_LOG_FILE, obj, MONEY_FARM_LOG_CLEAN_ROUNDS, MONEY_FARM_LOG_MAX_ENTRIES)
}
