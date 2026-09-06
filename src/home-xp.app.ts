import type { NS } from '@ns'
import { pickTarget } from './daemons/xp-farm.daemon'
import { XP_FARM_WEAKEN_SCRIPT } from './ui/utils/xp-farm-config'
import { noDupe } from './utils/ns/nodupe'

const MIN_RESERVED_RAM_GB = 5
const RESERVED_RAM_FRACTION = 0.2

export async function main(ns: NS) {
  ns.disableLog('ALL')
  noDupe(ns)

  const homeRam = ns.getServerMaxRam('home')
  const usedRam = ns.getServerUsedRam('home')
  const reserved = Math.max(MIN_RESERVED_RAM_GB, homeRam * RESERVED_RAM_FRACTION)
  const freeRam = homeRam - usedRam - reserved

  const weakRam = ns.getScriptRam(XP_FARM_WEAKEN_SCRIPT)
  const threads = Math.floor(freeRam / weakRam)
  let currentTarget: string | null = null
  let pid: number = 0

  if (threads) {
    // This app only ever dispatches a weaken-only loop itself (below), so
    // every candidate is scored under that same model — see pickTarget's
    // own header comment for why this differs from xp-farm.daemon.ts's
    // own call, which mixes grow/weaken unless money-farm holds a target.
    const target = pickTarget(ns, () => true)
    if (!target) {
      ns.tprint('ERROR: Could not pick target')
      return
    }
    if (target !== currentTarget) {
      if (pid)
        ns.kill(pid)
      ns.print(`New target: ${target}`)
      pid = ns.run(XP_FARM_WEAKEN_SCRIPT, threads, target)
      currentTarget = target
    }

    ns.atExit(() => ns.kill(pid))
  }

  while (true)
    await ns.sleep(600_000)
}
