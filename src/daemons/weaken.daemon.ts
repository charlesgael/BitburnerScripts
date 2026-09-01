import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy
// import { formulas } from '../utils/formula-available' // cpy

/**
 * Generic weaken() worker. See `hack.daemon.ts`'s header comment for the
 * shared `host`/`delay`/`--once` argument shape.
 */
export async function main(ns: NS) {
  const flags = parseArgs(ns, [
    { long: 'once', defaultValue: false, description: 'Run a single weaken() call after the delay, then exit, instead of looping forever.' },
  ] as const)
  const host = flags._[0] as string
  const delay = flags._[1] as number

  do {
    if (delay > 0)
      await ns.sleep(delay)
    await ns.weaken(host)
  } while (!flags.once)
}
