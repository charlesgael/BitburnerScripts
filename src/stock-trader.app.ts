import type { NS } from '@ns'
import type { TradeSignal } from './lib/trader/signal'
import { parseStockStatsLog, recordStockTick, STOCK_STATS_LOG_FILE } from './lib/stock-stats/state-file'
import { getSignal, PriceWindow, WINDOW_TICKS } from './lib/trader/signal'
import { recordTraderEvent } from './lib/trader/state-file'
import { collectPrices } from './stock-reader.app'
import { arg, parseArgs } from './utils/args'
import { formatMoney } from './utils/format/game'
import { noDupe } from './utils/ns/nodupe'

/**
 * Long-lived, unrestricted-ns trading loop (no UI, no cgd - same category
 * as stock-stats.app.ts/hacknet.app.ts). Opens/closes long and (when
 * SF8/BitNode-8 allows it) short positions off ns.stock.getForecast (when
 * 4S Market Data TIX API is owned) or trader/signal.ts's rolling-window
 * momentum fallback otherwise. Every ns.stock.getPurchaseCost/getSaleGain
 * call already bakes in commission/spread/price-impact, so there's no
 * separate "$100k penalty" constant anywhere in here - it's just always
 * priced in by those two functions.
 *
 * Live by default: `run trader.app.js` executes real trades. Pass
 * --dry-run to only log what it would have done.
 */

const MAX_CONCURRENT_POSITIONS = 5
const POSITION_FRACTION_OF_CASH = 0.1
const MIN_EDGE_MULTIPLE = 2
const STOP_LOSS_PCT = 0.08
const MAX_DRAWDOWN_PCT = 0.20

interface Position {
  sym: string
  sharesLong: number
  avgLongPrice: number
  sharesShort: number
  avgShortPrice: number
}

function emptyPosition(sym: string): Position {
  return { sym, sharesLong: 0, avgLongPrice: 0, sharesShort: 0, avgShortPrice: 0 }
}

function realPosition(ns: NS, sym: string): Position {
  const [sharesLong, avgLongPrice, sharesShort, avgShortPrice] = ns.stock.getPosition(sym)
  return { sym, sharesLong, avgLongPrice, sharesShort, avgShortPrice }
}

/**
 * Source of truth for what's currently held. In live mode this is just
 * ns.stock.getPosition (the real, game-tracked position) - but a --dry-run
 * trade never touches that, so dry-run keeps its own in-memory ledger,
 * updated by recordBuy/recordSell after each simulated trade. Without this,
 * every tick sees "nothing held" for every symbol and re-buys the same top
 * candidates forever - the actual bug behind an early run that logged
 * nothing but repeated buys.
 */
class PositionBook {
  private readonly sim = new Map<string, Position>()
  private simCash: number

  constructor(private readonly ns: NS, private readonly dryRun: boolean) {
    this.simCash = ns.getPlayer().money
  }

  /**
   * ns.getPlayer().money never actually moves on a --dry-run trade either -
   * without tracking it separately, every simulated position would be sized
   * off the full real cash balance instead of what would actually remain
   * after earlier simulated buys, making dry-run systematically size
   * positions larger than live mode ever would.
   */
  getCash(): number {
    return this.dryRun ? this.simCash : this.ns.getPlayer().money
  }

  get(sym: string): Position {
    return this.dryRun ? (this.sim.get(sym) ?? emptyPosition(sym)) : realPosition(this.ns, sym)
  }

  recordBuy(sym: string, position: 'L' | 'S', shares: number, price: number, cost: number): void {
    if (!this.dryRun)
      return
    this.simCash -= cost
    const current = this.get(sym)
    if (position === 'L') {
      const totalShares = current.sharesLong + shares
      const avgLongPrice = (current.sharesLong * current.avgLongPrice + shares * price) / totalShares
      this.sim.set(sym, { ...current, sharesLong: totalShares, avgLongPrice })
    }
    else {
      const totalShares = current.sharesShort + shares
      const avgShortPrice = (current.sharesShort * current.avgShortPrice + shares * price) / totalShares
      this.sim.set(sym, { ...current, sharesShort: totalShares, avgShortPrice })
    }
  }

  /**
   * Always a full exit (tryExit never partially sells), so this just
   * zeroes out the side that closed. `proceeds` is the getSaleGain value
   * the caller already computed for its own P&L check.
   */
  recordSell(sym: string, position: 'L' | 'S', proceeds: number): void {
    if (!this.dryRun)
      return
    this.simCash += proceeds
    const current = this.get(sym)
    this.sim.set(sym, position === 'L'
      ? { ...current, sharesLong: 0, avgLongPrice: 0 }
      : { ...current, sharesShort: 0, avgShortPrice: 0 })
  }
}

