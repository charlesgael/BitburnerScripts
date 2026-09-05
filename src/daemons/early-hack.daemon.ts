import type { NS } from '@ns'

export async function main(ns: NS) {
  // Target server, passed as the first positional arg (falls back to "foodnstuff" if none given)
  const target = (ns.args[0] as string) || 'foodnstuff'

  // Defines the thresholds for money and security
  const moneyThresh = ns.getServerMaxMoney(target) * 0.75
  const securityThresh = ns.getServerMinSecurityLevel(target) + 5

  // Infinite loop keeps the script running forever
  while (true) {
    if (ns.getServerSecurityLevel(target) > securityThresh) {
      // If security is too high, weaken it
      await ns.weaken(target)
    }
    else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
      // If money is too low, grow it
      await ns.grow(target)
    }
    else {
      // If security is low and money is high, steal it!
      await ns.hack(target)
    }
  }
}
