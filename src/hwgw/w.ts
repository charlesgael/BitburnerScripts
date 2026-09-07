import type { NS } from '@ns'

export async function main(ns: NS) {
  const [target, loopTime = 0, delay = 0] = ns.args as [string | undefined, number | undefined, number | undefined]

  const doLoop = loopTime > 0
  const execTime = ns.getWeakenTime(target)
  const sleepBefore = doLoop ? loopTime - execTime : 0

  if (delay)
    await ns.sleep(delay)

  do {
    await ns.sleep(sleepBefore)
    await ns.weaken(target)
  } while (doLoop) // eslint-disable-line no-unmodified-loop-condition
}
