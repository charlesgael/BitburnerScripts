import type { InferSchema } from '../../../utils/tiny-schema/types'
import { logSchema } from '../../../utils/log-helper'
import { boolean } from '../../../utils/tiny-schema/boolean'
import { number } from '../../../utils/tiny-schema/number'
import { object } from '../../../utils/tiny-schema/object'
import { string } from '../../../utils/tiny-schema/string'

export const tradeSignalSchema = object({
  direction: string(),
  strength: number(),
})

/**
 * One row per tick: either a portfolio-value snapshot alone (no qualifying
 * trade that tick), or a snapshot plus the trade that was executed (or, in
 * --dry-run, would have been) - `type` distinguishes the variants instead
 * of a separate schema each, matching contracts/state-file's precedent of
 * a flat, mostly-optional shape for an append log rather than a strict
 * union.
 */
export const traderEventSchema = logSchema(object({
  type: string(), // 'snapshot' | 'trade' | 'halt' | 'resume'
  cash: number(),
  portfolioValue: number(),
  symbol: string().optional(),
  action: string().optional(), // 'buy' | 'sell' | 'buyShort' | 'sellShort'
  shares: number().optional(),
  price: number().optional(),
  /**
   * Actual dollar amount of this trade - getPurchaseCost (buy/buyShort) or
   * getSaleGain (sell/sellShort), already computed at the call site for its
   * own edge/P&L check. Distinct from price*shares: commission and price
   * impact aren't reflected in the per-share `price` alone. Optional since
   * log entries written before this field existed won't have it - consumers
   * fall back to price*shares for those.
   */
  amount: number().optional(),
  signal: tradeSignalSchema.optional(),
  reason: string().optional(), // 'entry' | 'signal-reversed' | 'stop-loss'
  dryRun: boolean().optional(),
}))
export type TraderLogEntry = InferSchema<typeof traderEventSchema>
