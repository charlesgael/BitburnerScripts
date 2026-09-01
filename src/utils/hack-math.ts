import type { NS, Server } from '@ns'
import { formulas } from './formula-available'

/**
 * Point-in-time hacking math for one target, sourced from the Formulas API
 * (`Formulas.exe`) when available, or the base always-available
 * `ns.hackAnalyze*`/`ns.get*Time` functions otherwise. Both branches expose
 * the same shape so callers (`computeBatchPlan` below) never need to
 * branch themselves — this is the "runs with or without Formulas API,
 * guesstimation accepted without" entry point for `money-farm.daemon.ts`.
 */
export interface HackMath {
  hackChance: number
  /** Fraction of `moneyAvailable` stolen by a single hack() thread. */
  hackPercentPerThread: number
  hackTime: number
  growTime: number
  weakenTime: number
  /**
   * Grow threads needed to bring the server from `moneyAfter` up to
   * `moneyTarget`. The Formulas branch simulates that starting point
   * exactly (a mock `Server` with `moneyAvailable` overridden — Formulas'
   * whole advantage over the base NS functions is being able to query a
   * hypothetical state instead of only the server's actual live one). The
   * base-NS branch can't point `ns.growthAnalyze` at a hypothetical
   * starting money at all — it always multiplies whatever the server's
   * actual live* money is right now — so it approximates via the
   * equivalent multiplier (`moneyTarget / moneyAfter`) instead. Accurate
   * as long as live money is reasonably close to `moneyAfter`, which
   * holds for this file's one caller (`computeBatchPlan`, invoked once at
   * farm-mode entry against an already-prepped, near-max-money server).
   */
  growThreadsFor: (moneyAfter: number, moneyTarget: number) => number
}

export function computeHackMath(ns: NS, target: string): HackMath {
  const f = formulas(ns)
  if (f) {
    const server = ns.getServer(target)
    const player = ns.getPlayer()
    return {
      hackChance: f.hacking.hackChance(server, player),
      hackPercentPerThread: f.hacking.hackPercent(server, player),
      hackTime: f.hacking.hackTime(server, player),
      growTime: f.hacking.growTime(server, player),
      weakenTime: f.hacking.weakenTime(server, player),
      growThreadsFor: (moneyAfter, moneyTarget) => {
        const mock: Server = { ...server, moneyAvailable: moneyAfter }
        return f.hacking.growThreads(mock, player, moneyTarget)
      },
    }
  }
  return {
    hackChance: ns.hackAnalyzeChance(target),
    hackPercentPerThread: ns.hackAnalyze(target),
    hackTime: ns.getHackTime(target),
    growTime: ns.getGrowTime(target),
    weakenTime: ns.getWeakenTime(target),
    growThreadsFor: (moneyAfter, moneyTarget) => {
      const multiplier = Math.max(1, moneyTarget / Math.max(moneyAfter, 1))
      return ns.growthAnalyze(target, multiplier)
    },
  }
}

/**
 * Steal this fraction of a target's `moneyMax` per HWGW batch — deliberately
 * conservative so many batches can be safely in flight at once (see
 * `computeBatchPlan`'s `maxConcurrentBatches`) rather than a few large ones;
 * tunable, not derived from any specific source.
 */
export const HACK_FRACTION_PER_BATCH = 0.10

/**
 * Milliseconds between each of a batch's four landings (H, W1, G, W2).
 * Smaller means more batches fit in one `weakenTime` window (higher
 * throughput per GB of RAM) but less safety margin against engine-tick
 * jitter causing a landing to arrive out of order.
 */
export const BATCH_SPACING = 100

/**
 * Upper bound on *cumulative* hack exposure across every batch that could
 * plausibly land close together, as a fraction of `moneyMax`. This is a
 * different failure mode than `maxConcurrentBatches` guards against:
 * `floor(weakenTime / BATCH_SPACING)` only bounds how many batches can be
 * in flight without their *landing order* colliding — it says nothing
 * about how many of those land-order-safe batches might still land within
 * a *tight cluster* of each other in wall-clock time. In practice, RAM
 * availability (not the timing math) usually caps concurrency far below
 * `maxConcurrentBatches`, and every batch that RAM allows tends to get
 * dispatched within a second or two of each other (the dispatch loop
 * tries every `BATCH_SPACING`) — since every batch shares the same fixed
 * per-leg delays, dispatching them close together means their hack legs
 * land close together too. Confirmed live: 9-15 concurrent batches at
 * `HACK_FRACTION_PER_BATCH = 0.10` each landed clustered enough to drain
 * a target from 100% to ~38% money before any of their own compensating
 * grow legs (which only counteract *their own* batch's theft, not any
 * other batch's) could catch up. `computeBatchPlan`'s `maxConcurrentBatches`
 * folds this in directly (`min` of the two caps) so
 * `money-farm.daemon.ts`'s dispatch gate doesn't need a second check.
 */
