import type { NS } from '@ns'
import { formatMoney } from './utils/format/game'

type HacknetMultipliers = ReturnType<NS['getHacknetMultipliers']>

class Upgrade {
  constructor(
    public type: string,
    public node: number,
    public cost: number,
    /** Estimated $/s this upgrade adds, on the same scale across all candidates. */
    public gain: number,
    public func: () => void,
    /**
     * Optional override used only for ratio-ranking, e.g. a fresh node's own cheap early
     * upgrades bundled into its purchase decision (see `simulateNodePurchase`). Defaults to
     * `cost`/`gain`, so every other candidate ranks and executes on the same numbers, exactly
     * as before this override existed.
     */
    public rankCost: number = cost,
    public rankGain: number = gain,
  ) {}

  /** $ produced per second, per $ spent. Higher = better payback. */
  get ratio(): number {
    return this.rankCost > 0 ? this.rankGain / this.rankCost : 0
  }
}

/**
 * Hacknet node production, up to the shared (and irrelevant-for-comparison)
 * constant factor of `MoneyGainPerLevel * player production mult`. Only used
 * to compare candidate upgrades against each other, never as an absolute
 * $/s figure - see `productionUnit` below for how an absolute figure is
 * derived from a real node's real production.
 *
 * Verified against the game's own `calculateMoneyGainRate`
 * (https://github.com/bitburner-official/bitburner-src/blob/dev/src/Hacknet/formulas/HacknetNodes.ts,
 * fetched 2026-09-06): `level * MoneyGainPerLevel * 1.035^(ram-1) * (cores+5)/6 * mult *
 * currentNodeMults.HacknetNodeMoney` - this function is exactly that formula with the constant
 * `MoneyGainPerLevel * mult * currentNodeMults.HacknetNodeMoney` factor divided out.
 */
function relativeProduction(level: number, ram: number, cores: number): number {
  return level * 1.035 ** (ram - 1) * ((cores + 5) / 6)
}

/**
 * Hacknet Node cost constants, copied from the game's own source
 * (https://github.com/bitburner-official/bitburner-src/blob/dev/src/Hacknet/data/Constants.ts,
 * fetched 2026-09-06) so a not-yet-purchased node's future upgrade costs can be estimated
 * without owning Formulas.exe. Only the constants `simulatedLevelUpgradeCost`/
 * `simulatedRamUpgradeCost`/`simulatedCoreUpgradeCost` below actually need are kept - node
 * purchase cost itself always comes from the real `ns.hacknet.getPurchaseNodeCost()`, never
 * replicated here.
 *
 * Since this is a hardcoded copy rather than a live read, `costFormulasMatchReality` below
 * cross-checks it every tick against the real `ns.hacknet.get*UpgradeCost` values for an
 * already-owned node, and disables the lookahead (falling back to the pre-existing bare-gain
 * purchase evaluation) the moment they disagree - e.g. if a future game update changes these
 * numbers - instead of silently acting on a stale formula.
 */
const HACKNET_NODE_CONSTANTS = {
  LevelBaseCost: 500,
  UpgradeLevelMult: 1.04,
  RamBaseCost: 30_000,
  UpgradeRamMult: 1.28,
  CoreBaseCost: 500_000,
  UpgradeCoreMult: 1.48,
  MaxLevel: 200,
  MaxRam: 64,
  MaxCores: 16,
}

/** Cost of a single level-up step, replicating `calculateLevelUpgradeCost(startingLevel, 1, costMult)`. */
function simulatedLevelUpgradeCost(startingLevel: number, costMult: number): number {
  if (startingLevel + 1 > HACKNET_NODE_CONSTANTS.MaxLevel)
    return Infinity
  return HACKNET_NODE_CONSTANTS.LevelBaseCost * HACKNET_NODE_CONSTANTS.UpgradeLevelMult ** (startingLevel - 1) * costMult
}

/** Cost of a single RAM-doubling step, replicating `calculateRamUpgradeCost(startingRam, 1, costMult)`. */
function simulatedRamUpgradeCost(startingRam: number, costMult: number): number {
  if (startingRam * 2 > HACKNET_NODE_CONSTANTS.MaxRam)
    return Infinity
  const numUpgrades = Math.round(Math.log2(startingRam))
  return startingRam * HACKNET_NODE_CONSTANTS.RamBaseCost * HACKNET_NODE_CONSTANTS.UpgradeRamMult ** numUpgrades * costMult
}

