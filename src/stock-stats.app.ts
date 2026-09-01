import type { NS } from '@ns'
import type { StockPrice } from './stock-stats/state-file/types'
import { recordStockTick } from './stock-stats/state-file'
import { formatMoney } from './utils/format/game'

/**
 * Background collector for `ui/apps/`-adjacent stock trading work (not yet
 * built): every stock-market tick, records every tradable symbol's ask/bid
 * (plus the game's own forecast/volatility, when 4S Market Data TIX API is
 * owned) to `log/stock-stats.txt` (see `stock-stats/state-file/`). Raw
 * history only - no derived tendencies/stddev computed here, that happens
 * later against a downloaded copy of the log.
 *
 * Standalone script with unrestricted `ns` (like `hacknet.app.ts`), not
 * routed through the tiered `cgd` daemon - see the RAM-cost model section
 * in CLAUDE.md for why that distinction exists and why it doesn't apply
 * here (this never runs alongside `ui.app.js`).
 */

function round(n: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(n * factor) / factor
}

function collectPrices(ns: NS, has4SData: boolean): Record<string, StockPrice> {
  const prices: Record<string, StockPrice> = {}
  for (const sym of ns.stock.getSymbols()) {
    const price: StockPrice = {
      ask: round(ns.stock.getAskPrice(sym)),
      bid: round(ns.stock.getBidPrice(sym)),
    }
    if (has4SData) {
      // 0-1 fractions - 2 decimals (the ask/bid precision) would round
      // away most of the signal, so keep more digits here.
      price.forecast = round(ns.stock.getForecast(sym), 4)
      price.volatility = round(ns.stock.getVolatility(sym), 4)
    }
    prices[sym] = price
  }
  return prices
}

export async function main(ns: NS) {
  ns.disableLog('ALL')

  // purchaseTixApi() is a no-op success if access is already owned, so this
  // covers both "buy it" and "confirm we already have it" in one call. Its
  // only failure mode is insufficient money (no WSE-account precondition,
  // unlike purchase4SMarketData) - report the shortfall rather than just
  // failing silently.
  if (!ns.stock.purchaseTixApi()) {
    const cost = ns.stock.getConstants().TixApiCost
    const money = ns.getPlayer().money
    ns.tprint(`ERROR: stock-stats needs TIX API access and the automatic purchase failed - need ${formatMoney(cost)}, have ${formatMoney(money)}.`)
    return
  }

  // Refuse to run alongside another live instance of this exact script -
  // two copies would interleave writes into the same log file.
  const dupe = ns.ps('home').find(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)
  if (dupe) {
    ns.tprint(`WARNING: ${ns.getScriptName()} is already running (pid ${dupe.pid}) - exiting.`)
    return
  }

  const has4SData = ns.stock.has4SDataTixApi()
  ns.print(`Started. Sampling every stock market tick${has4SData ? ' (with 4S forecast/volatility)' : ''}.`)
  while (true) {
    await ns.stock.nextUpdate()
    recordStockTick(ns, collectPrices(ns, has4SData))
  }
}
