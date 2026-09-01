import type { NS } from '@ns'

/**
 * Splits `totalThreads` between weaken and grow so that, cycle over cycle,
 * weaken's security decrease roughly matches grow's security increase —
 * computed from the actual live multipliers rather than a hardcoded ratio,
 * so it stays correct across BitNodes/augmentations that alter them.
 *
 * Extracted from `daemons/xp-farm.daemon.ts` (its original home, still one
 * of its callers for the XP Farm feature itself) so `daemons/money-farm.daemon.ts`
 * can reuse the identical grow-prep logic without duplicating it.
 *
 * The ratio is balanced *per unit time*, not per action: `weakenAnalyze(1)`/
 * `growthAnalyzeSecurity(1)` alone only balance security effect per single
 * completed action, but a continuous grow loop completes more often per
 * unit time than a continuous weaken loop does (`growTime < weakenTime`
 * always) — so a per-action-balanced split still nets security upward over
 * time, since grow's higher completion cadence outweighs its smaller
 * per-action effect. Scaling the per-action ratio by `growTime / weakenTime`
 * corrects for that cadence difference, so the split holds security flat
 * in steady state instead of needing a periodic weaken-only correction —
 * confirmed live as the cause of a real sawtooth pattern in
 * `money-farm.daemon.ts`'s `grow-prep` mode. Harmless for XP Farm's own
 * use (`daemons/xp-farm.daemon.ts`'s `claim()`): its actual goal is just
 * running grow/weaken as fast as possible regardless of the exact split,
 * so a more accurate balance can only help, never hurt, its throughput.
 */
export function splitGrowWeakenThreads(ns: NS, totalThreads: number, target: string): { growThreads: number, weakenThreads: number } {
  if (totalThreads <= 1)
    return { growThreads: 0, weakenThreads: totalThreads }
  const weakenPerThread = ns.weakenAnalyze(1)
  const growPerThread = ns.growthAnalyzeSecurity(1)
  let ratio = growPerThread > 0 ? weakenPerThread / growPerThread : 12.5

  const growTime = ns.getGrowTime(target)
  const weakenTime = ns.getWeakenTime(target)
  if (growTime > 0 && weakenTime > 0)
    ratio *= growTime / weakenTime

  const weakenThreads = Math.min(totalThreads - 1, Math.max(1, Math.round(totalThreads / (ratio + 1))))
  return { growThreads: totalThreads - weakenThreads, weakenThreads }
}

/**
 * Distributes `categoryTotal` threads across `hosts` proportional to each
 * host's own available thread capacity (`hostCapacity`), floor-rounded per
 * host with any rounding leftover dumped on the largest-capacity host
 * (never harmful to over-allocate slightly there, unlike under-allocating
 * a security-critical category). Hosts with zero remaining capacity are
 * skipped entirely.
 *
 * `hostCapacity` must reflect each host's *remaining* (not total)
 * capacity at the moment of the call. `money-farm.daemon.ts` calls this
 * once per category (hack, then grow, then weaken) against the *same*
 * pooled host set, decrementing each host's entry by however many threads
 * that category actually consumed before calling again for the next
 * category — otherwise multiple categories would each see the host's full
 * capacity and jointly over-allocate it.
 */
export function distributeThreads(
  hosts: string[],
  hostCapacity: Record<string, number>,
  categoryTotal: number,
): Record<string, number> {
  const result: Record<string, number> = {}
  if (categoryTotal <= 0)
    return result
  const totalCapacity = hosts.reduce((sum, h) => sum + (hostCapacity[h] ?? 0), 0)
  if (totalCapacity <= 0)
    return result

  let assigned = 0
  let largestHost = hosts[0]
  for (const host of hosts) {
    const capacity = hostCapacity[host] ?? 0
    if (capacity <= 0)
      continue
    if (capacity > (hostCapacity[largestHost] ?? 0))
      largestHost = host
    const share = Math.floor((capacity / totalCapacity) * categoryTotal)
    if (share > 0) {
      result[host] = share
      assigned += share
    }
  }
  const remainder = categoryTotal - assigned
  if (remainder > 0 && (hostCapacity[largestHost] ?? 0) > 0)
    result[largestHost] = (result[largestHost] ?? 0) + remainder
  return result
}