/** Cost of a single core step, replicating `calculateCoreUpgradeCost(startingCores, 1, costMult)`. */
function simulatedCoreUpgradeCost(startingCores: number, costMult: number): number {
  if (startingCores + 1 > HACKNET_NODE_CONSTANTS.MaxCores)
    return Infinity
  return HACKNET_NODE_CONSTANTS.CoreBaseCost * HACKNET_NODE_CONSTANTS.UpgradeCoreMult ** (startingCores - 1) * costMult
}

function costMatchesReality(simulated: number, real: number): boolean {
  if (!Number.isFinite(real))
    return true // node already maxed on this stat - nothing meaningful to compare
  if (real === 0)
    return simulated === 0
  return Math.abs(simulated - real) <= real * 1e-6
}

/**
 * Cross-checks the hardcoded cost replicas above against the real, live cost of the same next
 * step on an already-owned node (node 0), reusing values the caller already fetched for it -
 * no extra `ns.*` calls. See `HACKNET_NODE_CONSTANTS`'s comment for why this exists.
 */
function costFormulasMatchReality(
  mults: HacknetMultipliers,
  stats: { level: number, ram: number, cores: number },
  realLevelCost: number,
  realRamCost: number,
  realCoreCost: number,
): boolean {
  return (
    costMatchesReality(simulatedLevelUpgradeCost(stats.level, mults.levelCost), realLevelCost)
    && costMatchesReality(simulatedRamUpgradeCost(stats.ram, mults.ramCost), realRamCost)
    && costMatchesReality(simulatedCoreUpgradeCost(stats.cores, mults.coreCost), realCoreCost)
  )
}

/**
 * Simulates buying a new node and then greedily applying whichever of level/ram/core has the
 * best $/s-per-$ ratio on that hypothetical node, spending up to `budget` total (purchase price
 * included) - the same greedy rule the main loop applies to real upgrades, just walked forward
 * once against a node that doesn't exist yet.
 *
 * This exists because a fresh node's own bootstrap production is always tiny in isolation (see
 * the plain `purchase` candidate below), even though its first several upgrades are the
 * cheapest in the game - comparing the bare bootstrap gain against an already-productive
 * node's next single upgrade step systematically undervalues buying, since it never gives the
 * purchase credit for the cheap upgrades it unlocks. The bundle this returns is what the
 * `purchase` candidate is actually ranked on; the real `ns.hacknet.purchaseNode()` call this
 * tick still only spends `purchaseCost`.
 */