/**
 * The real short-sell gate (checkSFAccess(ctx, 2) in the game's own source)
 * is `bitNodeN === 8 || activeSourceFileLvl(8) >= 2` - getResetInfo exposes
 * both halves directly, and unlike Singularity functions isn't RAM-gated,
 * so this is a plain, side-effect-free check rather than a probe trade.
 */
function canShort(ns: NS): boolean {
  const info = ns.getResetInfo()
  return info.currentNode === 8 || (info.ownedSF.get(8) ?? 0) >= 2
}

/**
 * Real liquidation value of one position - what getSaleGain would return
 * for actually closing it right now, not a naive shares*price estimate.
 * getSaleGain is a pure calculation over the shares/position passed in
 * (not the player's real holdings), so this is exactly as accurate against
 * a --dry-run simulated position as a real one.
 */
function positionValue(ns: NS, pos: Position): number {
  let value = 0
  if (pos.sharesLong > 0)
    value += ns.stock.getSaleGain(pos.sym, pos.sharesLong, 'L')
  if (pos.sharesShort > 0)
    value += ns.stock.getSaleGain(pos.sym, pos.sharesShort, 'S')
  return value
}

function portfolioValue(ns: NS, symbols: string[], book: PositionBook): number {
  let value = book.getCash()
  for (const sym of symbols)
    value += positionValue(ns, book.get(sym))
  return value
}

/**
 * Warm-starts `window` from stock-stats.txt, discarding anything from
 * before this life's last reset - a prior life's price levels are
 * meaningless here (see this project's own stock-stats.txt analysis: same
 * symbols/starting metadata every life, but a fresh random walk each time).
 */
function warmStart(ns: NS, window: PriceWindow, symbols: string[]) {
  if (!ns.fileExists(STOCK_STATS_LOG_FILE))
    return

  const info = ns.getResetInfo()
  const cutoff = Math.max(info.lastAugReset, info.lastNodeReset)
  const entries = parseStockStatsLog(ns.read(STOCK_STATS_LOG_FILE))
    .filter(e => e.ts > cutoff)
    .slice(-(WINDOW_TICKS + 1))

  for (const sym of symbols) {
    const mids = entries
      .filter(e => sym in e.prices)
      .map(e => (e.prices[sym].ask + e.prices[sym].bid) / 2)
    if (mids.length > 0)
      window.seed(sym, mids)
  }
}

function logTrade(
  ns: NS,
  symbols: string[],
  book: PositionBook,
  sym: string,
  action: 'buy' | 'sell' | 'buyShort' | 'sellShort',
  shares: number,
  price: number,
  signal: TradeSignal,
  dryRun: boolean,
  reason: 'entry' | 'signal-reversed' | 'stop-loss',
) {
  recordTraderEvent(ns, {
    type: 'trade',
    cash: book.getCash(),
    portfolioValue: portfolioValue(ns, symbols, book),
    symbol: sym,
    action,
    shares,
    price,
    // An exit can fire on a neutral signal (direction === null just means
    // "no longer matches the held position's side either") - the schema's
    // direction field is a plain string, so normalize null to a label here
    // rather than threading null through tiny-schema.
    signal: { direction: signal.direction ?? 'neutral', strength: signal.strength },
    reason,
    dryRun,
  })
}

/**
 * Exits (or would-exit, in --dry-run) one held position if its signal has
 * reversed or its unrealized P&L has breached STOP_LOSS_PCT. Returns
 * whether a trade happened.
 */
function tryExit(ns: NS, symbols: string[], book: PositionBook, pos: Position, signal: TradeSignal, dryRun: boolean): boolean {
  if (pos.sharesLong > 0) {
    const costBasis = pos.avgLongPrice * pos.sharesLong
    const saleGain = ns.stock.getSaleGain(pos.sym, pos.sharesLong, 'L')
    const unrealizedPct = (saleGain - costBasis) / costBasis
    const reversed = signal.direction !== 'long'
    const stopped = unrealizedPct <= -STOP_LOSS_PCT
    if (reversed || stopped) {
      const price = dryRun ? ns.stock.getBidPrice(pos.sym) : ns.stock.sellStock(pos.sym, pos.sharesLong)
      book.recordSell(pos.sym, 'L', saleGain)
      logTrade(ns, symbols, book, pos.sym, 'sell', pos.sharesLong, price, signal, dryRun, stopped ? 'stop-loss' : 'signal-reversed')
      return true
    }
  }

  if (pos.sharesShort > 0) {
    const costBasis = pos.avgShortPrice * pos.sharesShort
    const saleGain = ns.stock.getSaleGain(pos.sym, pos.sharesShort, 'S')
    const unrealizedPct = (saleGain - costBasis) / costBasis
    const reversed = signal.direction !== 'short'
    const stopped = unrealizedPct <= -STOP_LOSS_PCT
    if (reversed || stopped) {
      const price = dryRun ? ns.stock.getAskPrice(pos.sym) : ns.stock.sellShort(pos.sym, pos.sharesShort)
      book.recordSell(pos.sym, 'S', saleGain)
      logTrade(ns, symbols, book, pos.sym, 'sellShort', pos.sharesShort, price, signal, dryRun, stopped ? 'stop-loss' : 'signal-reversed')
      return true
    }
  }

  return false
}

