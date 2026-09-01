import type { NS } from '@ns'

/**
 * Splits `totalThreads` between weaken and grow so that, cycle over cycle,
 * weaken's security decrease roughly matches grow's security increase —
 * computed from the actual live multipliers rather than a hardcoded ratio,
 * so it stays correct across BitNodes/augmentations that alter them.
 *
 * Lives in `daemons/xp-farm.daemon.ts` (its original home), whose own
 * `claim()` is the only remaining caller — `daemons/money-farm.daemon.ts`'s
 * `applyPrepMode` used this too for a while, but moved to sizing grow/weaken
 * threads off the *actual* security/money gap that needs closing
 * (`computeHackMath`'s `growThreadsFor` plus a direct `weakenAnalyze`-based
 * calculation) instead of a steady-state ratio over pooled capacity — see
 * that function's own header comment for why capacity-based sizing turned
 * out to waste most of a large fleet's dispatched threads once capacity
 * routinely exceeded what a target actually needed.
 *
 * The ratio here is balanced *per unit time*, not per action:
 * `weakenAnalyze(1)`/`growthAnalyzeSecurity(1)` alone only balance security
 * effect per single completed action, but a continuous grow loop completes
 * more often per unit time than a continuous weaken loop does (`growTime <
 * weakenTime` always) — so a per-action-balanced split still nets security
 * upward over time, since grow's higher completion cadence outweighs its
 * smaller per-action effect. Scaling the per-action ratio by `growTime /
 * weakenTime` corrects for that cadence difference, so the split holds
 * security flat in steady state instead of needing a periodic weaken-only
 * correction — confirmed live as the cause of a real sawtooth pattern in
 * money-farm's own `grow-prep` mode, back when it still used this. Harmless
 * for XP Farm's own use: its actual goal is just running grow/weaken as
 * fast as possible regardless of the exact split, so a more accurate
 * balance can only help, never hurt, its throughput.
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
 *
 * Known caveat, not yet fixed here: if `categoryTotal` exceeds the sum of
 * every host's capacity, this does *not* clamp each host to its own
 * capacity — every host's proportional `share` scales up to still sum to
 * the requested `categoryTotal` (e.g. capacity `{A:10, B:5}` with
 * `categoryTotal=30` returns `{A:20, B:10}` — the sum matches exactly, but
 * `A` was only ever able to run 10). The caller can't detect this by
 * checking the returned sum against what it asked for, since that sum is
 * correct even though an individual host's share isn't — a check like
 * `tryDispatchBatch`'s `sumValues(...) < plan.hackThreads` will *not*
 * catch it; the later `ns.exec` for that host just fails silently (`0`
 * threads actually launched), and `tryDispatchBatch` currently has no
 * follow-up check that notices. `money-farm.daemon.ts`'s `allocateNeeded`
 * sidesteps this by capping `needed` to total capacity itself before ever
 * calling here — every other caller needs the same discipline until this
 * function clamps per-host internally, which would be the more robust
 * general fix.
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
