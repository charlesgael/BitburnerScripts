import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

const HACK_SECURITY_PER_THREAD = 0.002

export async function main(ns: NS) {
  // We pass money and security as params to keep the RAM cost low
  const args = parseArgs(ns, [
    { long: 'money', defaultValue: 1, description: 'Max money of the server', short: 'm' },
    { long: 'security', defaultValue: 1, description: 'Minimum security of the server', short: 's' },
    { long: 'port', defaultValue: 0, description: 'Minimum security of the server', short: 'p' },
  ] as const, [
    { name: 'target', description: 'What is the target to hack', optional: true },
    { name: 'threads', description: 'Number of threads for statistics', optional: true },
  ])
  // Target server, passed as the first positional arg (falls back to "foodnstuff" if none given)
  const target = (args.target as string) || 'foodnstuff'
  const threads = (args.threads as number) || 1

  // Defines the thresholds for money and security
  const moneyThresh = args.money * 0.75
  const securityThresh = args.security + 5

  // Infinite loop keeps the script running forever
  while (true) {
    const startedAt = Date.now()
    if (ns.getServerSecurityLevel(target) > securityThresh) {
      // If security is too high, weaken it
      const s = await ns.weaken(target)
      if (args.port > 0) {
        ns.writePort(args.port, {
          action: 'weaken',
          target,
          threads,
          duration: Date.now() - startedAt,
          deltaSecurity: -s,
        })
      }
    }
    else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
      // If money is too low, grow it
      const g = await ns.grow(target)
      if (args.port > 0) {
        ns.writePort(args.port, {
          action: 'grow',
          target,
          threads,
          duration: Date.now() - startedAt,
          growth: g,
        })
      }
    }
    else {
      // If security is low and money is high, steal it!
      const m = await ns.hack(target)
      if (args.port > 0) {
        ns.writePort(args.port, {
          action: 'hack',
          target,
          threads,
          duration: Date.now() - startedAt,
          money: m,
          deltaSecurity: threads * HACK_SECURITY_PER_THREAD,
        })
      }
    }
  }
}
