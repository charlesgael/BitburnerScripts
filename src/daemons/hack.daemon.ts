import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

// hack()'s own docs state this exactly: "A successful hack() on a server
// will raise that server's security level by 0.002 per thread" — unlike
// grow's equivalent, this has no `cores` dependency, so it's a genuine
// fixed constant safe to hardcode here rather than pay for
// ns.hackAnalyzeSecurity per thread (1GB, referenced-cost multiplies by
// however many threads this script runs with — see grow.daemon.ts's
// comment for why *its* security effect can't be hardcoded the same way).
const HACK_SECURITY_PER_THREAD = 0.002

/**
 * Generic hack() worker. Args (positional, after any flags — see
 * `utils/args.ts`'s own convention): `host` (target), `delay` (ms to sleep
 * before each call), `threads` (this process's own thread count, passed by
 * the caller — free, since it already knows it — rather than paying for
 * `ns.getRunningScript()` here). `--once` runs a single hack() after the
 * delay and exits instead of looping forever — used by
 * `daemons/money-farm.daemon.ts` to launch one leg of a precisely-timed
 * HWGW batch; omitted (the default) by continuous callers
 * (`flooder.app.ts`, and `money-farm.daemon.ts`'s own prep-mode loops).
 *
 * `--port <n>`: if set, writes `{action:'hack', target, threads, duration,
 * money, deltaSecurity}` to that Netscript port after each completed
 * hack() — `money`/`deltaSecurity` are hack's own free direct-return-value/
 * hardcoded-constant, so this costs nothing beyond `ns.writePort` (0 GB).
 * See `daemons/money-farm.daemon.ts`'s port-drain logic for the reader
 * side.
 */
export async function main(ns: NS) {
  const flags = parseArgs(ns, [
    { long: 'once', defaultValue: false, description: 'Run a single hack() call after the delay, then exit, instead of looping forever.' },
    { long: 'port', defaultValue: 0, description: 'If >0, write a status object to this port after each completed hack().' },
  ] as const)
  const host = flags._[0] as string
  const delay = flags._[1] as number
  const threads = (flags._[2] as number) || 1

  do {
    if (delay > 0)
      await ns.sleep(delay)
    const startedAt = Date.now()
    const money = await ns.hack(host)
    if (flags.port > 0) {
      ns.writePort(flags.port, {
        action: 'hack',
        target: host,
        threads,
        duration: Date.now() - startedAt,
        money,
        deltaSecurity: threads * HACK_SECURITY_PER_THREAD,
      })
    }
  } while (!flags.once)
}
