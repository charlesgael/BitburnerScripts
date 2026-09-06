import type { NS } from '@ns'
import { pickTarget } from './daemons/xp-farm.daemon'
import { XP_FARM_WEAKEN_SCRIPT } from './ui/utils/xp-farm-config'

const MIN_RESERVED_RAM_GB = 5
const RESERVED_RAM_FRACTION = 0.2

export async function main(ns: NS) {
  const homeRam = ns.getServerMaxRam('home')
  const usedRam = ns.getServerUsedRam('home')
  const reserved = Math.max(MIN_RESERVED_RAM_GB, homeRam * RESERVED_RAM_FRACTION)
  const freeRam = homeRam - usedRam - reserved

  const weakRam = ns.getScriptRam(XP_FARM_WEAKEN_SCRIPT)
  const threads = Math.floor(freeRam / weakRam)

  if (threads) {
    const target = pickTarget(ns)
    if (!target) {
      ns.tprint('ERROR: Could not pick target')
      return
    }
    const pid = ns.run(XP_FARM_WEAKEN_SCRIPT, threads, target)

    ns.atExit(() => ns.kill(pid))
  }

  while (true)
    await ns.sleep(100000000)
}
