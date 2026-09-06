import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

/**
 * Generic weaken() worker. See `hack.daemon.ts`'s header comment for the
 * shared `host`/`delay`/`threads`/`--once`/`--port` argument shape.
 *
 * weaken()'s own return value already *is* the exact security reduced by
 * this call — no analyze call needed at all, so `--port`'s payload here is
 * free beyond `ns.writePort` itself (0 GB). `money` is omitted (weaken has
 * none).
 */
export async function main(ns: NS) {
  const flags = parseArgs(ns, [
    { long: 'once', defaultValue: false, description: 'Run a single weaken() call after the delay, then exit, instead of looping forever.' },
    { long: 'port', defaultValue: 0, description: 'If >0, write a status object to this port after each completed weaken().' },
  ] as const, [
    { name: 'host', description: 'What is the target of the growth' },
    { name: 'delay', description: 'Delay before each growth' },
    { name: 'threads', description: 'Number of threads for stats', optional: true },
  ])
  const host = flags.host as string
  const delay = flags.delay as number
  const threads = (flags.threads as number) || 1

  do {
    if (delay > 0)
      await ns.sleep(delay)
    const startedAt = Date.now()
    const securityReduced = await ns.weaken(host)
    if (flags.port > 0) {
      ns.writePort(flags.port, {
        action: 'weaken',
        target: host,
        threads,
        duration: Date.now() - startedAt,
        deltaSecurity: -securityReduced,
      })
    }
  } while (!flags.once)
}
