import type { NS } from '@ns'
import { recordTraderEvent } from './lib/trader/state-file'
import { arg, parseArgs } from './utils/args'
import { formatMoney } from './utils/format/game'
import { noDupe } from './utils/ns/nodupe'

/**
 * One-shot: sells every open real stock position (long and short), for a
 * "cash out before a soft reset" exit strategy - installing augmentations
 * (or a hard reset into a new BitNode) wipes the stock market and all money
 * either way, so a position held at that moment is simply lost unless
 * converted to cash first. Never buys anything (augmentations included) -
 * that stays a manual decision.
 *
 * Live by default: `run stock-liquidator.app.js` sells for real and stops
 * stock-trader.app.js first (see below). Pass --dry-run to only preview
 * what would be sold, for how much, without touching anything real.
 */

const TRADER_SCRIPT = 'stock-trader.app.js'

export async function main(ns: NS) {
  ns.disableLog('ALL')
  noDupe(ns)

  const flags = parseArgs(ns, [
    arg('dry-run', false, 'Preview: print what would be sold and recovered without executing any sells, killing the trading daemon, or writing log entries', 'd'),
  ])
  const dryRun = Boolean(flags['dry-run'])

  // Same auto-purchase gate as stock-trader.app.ts/stock-reader.app.ts -
  // required just to read positions/prices at all, dry-run or not.
  if (!ns.stock.purchaseTixApi()) {
    const cost = ns.stock.getConstants().TixApiCost
    const money = ns.getPlayer().money
    ns.tprint(`ERROR: stock-liquidator needs TIX API access and the automatic purchase failed - need ${formatMoney(cost)}, have ${formatMoney(money)}.`)
    return
  }

  // Stop the trading daemon before selling, so it can't immediately re-buy
  // a symbol this script is in the middle of selling out from under it.
  // Not flag-gated beyond --dry-run itself - leaving it running would
  // defeat the entire point of "get the cash out".
  const traderProcs = ns.ps(ns.getHostname()).filter(p => p.filename === TRADER_SCRIPT)
  if (traderProcs.length > 0) {
    const pids = traderProcs.map(p => p.pid).join(', ')
    if (dryRun) {
      ns.tprint(`DRY-RUN: would stop ${TRADER_SCRIPT} (pid ${pids}) before liquidating.`)
    }
    else {
      for (const proc of traderProcs)
        ns.kill(proc.pid)
      ns.tprint(`Stopped ${TRADER_SCRIPT} (pid ${pids}) before liquidating.`)
    }
  }

  const symbols = ns.stock.getSymbols()
  let totalRecovered = 0
  let soldAny = false

  for (const sym of symbols) {
    const [sharesLong, , sharesShort] = ns.stock.getPosition(sym)
    if (sharesLong === 0 && sharesShort === 0)
      continue
    soldAny = true

    if (sharesLong > 0) {
      const saleGain = ns.stock.getSaleGain(sym, sharesLong, 'L')
      totalRecovered += saleGain
      if (dryRun) {
        ns.tprint(`DRY-RUN: would sell ${sharesLong} long ${sym} for ${formatMoney(saleGain)}`)
      }
      else {
        const price = ns.stock.sellStock(sym, sharesLong)
        ns.tprint(`SOLD ${sharesLong} long ${sym} @ ${formatMoney(price)}/share -> ${formatMoney(saleGain)}`)
        recordTraderEvent(ns, {
          type: 'trade',
          action: 'sell',
          symbol: sym,
          shares: sharesLong,
          price,
          reason: 'liquidation',
          dryRun: false,
          // Both read post-sale player cash rather than an exact running
          // portfolio value - see stock-liquidator plan notes: the final
          // row is exact by construction (nothing left unsold by the time
          // this script exits), and make-stats.ts's round-trip pairing
          // never reads portfolioValue, only symbol/action/price/shares/
          // reason.
          cash: ns.getPlayer().money,
          portfolioValue: ns.getPlayer().money,
        })
      }
    }

    if (sharesShort > 0) {
      const saleGain = ns.stock.getSaleGain(sym, sharesShort, 'S')
      totalRecovered += saleGain
      if (dryRun) {
        ns.tprint(`DRY-RUN: would sell ${sharesShort} short ${sym} for ${formatMoney(saleGain)}`)
      }
      else {
        const price = ns.stock.sellShort(sym, sharesShort)
        ns.tprint(`SOLD ${sharesShort} short ${sym} @ ${formatMoney(price)}/share -> ${formatMoney(saleGain)}`)
        recordTraderEvent(ns, {
          type: 'trade',
          action: 'sellShort',
          symbol: sym,
          shares: sharesShort,
          price,
          reason: 'liquidation',
          dryRun: false,
          cash: ns.getPlayer().money,
          portfolioValue: ns.getPlayer().money,
        })
      }
    }
  }

  if (!soldAny) {
    ns.tprint('Nothing to liquidate - no open positions.')
    return
  }

  ns.tprint(dryRun
    ? `DRY-RUN complete: would recover ${formatMoney(totalRecovered)} total.`
    : `Liquidation complete: recovered ${formatMoney(totalRecovered)} total, cash now ${formatMoney(ns.getPlayer().money)}.`)
}
