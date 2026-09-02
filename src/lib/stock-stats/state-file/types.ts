import type { InferSchema } from '../../../utils/tiny-schema/types'
import { logSchema } from '../../../utils/log-helper'
import { number } from '../../../utils/tiny-schema/number'
import { object } from '../../../utils/tiny-schema/object'
import { record } from '../../../utils/tiny-schema/record'

export const stockPriceSchema = object({
  ask: number(),
  bid: number(),
  // Only present when the collecting life has has4SDataTixApi() - the
  // game's own forecast/volatility model, not derived by us, so useful as
  // ground truth to validate our own stats against when it's available.
  forecast: number().optional(),
  volatility: number().optional(),
})
export type StockPrice = InferSchema<typeof stockPriceSchema>

// Keyed by stock symbol (e.g. "FSIG") - the symbol set varies by BitNode, so
// a dictionary is the only shape that fits, not a fixed object() shape.
export const stockTickSchema = logSchema(object({
  prices: record(stockPriceSchema),
}))
export type StockTickEntry = InferSchema<typeof stockTickSchema>