export const SAFE_TOTAL_HACK_FRACTION = 0.5

export interface BatchPlan {
  hackThreads: number
  growThreads: number
  weaken1Threads: number
  weaken2Threads: number
  /**
   * Sleep-before-acting delay (ms) for each leg, all measured from the
   * same dispatch instant — see `daemons/money-farm.daemon.ts`'s header
   * comment for the derivation. Landing order is always H, W1, G, W2,
   * each `BATCH_SPACING` apart.
   */
  delayHack: number
  delayWeaken1: number
  delayGrow: number
  delayWeaken2: number
  weakenTime: number
  /** Wall-clock ms from dispatch to this batch's last landing (W2). */
  totalDuration: number
  /**
   * How many of these can be safely in flight at once: the smaller of
   * `floor(weakenTime / BATCH_SPACING)` (landing-order safety) and
   * `floor(SAFE_TOTAL_HACK_FRACTION / actualHackFraction)` (cumulative
   * hack-exposure safety) — see `SAFE_TOTAL_HACK_FRACTION`'s own comment
   * for why the second cap is necessary in practice.
   */
  maxConcurrentBatches: number
  /**
   * Actual fraction of `moneyMax` this batch's hack leg steals — may
   * differ slightly from `HACK_FRACTION_PER_BATCH` due to `hackThreads`
   * being rounded up to an integer.
   */
  actualHackFraction: number
}

/**
 * One HWGW batch's thread counts and per-leg delays for `target`, sized to
 * steal `HACK_FRACTION_PER_BATCH` of `moneyMax` and exactly counteract the
 * security/money effect of doing so. Computed once when a target enters
 * farm mode and reused for every subsequent batch — see
 * `money-farm.daemon.ts`'s header comment for why recomputing per-batch
 * isn't necessary (and would be internally inconsistent) as long as
 * security stays pinned near `minDifficulty`.
 */
export function computeBatchPlan(ns: NS, target: string): BatchPlan {
  const hm = computeHackMath(ns, target)
  const server = ns.getServer(target)
  const moneyMax = server.moneyMax ?? 0
  const currentMoney = Math.max(server.moneyAvailable ?? 0, 1)

  const desiredMoney = moneyMax * HACK_FRACTION_PER_BATCH
  const dollarsPerHackThread = hm.hackPercentPerThread * currentMoney
  const hackThreads = Math.max(1, Math.ceil(desiredMoney / Math.max(dollarsPerHackThread, 1)))

  const actualFraction = Math.min(0.99, hm.hackPercentPerThread * hackThreads)
  const moneyAfterHack = currentMoney * (1 - actualFraction)
  const growThreads = Math.max(0, Math.ceil(hm.growThreadsFor(moneyAfterHack, moneyMax)))

  // hackAnalyzeSecurity/growthAnalyzeSecurity/weakenAnalyze take no
  // Server/Player argument beyond an optional capping host — the
  // security delta per thread is a fixed constant, not state-dependent,
  // so these are exact regardless of the Formulas branch above.
  const weakenPerThread = ns.weakenAnalyze(1)
  const weaken1Threads = Math.max(1, Math.ceil(ns.hackAnalyzeSecurity(hackThreads) / weakenPerThread))
  const weaken2Threads = Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads) / weakenPerThread))

  const delayHack = Math.max(0, hm.weakenTime - hm.hackTime)
  const delayWeaken1 = BATCH_SPACING
  const delayGrow = Math.max(0, hm.weakenTime + 2 * BATCH_SPACING - hm.growTime)
  const delayWeaken2 = 3 * BATCH_SPACING

  const landingOrderCap = Math.floor(hm.weakenTime / BATCH_SPACING)
  const hackExposureCap = Math.floor(SAFE_TOTAL_HACK_FRACTION / Math.max(actualFraction, 0.0001))

  return {
    hackThreads,
    growThreads,
    weaken1Threads,
    weaken2Threads,
    delayHack,
    delayWeaken1,
    delayGrow,
    delayWeaken2,
    weakenTime: hm.weakenTime,
    totalDuration: hm.weakenTime + 3 * BATCH_SPACING,
    maxConcurrentBatches: Math.max(1, Math.min(landingOrderCap, hackExposureCap)),
    actualHackFraction: actualFraction,
  }
}
