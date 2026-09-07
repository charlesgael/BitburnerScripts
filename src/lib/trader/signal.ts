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

/**
 * Consecutive ticks a new momentum direction must be raw-computed before
 * getMomentumSignal actually reports it, instead of flipping the moment a
 * single tick's window-endpoint difference crosses zero. trailingReturn is
 * `arr[last]/arr[0] - 1` recomputed fresh every tick - one noisy tick
 * entering or leaving the window can flip its sign with nothing about the
 * underlying trend actually changing, and live trading confirmed this: 596
 * of 602 exits in one session were signal-reversed (not stop-loss) at a
 * 2.5-minute average hold, and the resulting net trading P&L (isolated from
 * every other income source that session, ~0.2% return on capital
 * deployed) was far thinner than the ~1.62% mean raw per-trade return -
 * spread/commission/impact paid on that much churn ate most of the edge.
 * Only the momentum path needs this: has4SData's ns.stock.getForecast is a
 * real day-to-day probability, not a two-point window difference, and never
 * touches PriceWindow at all (see getSignal below) - this constant and the
 * state it drives has no effect whenever 4S access is owned. Picked as a
 * reasonable starting value to filter single-tick noise without adding much
 * lag on top of the already-throttled per-tick sampling; not yet tuned
 * against a live before/after comparison the way WINDOW_TICKS was.
 */
const MOMENTUM_CONFIRM_TICKS = 3

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

/**
 * Debounce state for one symbol's momentum direction - `confirmed` is what
 * getMomentumSignal actually reports; `pending`/`pendingCount` track a
 * not-yet-confirmed raw direction working towards MOMENTUM_CONFIRM_TICKS.
 * `null` is a real value for both `confirmed` and `pending` (no signal /
 * below noise floor), not just "unset" - dropping out of a confirmed
 * direction needs the same persistence as flipping to the opposite one, so
 * a momentary dip below the noise floor doesn't instantly exit a held
 * position either. `pending` is `undefined` specifically for "no candidate
 * currently accumulating" - collapsing that into `null` instead would make
 * a reset-then-immediately-null tick collide with a genuine second
 * consecutive null reading and undercount by one tick.
 */
interface MomentumDirectionState {
  confirmed: 'long' | 'short' | null
  pending: 'long' | 'short' | null | undefined
  pendingCount: number
}

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
  private readonly direction = new Map<string, MomentumDirectionState>()

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

  /**
   * Debounced: the raw direction below (from a single tick's window-endpoint
   * difference) only becomes the reported one after MOMENTUM_CONFIRM_TICKS
   * consecutive ticks agree - see that constant's own comment for why.
   * `strength` is reported off the raw magnitude regardless (it's a
   * direction-agnostic |move|/noiseFloor ratio, only consumed for ranking
   * entry candidates - not-yet-confirmed positions never reach that
   * ranking, so there's nothing for a stale strength to mislead there).
   */
  getMomentumSignal(sym: string): TradeSignal {
    if (!this.isReady(sym))
      return NO_SIGNAL

    const trailingReturn = this.trailingReturn(sym)
    const noiseFloor = this.noiseFloor(sym)
    const rawDirection: 'long' | 'short' | null
      = (noiseFloor === 0 || Math.abs(trailingReturn) < noiseFloor)
        ? null
        : (trailingReturn > 0 ? 'long' : 'short')
    const strength = noiseFloor === 0 ? 0 : Math.abs(trailingReturn) / noiseFloor

    const state = this.direction.get(sym) ?? { confirmed: null, pending: undefined, pendingCount: 0 }

    if (rawDirection === state.confirmed) {
      state.pending = undefined
      state.pendingCount = 0
    }
    else if (rawDirection === state.pending) {
      state.pendingCount++
      if (state.pendingCount >= MOMENTUM_CONFIRM_TICKS) {
        state.confirmed = rawDirection
        state.pending = undefined
        state.pendingCount = 0
      }
    }
    else {
      state.pending = rawDirection
      state.pendingCount = 1
    }

    this.direction.set(sym, state)

    return state.confirmed === null ? NO_SIGNAL : { direction: state.confirmed, strength }
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
