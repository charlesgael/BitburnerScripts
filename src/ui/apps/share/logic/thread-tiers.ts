/**
 * 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, ... (each doubling split at its
 * midpoint) up to (and including) maxThreads itself, so "give everything
 * currently shareable" is always the last option. Empty if there isn't even
 * enough shareable RAM for a single thread.
 */
export function threadTiers(maxThreads: number): number[] {
  if (maxThreads < 1)
    return []
  const tiers: number[] = [1]
  for (let pow = 2; pow < maxThreads; pow *= 2) {
    tiers.push(pow)
    const mid = pow * 1.5
    if (mid < maxThreads)
      tiers.push(mid)
  }
  tiers.push(maxThreads)
  return Array.from(new Set(tiers)).sort((a, b) => a - b)
}
