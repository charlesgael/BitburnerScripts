import type { InferSchema } from '../../../utils/tiny-schema/types'
import { logSchema } from '../../../utils/log-helper'
import { array } from '../../../utils/tiny-schema/array'
import { combine } from '../../../utils/tiny-schema/combine'
import { number } from '../../../utils/tiny-schema/number'
import { object } from '../../../utils/tiny-schema/object'
import { or } from '../../../utils/tiny-schema/or'
import { record } from '../../../utils/tiny-schema/record'
import { string } from '../../../utils/tiny-schema/string'

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
   * `'start-work'`/`'end-work'`: the start and end of one `TargetSession`'s
   * own lifespan (not a mode change within it — see `change-mode` for
   * that) — `'start-work'` when it's created (a fresh root pick, or the
   * chain extending by one), `'end-work'` when it's actually removed from
   * the chain (a root retarget kills every session then replaces the
   * chain; a regression elsewhere in the chain kills everything *after*
   * the regressed position, which itself keeps running — see
   * `daemons/money-farm.daemon.ts`'s chain-walk comment). This pair
   * replaced a single `'change-target'` action that used to bundle both
   * halves together — a bundled "old -> new" entry doesn't generalize
   * once a chain event can end several sessions and start only one (a
   * root retarget) or start one without ending any (a chain extension).
   */
  action: string('start-work', 'end-work'),
  target: string(),
  /**
   * `'start-work'` only: this target's own money/sec score at pick time
   * (`pickTarget`'s `moneyMax * hackChance / weakenTime` formula) — the
   * reason it was chosen. Never populated on `'end-work'`.
   */
  score: number().optional(),
})
const updateServer = object({
  /**
   * `'update-server'`: a periodic snapshot of an active session's target,
   * written by `tickSession` every `STATE_CHECK_INTERVAL` for every
   * session in the chain — independent of `start-work`/`end-work`/
   * `change-mode`, which only fire on an actual transition. Doubles as the
   * absolute-security checkpoint a `deltaSecurity`-summing reader should
   * re-anchor its running total to (this used to be a separate
   * `'set-security'` action, fired only on mode transitions — merged in
   * once `update-server` started running from the same unconditional
   * per-tick call site in `tickSession`, which made a second entry
   * carrying overlapping information pointless).
   */
  action: string('update-server'),
  target: string(),
  /** The target's live `moneyAvailable`/`moneyMax` at snapshot time. */
  money: number(),
  maxMoney: number(),
  /**
   * The target's actual *absolute* live security at snapshot time — not
   * a delta. See `deltaSecurity` below for why hack/grow/weaken entries
   * use a differently-named field for their own, unrelated meaning.
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
  /** Wall-clock ms this specific call took to complete. */
  duration: number(),
  /** Dollars stolen (hack only — grow/weaken never populate this). */
  money: number().optional(),
  /**
   * hack/grow/weaken: net security *change* from this call — positive
   * means security increased (hack/grow), negative means it decreased
   * (weaken). grow's own worker never computes this directly (see
   * grow.daemon.ts's header comment) — money-farm.daemon.ts's
   * drainStatusPort fills it in via growthAnalyzeSecurity before logging,
   * so a grow entry still carries a value here despite the worker itself
   * never populating it. Named differently from `update-server`'s
   * `security` (an absolute value, not a delta) on purpose — see that
   * schema's own comment.
   */
  deltaSecurity: number().optional(),
  /**
   * grow only: the raw multiplier `ns.grow()` itself returned for this
   * call — *not* a dollar amount, and not summable/comparable across
   * entries the way `money`/`deltaSecurity` are. Turning it into an exact
   * dollar delta would need the target's `moneyAvailable` at the instant
   * this specific call resolved, which isn't reliably knowable here:
   * many batches deliberately land hack/grow/weaken calls on the same
   * target concurrently (the whole point of the HWGW pipeline), so any
   * "before" value captured at dispatch or drain time can already be
   * stale by the time this grow() actually completes — not an
   * implementation gap, a structural consequence of that concurrency.
   * Useful only as a per-call diagnostic: compare it, over many samples,
   * against what `computeBatchPlan`'s `growThreadsFor` predicted, to see
   * whether grow is actually performing as the daemon's own math expects.
   */
  growth: number().optional(),
})
export type WorkerStatus = InferSchema<typeof hgwSchema>

