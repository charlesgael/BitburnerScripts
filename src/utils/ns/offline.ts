import type { NS } from '@ns'

export async function isOfflineTime(ns: NS, sleepDuration = 1000): Promise<boolean> {
  const beginTime = Date.now()
  await ns.sleep(sleepDuration)
  const currentRealTime = Date.now()
  const realTimeElapsed = currentRealTime - beginTime
  if (realTimeElapsed < sleepDuration * 0.5)
    return true
  return false
}

export async function exitIfOffline(ns: NS): Promise<void> {
  if (await isOfflineTime(ns)) {
    ns.print(`Offline time detected, this script will exit`)
    ns.exit()
  }
}
