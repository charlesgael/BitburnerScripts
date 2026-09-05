import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

export async function main(ns: NS) {
  // We pass money and security as params to keep the RAM cost low
  const args = parseArgs(ns, [
    { long: 'money', defaultValue: 1, description: 'Max money of the server', short: 'm' },
    { long: 'security', defaultValue: 1, description: 'Minimum security of the server', short: 's' },
  ] as const)
  // Target server, passed as the first positional arg (falls back to "foodnstuff" if none given)
  const target = (args._[0] as string) || 'foodnstuff'

  // Defines the thresholds for money and security
  const moneyThresh = args.money * 0.75
  const securityThresh = args.security + 5

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