const orSchema = or(updateServer, hgwSchema, changeModeSchema, workLifecycleSchema)
export type AddLogInput = InferSchema<typeof orSchema>

/*
 * --- ROLLUP ---
 *
 * `'rollup'` isn't something `addMoneyFarmLog` callers ever construct
 * (it's intentionally left out of `orSchema`/`AddLogInput` above) — it's
 * synthesized by `mk-stats.ts`'s `buildMoneyFarmRollup` when
 * `state-farm/index.ts` collapses a chunk of aging log entries that would
 * otherwise just be truncated away (see that file's own header comment).
 * A rollup is a compact, purely additive digest of everything it replaces:
 * raw summable fields only (`count`/`threads`/`totalDuration`/`money`/
 * `growth`, `mode.durationMs`, the two time-weighted `*TimeMs` integrals),
 * never the derived per-average fields `finalizeAction`/`finalizeHack`/
 * `finalizeGrow`/`finalizeTarget` compute — those get recomputed once
 * `mk-stats.ts` sums a rollup's raw numbers together with whatever real
 * entries remain, the same way it always has.
 */
const actionTotalsSchema = object({
  count: number(),
  threads: number(),
  totalDuration: number(),
})
const hackTotalsSchema = combine(actionTotalsSchema, object({ money: number() }))
const growTotalsSchema = combine(actionTotalsSchema, object({ growth: number() }))
// weakens has no extra field beyond the shared totals — reuse actionTotalsSchema directly.

const modeDurationSchema = object({
  'weaken': number(),
  'grow-prep': number(),
  'farm': number(),
})

const rollupTargetSchema = object({
  target: string(),
  totalMoney: number(),
  uptimeMs: number(),
  hacks: hackTotalsSchema,
  grows: growTotalsSchema,
  weakens: actionTotalsSchema,
  modeChanges: number(),
  modeTransitions: record(number()),
  modeDurationMs: modeDurationSchema,
  /**
   * Time-weighted integral — paired with `uptimeMs` by `finalizeTarget`
   * to re-derive `server.averageMoneyDeficit`, the same computation
   * `closeServerInterval` performs live.
   */
  moneyDeficitTimeMs: number(),
  /** Same pairing, for `server.averageSecurityExcess`. */
  securityExcessTimeMs: number(),
  /**
   * Present only when this target's session was still open (no
   * `end-work` seen) at the moment this chunk got collapsed — a
   * continuously-farming target never re-emits `start-work` just because
   * a rollup happened, and `uptimeMs` is *only* ever advanced via
   * `start-work`/`end-work` bookkeeping, so without this the target's
   * uptime clock would freeze forever while `totalMoney` kept climbing
   * (silently inflating `moneyPerHour` without bound). The value is the
   * fake restart timestamp `mk-stats.ts` reseeds `runtime.startedAt`
   * with — a deliberate, disclosed approximation, not the target's true
   * original start instant. Only the uptime clock is reseeded this way;
   * `runtime.mode`/`lastServerSnapshot` are left for the next real
   * `change-mode`/`update-server` entry to reinitialize on its own
   * (both handlers already do this unconditionally), leaving a small,
   * self-healing blind spot in the mode-split/security-average tracking
   * right at the rollup boundary.
   */
  reopenAt: number().optional(),
})

const rollupSchema = object({
  action: string('rollup'),
  totalMoney: number(),
  totalHacks: number(),
  totalGrows: number(),
  totalWeakens: number(),
  hacks: hackTotalsSchema,
  grows: growTotalsSchema,
  weakens: actionTotalsSchema,
  targets: array(rollupTargetSchema),
})
export type RollupTarget = InferSchema<typeof rollupTargetSchema>

/*
 * The *read* schema is a superset of `orSchema` (the write/`AddLogInput`
 * side) — `moneyFarmLogEntrySchema`/`MoneyFarmLogEntry` need to accept a
 * `'rollup'` entry that `parseMoneyFarmLog` might encounter on disk, even
 * though nothing ever constructs one through `addMoneyFarmLog` itself.
 */
const logEntrySchema = or(orSchema, rollupSchema)

export const moneyFarmLogEntrySchema = logSchema(logEntrySchema)
export type MoneyFarmLogEntry = InferSchema<typeof moneyFarmLogEntrySchema>
export type RollupLogEntry = Extract<MoneyFarmLogEntry, { action: 'rollup' }>
