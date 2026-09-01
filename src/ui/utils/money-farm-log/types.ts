import type { InferSchema } from '../../../utils/tiny-schema/types'
import { logSchema } from '../../../utils/log-helper'
import { number } from '../../../utils/tiny-schema/number'
import { object } from '../../../utils/tiny-schema/object'
import { or } from '../../../utils/tiny-schema/or'
import { string } from '../../../utils/tiny-schema/string'

const modeSchema = string('weaken', 'grow-prep', 'farm')
export type Mode = InferSchema<typeof modeSchema>

const changeTarget = object({
  action: string('change-target'),
  oldTarget: string(),
  target: string(),
})
const changeModeSchema = object({
  action: string('change-mode'),
  target: string(),
  oldMode: string(),
  mode: modeSchema,
})
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
  security: number(),
  minSecurity: number(),
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
const orSchema = or(setSecuritySchema, hgwSchema, changeTarget, changeModeSchema)
export type AddLogInput = InferSchema<typeof orSchema>

export const moneyFarmLogEntrySchema = logSchema(orSchema)
export type MoneyFarmLogEntry = InferSchema<typeof moneyFarmLogEntrySchema>