/**
 * Shares affordable within `budget`, capped by getMaxShares. getPurchaseCost
 * isn't linear (spread + large-order price impact), so the naive
 * budget/price estimate is stepped down until it actually fits.
 */
function affordableShares(ns: NS, sym: string, position: 'L' | 'S', budget: number): number {
  const price = position === 'L' ? ns.stock.getAskPrice(sym) : ns.stock.getBidPrice(sym)
  let shares = Math.min(Math.floor(budget / price), ns.stock.getMaxShares(sym))

  for (let i = 0; i < 5 && shares > 0; i++) {
    const cost = ns.stock.getPurchaseCost(sym, shares, position)
    if (cost <= budget)
      break
    shares = Math.floor(shares * (budget / cost))
  }

  return Math.max(0, shares)
}

/**
 * Expected size of a favorable move over a realistic holding period,
 * compared against round-trip cost in the entry edge check below.
 *
 * This has to be scaled to roughly the same horizon a position is
 * actually expected to be held for (signals persist for tens of ticks -
 * see trader/signal.ts's WINDOW_TICKS comment), not a single tick: spread
 * alone runs ~1.2% (this project's stock-stats.txt sample) and per-tick
 * volatility sits in the same ~0.5-2.5% range, so comparing a round-trip
 * cost paid once against a single tick's expected move made the edge
 * check nearly unsatisfiable regardless of signal quality.
 *
 * Momentum already measures a real WINDOW_TICKS-long move directly, so its
 * magnitude is used as-is. The 4S branch only has a per-tick volatility
 * number, so it's scaled to the same horizon via random-walk sqrt(time)
 * scaling.
 */
function expectedMoveFraction(ns: NS, sym: string, has4SData: boolean, window: PriceWindow): number {
  return has4SData
    ? ns.stock.getVolatility(sym) * Math.sqrt(WINDOW_TICKS)
    : window.trailingMoveMagnitude(sym)
}

/**
 * Opens (or would-open, in --dry-run) a position in `sym` if it clears the
 * entry edge check: expected profit at MIN_EDGE_MULTIPLE margin over the
 * round-trip cost (buy now, sell now - spread + commission + price
 * impact, all via getPurchaseCost/getSaleGain) of doing so. Returns
 * whether a trade happened.
 */
function tryEnter(ns: NS, symbols: string[], book: PositionBook, sym: string, signal: TradeSignal, has4SData: boolean, window: PriceWindow, dryRun: boolean): boolean {
  const budget = book.getCash() * POSITION_FRACTION_OF_CASH
  const position: 'L' | 'S' = signal.direction === 'long' ? 'L' : 'S'

  const shares = affordableShares(ns, sym, position, budget)
  if (shares <= 0)
    return false

  const cost = ns.stock.getPurchaseCost(sym, shares, position)
  const roundTripCost = cost - ns.stock.getSaleGain(sym, shares, position)
  const expectedProfit = cost * expectedMoveFraction(ns, sym, has4SData, window)
  if (roundTripCost <= 0 || expectedProfit < MIN_EDGE_MULTIPLE * roundTripCost)
    return false

  const action = position === 'L' ? 'buy' : 'buyShort'
  const price = dryRun
    ? (position === 'L' ? ns.stock.getAskPrice(sym) : ns.stock.getBidPrice(sym))
    : (position === 'L' ? ns.stock.buyStock(sym, shares) : ns.stock.buyShort(sym, shares))

  // A live purchase can still fail (price moved, funds changed) between
  // the check above and the call - 0 means nothing was actually bought.
  if (!dryRun && price === 0)
    return false

  book.recordBuy(sym, position, shares, price, cost)
  logTrade(ns, symbols, book, sym, action, shares, price, signal, dryRun, 'entry')
  return true
}

