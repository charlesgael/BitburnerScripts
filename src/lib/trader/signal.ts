import type { NS } from '@ns'

/**
 * How many past ticks feed the momentum fallback (no 4S access) - matches
 * the lookback that peaked at ~55% directional accuracy against the
 * collected stock-stats.txt sample this project analyzed (mean bias-regime
 * length was ~154 ticks; momentum accuracy fell off again past ~80-120).
 */
export const WINDOW_TICKS = 30

/**
 * Minimum |forecast - 0.5| to treat the 4S forecast as an actual signal
 * rather than noise. The stock-stats.txt sample's per-symbol mean forecasts
 * mostly sat within +-0.05 of neutral even for symbols with a real
 * directional bias, so this is a real filter, not a token gate.
 */
export const FORECAST_MARGIN = 0.05

export interface TradeSignal {
  direction: 'long' | 'short' | null
  /**
   * Magnitude of confidence. Only comparable to other signals from the same
   * source - 4S and momentum use different scales - which is fine since a
   * single life only ever uses one source for every symbol at once
   * (has4SDataTixApi is account-wide, not per-symbol).
   */
  strength: number
}

const NO_SIGNAL: TradeSignal = { direction: null, strength: 0 }

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  const m = mean(values)
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)))
}

/**
 * Per-symbol rolling window of mid prices. Only consulted by the momentum
 * fallback (a life with 4S access never needs it - see getSignal below) -
 * but kept warm for every symbol regardless, so it's ready the moment 4S
 * access is lost on a future reset.
 */
export class PriceWindow {
  private readonly mids = new Map<string, number[]>()

  push(sym: string, mid: number): void {
    const arr = this.mids.get(sym) ?? []
    arr.push(mid)
    if (arr.length > WINDOW_TICKS + 1)
      arr.shift()
    this.mids.set(sym, arr)
  }

  /**
   * Seeds from historical mids (oldest to newest) - e.g. a warm-start read
   * from stock-stats.txt - trimmed to what the window actually needs.
   */
  seed(sym: string, mids: number[]): void {
    this.mids.set(sym, mids.slice(-(WINDOW_TICKS + 1)))
  }

  isReady(sym: string): boolean {
    return (this.mids.get(sym)?.length ?? 0) > WINDOW_TICKS
  }

  private tickReturns(sym: string): number[] {
    const arr = this.mids.get(sym) ?? []
    const returns: number[] = []
    for (let i = 1; i < arr.length; i++)
      returns.push((arr[i] - arr[i - 1]) / arr[i - 1])
    return returns
  }

  private trailingReturn(sym: string): number {
    const arr = this.mids.get(sym)
    if (!arr || arr.length <= WINDOW_TICKS)
      return 0
    return arr[arr.length - 1] / arr[0] - 1
  }

  /**
   * Stddev of tick-over-tick returns - the "is this move real" noise floor
   * used by getMomentumSignal to decide whether a trailing move is signal
   * or noise.
   */
  noiseFloor(sym: string): number {
    return stddev(this.tickReturns(sym))
  }

  /**
   * |trailing WINDOW_TICKS return| - the actual measured move already in
   * motion. Used by trader.app.ts's entry edge check as the expected-move
   * estimate for a momentum-sourced signal, instead of noiseFloor's
   * single-tick magnitude - see that function's own comment for why a
   * single tick's volatility was the wrong horizon to compare a
   * paid-once round-trip cost against.
   */
  trailingMoveMagnitude(sym: string): number {
    return Math.abs(this.trailingReturn(sym))
  }

  getMomentumSignal(sym: string): TradeSignal {
    if (!this.isReady(sym))
      return NO_SIGNAL

    const trailingReturn = this.trailingReturn(sym)
    const noiseFloor = this.noiseFloor(sym)
    if (noiseFloor === 0 || Math.abs(trailingReturn) < noiseFloor)
      return NO_SIGNAL

    return {
      direction: trailingReturn > 0 ? 'long' : 'short',
      strength: Math.abs(trailingReturn) / noiseFloor,
    }
  }
}

/**
 * Ground truth (ns.stock.getForecast) when this life has 4S Market Data TIX
 * API, else the momentum fallback computed from `window`'s own price
 * history - see this project's stock-stats.txt analysis for why 4S isn't
 * required to get a real (if weaker) edge.
 */
export function getSignal(ns: NS, sym: string, has4SData: boolean, window: PriceWindow): TradeSignal {
  if (has4SData) {
    const diff = ns.stock.getForecast(sym) - 0.5
    if (Math.abs(diff) < FORECAST_MARGIN)
      return NO_SIGNAL
    return { direction: diff > 0 ? 'long' : 'short', strength: Math.abs(diff) }
  }

  return window.getMomentumSignal(sym)
}
