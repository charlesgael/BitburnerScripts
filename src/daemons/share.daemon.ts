import type { NS } from '@ns'

/**
 * Repeatedly calls ns.share() to boost reputation gain from faction work
 * (applies to all factions, for as long as this keeps running).
 *
 * Split out of the sidebar Share app (`ui/apps/share/`) for the same
 * reason as `daemons/train.daemon.ts`: Bitburner charges a script for every ns.*
 * function it merely *references*, whether or not that code path ever
 * runs. ns.share() alone is 2.4GB — folding it into ui.app.ts (always
 * running) would make that permanent. Here, the cost only applies while a
 * share session is actually active, and — since the Share app launches
 * this with N threads via ns.exec rather than calling ns.share() itself —
 * every thread pays the same fixed cost: 1.6GB (base script overhead, paid
 * by any script) + 2.4GB (ns.share()) = 4GB/thread.
 */
export async function main(ns: NS) {
  ns.disableLog('ALL')
  while (true) {
    await ns.share()
  }
}