export async function main(ns: NS) {
  ns.disableLog('ALL')
  noDupe(ns)

  const flags = parseArgs(ns, [
    arg('dry-run', false, 'Log intended trades without executing them', 'd'),
  ])
  const dryRun = Boolean(flags['dry-run'])

  // Same auto-purchase gate as stock-stats.app.ts - see its own comment for
  // why this covers both "buy it" and "confirm we already have it".
  if (!ns.stock.purchaseTixApi()) {
    const cost = ns.stock.getConstants().TixApiCost
    const money = ns.getPlayer().money
    ns.tprint(`ERROR: trader needs TIX API access and the automatic purchase failed - need ${formatMoney(cost)}, have ${formatMoney(money)}.`)
    return
  }

  const symbols = ns.stock.getSymbols()
  const has4SData = ns.stock.has4SDataTixApi()
  const shortAllowed = canShort(ns)
  const book = new PositionBook(ns, dryRun)

  const window = new PriceWindow()
  warmStart(ns, window, symbols)

  const sessionStartValue = portfolioValue(ns, symbols, book)
  let halted = false

  ns.tprint(
    `Started${dryRun ? ' (dry-run)' : ''} - ${symbols.length} symbols, `
    + `4S=${has4SData}, shorting=${shortAllowed}, baseline=${formatMoney(sessionStartValue)}.`,
  )

  while (true) {
    await ns.stock.nextUpdate()
    recordStockTick(ns, collectPrices(ns, has4SData))

    try {
      for (const sym of symbols)
        window.push(sym, (ns.stock.getAskPrice(sym) + ns.stock.getBidPrice(sym)) / 2)

      let tradedThisTick = false

      // Exits first, so a position that closes this tick can free a slot
      // an entry considers later in the same tick.
      for (const sym of symbols) {
        const pos = book.get(sym)
        if (pos.sharesLong === 0 && pos.sharesShort === 0)
          continue
        const signal = getSignal(ns, sym, has4SData, window)
        if (tryExit(ns, symbols, book, pos, signal, dryRun))
          tradedThisTick = true
      }

      // Circuit breaker: halts new entries (never exits/stop-losses) once
      // the session's cumulative drawdown crosses MAX_DRAWDOWN_PCT, and
      // un-halts if it recovers.
      const currentValue = portfolioValue(ns, symbols, book)
      const drawdown = (sessionStartValue - currentValue) / sessionStartValue
      if (!halted && drawdown >= MAX_DRAWDOWN_PCT) {
        halted = true
        ns.tprint(`WARNING: trader halted - portfolio down ${(drawdown * 100).toFixed(1)}% from session start (${formatMoney(sessionStartValue)} -> ${formatMoney(currentValue)}). New entries stopped; existing positions still managed.`)
        recordTraderEvent(ns, { type: 'halt', cash: book.getCash(), portfolioValue: currentValue })
      }
      else if (halted && drawdown < MAX_DRAWDOWN_PCT) {
        halted = false
        ns.tprint(`Trader resumed - portfolio recovered to ${formatMoney(currentValue)}.`)
        recordTraderEvent(ns, { type: 'resume', cash: book.getCash(), portfolioValue: currentValue })
      }

      if (!halted) {
        const openSymbols = new Set(
          symbols.filter((sym) => {
            const pos = book.get(sym)
            return pos.sharesLong > 0 || pos.sharesShort > 0
          }),
        )
        const openSlots = MAX_CONCURRENT_POSITIONS - openSymbols.size

        if (openSlots > 0) {
          const candidates: { sym: string, signal: TradeSignal }[] = []
          for (const sym of symbols) {
            if (openSymbols.has(sym))
              continue
            const signal = getSignal(ns, sym, has4SData, window)
            if (signal.direction === null)
              continue
            if (signal.direction === 'short' && !shortAllowed)
              continue
            candidates.push({ sym, signal })
          }
          candidates.sort((a, b) => b.signal.strength - a.signal.strength)

          for (const { sym, signal } of candidates.slice(0, openSlots)) {
            if (tryEnter(ns, symbols, book, sym, signal, has4SData, window, dryRun))
              tradedThisTick = true
          }
        }
      }

      if (!tradedThisTick) {
        recordTraderEvent(ns, {
          type: 'snapshot',
          cash: book.getCash(),
          portfolioValue: portfolioValue(ns, symbols, book),
        })
      }
    }
    catch (error) {
      // One bad tick (e.g. a transient ns.stock error) must not kill the
      // whole daemon and abandon open positions unmanaged.
      ns.print(`ERROR during tick: ${String(error)}`)
    }
  }
}
