import type { InferSchema } from '../../utils/tiny-schema/types'
import { logSchema } from '../../utils/log-helper'
import { number } from '../../utils/tiny-schema/number'
import { object } from '../../utils/tiny-schema/object'
import { or } from '../../utils/tiny-schema/or'
import { string } from '../../utils/tiny-schema/string'

/**
 * `steady-farm.daemon.ts`'s own log schema — deliberately independent of
 * `lib/money-farm/state-farm/types.ts` rather than shared, per this
 * feature's own separate-port/separate-log design (see
 * `daemons/steady-farm.daemon.ts`'s header comment): the two daemons never
 * drain each other's queues, so there's no reason for their log shapes to
 * be coupled either. No rollup mechanism like money-farm's — this daemon's
 * whole design point is a small number of self-sustaining wave-sets rather
 * than continuously-redispatched batches, so its log volume stays low by
 * construction and doesn't need that compaction layer.
 */
const modeSchema = string('weaken', 'grow-prep', 'farm')
export type Mode = InferSchema<typeof modeSchema>

const changeModeSchema = object({
  action: string('change-mode'),
  target: string(),
  oldMode: string(),
  mode: modeSchema,
})
const workLifecycleSchema = object({
  /**
   * `'start-work'`/`'end-work'`: this daemon only ever has one target at a
   * time, so these mark that single target's own adoption/abandonment —
   * `'start-work'` when `pickTarget` first settles on it (or replaces a
   * previous one), `'end-work'` when the current target stops qualifying
   * and nothing else does yet either (see the daemon's own retarget
   * handling).
   */
  action: string('start-work', 'end-work'),
  target: string(),
  /** `'start-work'` only: this target's own money/sec score at pick time. */
  score: number().optional(),
})
const updateServer = object({
  /**
   * A periodic snapshot of the current target, written every
   * `STATE_CHECK_INTERVAL` tick regardless of whether it changed —
   * unlike money-farm's heartbeat-gated version, this daemon's low log
   * volume doesn't need the dedup/heartbeat split at all.
   */
  action: string('update-server'),
  target: string(),
  money: number(),
  maxMoney: number(),
  security: number(),
  minSecurity: number(),
})
const hgwSchema = object({
  /** A completed hack/grow/weaken call from one of this daemon's own wave legs. */
  action: string('hack', 'grow', 'weaken'),
  target: string(),
  threads: number(),
  /** Wall-clock ms this specific call took to complete. */
  duration: number(),
  /** Dollars stolen (hack only). */
  money: number().optional(),
  /** Net security *change* from this call — positive means increased, negative decreased. */
  deltaSecurity: number().optional(),
  /** grow only: the raw multiplier `ns.grow()` itself returned — see money-farm's identical field for why this isn't a dollar amount. */
  growth: number().optional(),
})
export type WorkerStatus = InferSchema<typeof hgwSchema>

const orSchema = or(updateServer, hgwSchema, changeModeSchema, workLifecycleSchema)
export type AddLogInput = InferSchema<typeof orSchema>

export const steadyFarmLogEntrySchema = logSchema(orSchema)
export type SteadyFarmLogEntry = InferSchema<typeof steadyFarmLogEntrySchema>
