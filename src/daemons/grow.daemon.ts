import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

/**
 * Generic grow() worker. See `hack.daemon.ts`'s header comment for the
 * shared `host`/`delay`/`--once` argument shape.
 */
export async function main(ns: NS) {
  const flags = parseArgs(ns, [
    { long: 'once', defaultValue: false, description: 'Run a single grow() call after the delay, then exit, instead of looping forever.' },
  ] as const)
  const host = flags._[0] as string
  const delay = flags._[1] as number

  do {
    if (delay > 0)
      await ns.sleep(delay)
    await ns.grow(host)
  } while (!flags.once)
}