function simulateNodePurchase(
  purchaseCost: number,
  budget: number,
  productionUnit: number,
  mults: HacknetMultipliers,
): { cost: number, gain: number } {
  let level = 1
  let ram = 1
  let cores = 1
  let spent = purchaseCost
  let production = productionUnit * relativeProduction(level, ram, cores)
  let remaining = budget - purchaseCost

  while (remaining > 0) {
    const steps = [
      {
        cost: simulatedLevelUpgradeCost(level, mults.levelCost),
        gain: productionUnit * relativeProduction(level + 1, ram, cores) - production,
        apply: () => { level += 1 },
      },
      {
        cost: simulatedRamUpgradeCost(ram, mults.ramCost),
        gain: productionUnit * relativeProduction(level, ram * 2, cores) - production,
        apply: () => { ram *= 2 },
      },
      {
        cost: simulatedCoreUpgradeCost(cores, mults.coreCost),
        gain: productionUnit * relativeProduction(level, ram, cores + 1) - production,
        apply: () => { cores += 1 },
      },
    ].filter(step => Number.isFinite(step.cost) && step.cost > 0 && step.cost <= remaining)

    if (steps.length === 0)
      break

    steps.sort((a, b) => b.gain / b.cost - a.gain / a.cost)
    const best = steps[0]
    best.apply()
    remaining -= best.cost
    spent += best.cost
    production += best.gain
  }

  return { cost: spent, gain: production }
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  let warnedFormulaDrift = false

  while (true) {
    // Budget cap so a single upgrade never eats the whole bankroll.
    const budget = ns.getPlayer().money * 0.25
    const ownedNodes = ns.hacknet.numNodes()
    const mults = ns.getHacknetMultipliers()

    // Derive $/s per unit of relativeProduction from a real node's real
    // production, so a brand-new node's expected production can be
    // compared against upgrades to existing nodes on the same $/s scale.
    let productionUnit = 0
    let formulasTrusted = true

    const candidates: Upgrade[] = []

    for (let i = 0; i < ownedNodes; i++) {
      const stats = ns.hacknet.getNodeStats(i)
      const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1)
      const ramCost = ns.hacknet.getRamUpgradeCost(i, 1)
      const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1)

      if (i === 0) {
        const relative = relativeProduction(stats.level, stats.ram, stats.cores)
        if (relative > 0)
          productionUnit = stats.production / relative
        formulasTrusted = costFormulasMatchReality(mults, stats, levelCost, ramCost, coreCost)
        if (!formulasTrusted && !warnedFormulaDrift) {
          warnedFormulaDrift = true
          ns.print(`WARNING: hacknet cost-formula replica diverged from live values - falling back to single-step purchase evaluation.`)
        }
      }

      candidates.push(
        new Upgrade(`level`, i, levelCost, stats.production / stats.level, () => ns.hacknet.upgradeLevel(i, 1)),
        new Upgrade(
          `ram`,
          i,
          ramCost,
          // RAM upgrades double the node's RAM each time.
          stats.production * (1.035 ** stats.ram - 1),
          () => ns.hacknet.upgradeRam(i, 1),
        ),
        new Upgrade(`cores`, i, coreCost, stats.production / (stats.cores + 5), () => ns.hacknet.upgradeCore(i, 1)),
      )
    }

    const purchaseCost = ns.hacknet.getPurchaseNodeCost()
    // Bootstrap: with no nodes yet there's no production to scale from, so
    // just make sure the first node always wins.
    const purchaseGain = ownedNodes === 0 ? 1 : productionUnit
    const purchaseRank
      = ownedNodes > 0 && formulasTrusted && productionUnit > 0 && Number.isFinite(purchaseCost) && purchaseCost <= budget
        ? simulateNodePurchase(purchaseCost, budget, productionUnit, mults)
        : null

    candidates.push(
      new Upgrade(
        `purchase`,
        -1,
        purchaseCost,
        purchaseGain,
        () => ns.hacknet.purchaseNode(),
        purchaseRank?.cost,
        purchaseRank?.gain,
      ),
    )

    // Pick the affordable candidate with the best $/s-per-$ ratio,
    // i.e. the fastest payback, instead of just the priciest affordable
    // one.
    let bestUpgrade: Upgrade | null = null
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.cost) || candidate.cost > budget)
        continue
      if (bestUpgrade === null || candidate.ratio > bestUpgrade.ratio) {
        bestUpgrade = candidate
      }
    }

    if (bestUpgrade === null || bestUpgrade.ratio <= 0) {
      await ns.sleep(5000)
      continue
    }

    // const MAX_PAYBACK_SECONDS = 10_000
    // if (1 / bestUpgrade.ratio >= MAX_PAYBACK_SECONDS) {
    //   ns.print(`No best upgrade with payback < ${MAX_PAYBACK_SECONDS}s`)
    //   await ns.sleep(60_000)
    //   continue
    // }

    bestUpgrade.func()
    const payback = `pays back in ${(1 / bestUpgrade.ratio).toFixed(1)}s`
    if (bestUpgrade.type === `purchase`) {
      const bundled = bestUpgrade.rankCost !== bestUpgrade.cost
      ns.print(
        `Purchased node for ${formatMoney(bestUpgrade.cost)} (${
          bundled ? `est. payback incl. planned early upgrades: ${(1 / bestUpgrade.ratio).toFixed(1)}s` : payback
        }).`,
      )
    }
    else {
      ns.print(
        `Upgraded hacknet-node-${bestUpgrade.node} ${
          bestUpgrade.type
        } for ${formatMoney(bestUpgrade.cost)} (${payback}).`,
      )
    }
  }
}
