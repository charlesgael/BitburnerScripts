import type { NS } from '@ns'
import { recordStockTick } from './stock-stats/state-file'
import { formatMoney } from './utils/format/game'

/**
 * Background collector for `ui/apps/`-adjacent stock trading work (not yet
 * built): every stock-market tick, records every tradable symbol's ask/bid
 * to `log/stock-stats.txt` (see `stock-stats/state-file/`). Raw price
 * history only - no volatility/trend/stddev computed here, that happens
 * later against a downloaded copy of the log.
 *
 * Standalone script with unrestricted `ns` (like `hacknet.app.ts`), not
 * routed through the tiered `cgd` daemon - see the RAM-cost model section
 * in CLAUDE.md for why that distinction exists and why it doesn't apply
 * here (this never runs alongside `ui.app.js`).
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function collectPrices(ns: NS): Record<string, { ask: number, bid: number }> {
  const prices: Record<string, { ask: number, bid: number }> = {}
  for (const sym of ns.stock.getSymbols()) {
    prices[sym] = {
      ask: round2(ns.stock.getAskPrice(sym)),
      bid: round2(ns.stock.getBidPrice(sym)),
    }
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

  ns.print('Started. Sampling every stock market tick.')
  while (true) {
    await ns.stock.nextUpdate()
    recordStockTick(ns, collectPrices(ns))
  }
}
