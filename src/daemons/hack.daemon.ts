import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

/**
 * Generic hack() worker. Args (positional, after any flags — see
 * `utils/args.ts`'s own convention): `host` (target), `delay` (ms to sleep
 * before each call). `--once` runs a single hack() after the delay and
 * exits instead of looping forever — used by `daemons/money-farm.daemon.ts`
 * to launch one leg of a precisely-timed HWGW batch; omitted (the default)
 * by continuous callers (`daemons/xp-farm.daemon.ts` doesn't use this
 * script, but `flooder.app.ts` does, always in continuous mode).
 */
export async function main(ns: NS) {
  const flags = parseArgs(ns, [
    { long: 'once', defaultValue: false, description: 'Run a single hack() call after the delay, then exit, instead of looping forever.' },
  ] as const)
  const host = flags._[0] as string
  const delay = flags._[1] as number

  do {
    if (delay > 0)
      await ns.sleep(delay)
    await ns.hack(host)
  } while (!flags.once)
}
