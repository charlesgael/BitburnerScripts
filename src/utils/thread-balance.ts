import type { NS } from '@ns'

/**
 * The weaken:grow thread ratio that holds `target`'s security flat in
 * steady state — factored out of `splitGrowWeakenThreads` below so a
 * caller that only wants the *ratio* (to estimate an expected completion
 * rate, say) isn't forced to fake a `totalThreads` value to get one.
 * `xp-farm.daemon.ts`'s `pickTarget` is exactly that caller: it needs this
 * same ratio to rank targets by realistic XP/sec, not just to size an
 * actual dispatch.
 *
 * Balanced *per unit time*, not per action: `weakenAnalyze(1)`/
 * `growthAnalyzeSecurity(1)` alone only balance security effect per single
 * completed action, but a continuous grow loop completes more often per
 * unit time than a continuous weaken loop does (`growTime < weakenTime`
 * always) — so a per-action-balanced split still nets security upward over
 * time, since grow's higher completion cadence outweighs its smaller
 * per-action effect. Scaling the per-action ratio by `growTime / weakenTime`
 * corrects for that cadence difference, so the split holds security flat in
 * steady state instead of needing a periodic weaken-only correction —
 * confirmed live as the cause of a real sawtooth pattern in money-farm's
 * own `grow-prep` mode, back when it still used this.
 */
export function growWeakenRatio(ns: NS, target: string): number {
  const weakenPerThread = ns.weakenAnalyze(1)
  const growPerThread = ns.growthAnalyzeSecurity(1)
  let ratio = growPerThread > 0 ? weakenPerThread / growPerThread : 12.5

  const growTime = ns.getGrowTime(target)
  const weakenTime = ns.getWeakenTime(target)
  if (growTime > 0 && weakenTime > 0)
    ratio *= growTime / weakenTime

  return ratio
}

/**
 * Splits `totalThreads` between weaken and grow using `growWeakenRatio`
 * above so that, cycle over cycle, weaken's security decrease roughly
 * matches grow's security increase — computed from the actual live
 * multipliers rather than a hardcoded ratio, so it stays correct across
 * BitNodes/augmentations that alter them.
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
 * Harmless for XP Farm's own use: its actual goal is just running
 * grow/weaken as fast as possible regardless of the exact split, so a more
 * accurate balance can only help, never hurt, its throughput.
 */
export function splitGrowWeakenThreads(ns: NS, totalThreads: number, target: string): { growThreads: number, weakenThreads: number } {
  if (totalThreads <= 1)
    return { growThreads: 0, weakenThreads: totalThreads }
  const ratio = growWeakenRatio(ns, target)
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

/** Sums a `Record<string, number>`'s own values — e.g. thread counts across hosts. */
export function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, v) => sum + v, 0)
}

/**
 * Converts `ramSource` (GB, mutated in place — decremented by whatever this
 * category consumes) into per-host thread counts for one category, using
 * `scriptRam` as that category's own script cost. Sequential calls against
 * the same `ramSource`/`hosts` (e.g. hack, then grow, then weaken1, then
 * weaken2) correctly account for RAM already claimed by an earlier
 * category. Shared by `money-farm.daemon.ts` and `steady-farm.daemon.ts` —
 * originally lived in the former alone, moved here once the latter needed
 * the identical capacity-to-threads conversion rather than duplicating it.
 */
export function allocateCategory(
  ramSource: Record<string, number>,
  hosts: string[],
  scriptRam: number,
  threadsNeeded: number,
): Record<string, number> {
  const capacity: Record<string, number> = {}
  for (const host of hosts)
    capacity[host] = scriptRam > 0 ? Math.floor(ramSource[host] / scriptRam) : 0
  const assigned = distributeThreads(hosts, capacity, threadsNeeded)
  for (const [host, threads] of Object.entries(assigned))
    ramSource[host] -= threads * scriptRam
  return assigned
}

/**
 * `allocateCategory`, but caps `needed` to what `hosts` can actually run
 * before calling it — `distributeThreads` doesn't clamp per-host beyond a
 * host's own capacity when the requested total exceeds pooled capacity (see
 * that function's own "Known caveat" paragraph above). Needed by any caller
 * sizing to actual need rather than to capacity, where that mismatch is
 * expected and must be capped, not treated as an error.
 */
export function allocateNeeded(
  ramSource: Record<string, number>,
  hosts: string[],
  scriptRam: number,
  needed: number,
): Record<string, number> {
  const capacity: Record<string, number> = {}
  for (const host of hosts)
    capacity[host] = scriptRam > 0 ? Math.floor(ramSource[host] / scriptRam) : 0
  const totalCapacity = hosts.reduce((sum, h) => sum + capacity[h], 0)
  return allocateCategory(ramSource, hosts, scriptRam, Math.min(needed, totalCapacity))
}
