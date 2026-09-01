import type { NS } from '@ns'
import { parseArgs } from '../utils/args' // cpy

/**
 * Generic grow() worker. See `hack.daemon.ts`'s header comment for the
 * shared `host`/`delay`/`threads`/`--once`/`--port` argument shape.
 *
 * Unlike hack's, grow's security effect (`ns.growthAnalyzeSecurity`) takes
 * a `cores` parameter — it's not a pure per-thread constant, so it can't
 * be safely hardcoded here the way hack's 0.002/thread is, and computing
 * it via `ns.growthAnalyzeSecurity` in this script would cost 1GB
 * per thread* (referenced-cost multiplies by however many threads this
 * process runs with). So `--port`'s payload here omits both `deltaSecurity`
 * (left for `daemons/money-farm.daemon.ts` to fill in via one
 * `growthAnalyzeSecurity(threads)` call on its own side, where the cost is
 * paid once, not per thread) and `money` (grow's own return value is a
 * multiplier, not a dollar amount, and computing a precise dollar figure
 * would need the server's money at the instant *this* call landed —
 * unreliable with other batches concurrently landing on the same target).
 */
export async function main(ns: NS) {
  const flags = parseArgs(ns, [
    { long: 'once', defaultValue: false, description: 'Run a single grow() call after the delay, then exit, instead of looping forever.' },
    { long: 'port', defaultValue: 0, description: 'If >0, write a status object to this port after each completed grow().' },
  ] as const)
  const host = flags._[0] as string
  const delay = flags._[1] as number
  const threads = (flags._[2] as number) || 1

  do {
    if (delay > 0)
      await ns.sleep(delay)
    const startedAt = Date.now()
    const growth = await ns.grow(host)
    if (flags.port > 0) {
      ns.writePort(flags.port, {
        action: 'grow',
        target: host,
        threads,
        duration: Date.now() - startedAt,
        growth,
      })
    }
  } while (!flags.once)
}
