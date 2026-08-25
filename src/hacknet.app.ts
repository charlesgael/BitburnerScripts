import { NS } from "@ns";

class Upgrade {
    constructor(
        public type: string,
        public node: number,
        public cost: number,
        /** Estimated $/s this upgrade adds, on the same scale across all candidates. */
        public gain: number,
        public func: () => void
    ) {}

    /** $ produced per second, per $ spent. Higher = better payback. */
    get ratio(): number {
        return this.cost > 0 ? this.gain / this.cost : 0;
    }
}

function formatMoney(amount: number): string {
    return Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        currencyDisplay: "narrowSymbol",
        currencySign: "accounting",
        maximumFractionDigits: 3,
    }).format(amount);
}

/**
 * Hacknet node production, up to the shared (and irrelevant-for-comparison)
 * constant factor of `MoneyGainPerLevel * player production mult`. Only used
 * to compare candidate upgrades against each other, never as an absolute
 * $/s figure - see `productionUnit` below for how an absolute figure is
 * derived from a real node's real production.
 */
function relativeProduction(level: number, ram: number, cores: number): number {
    return level * Math.pow(1.035, ram - 1) * ((cores + 5) / 6);
}

export async function main(ns: NS) {
    ns.disableLog(`ALL`);
    while (true) {
        // Budget cap so a single upgrade never eats the whole bankroll.
        const budget = ns.getPlayer().money * 0.25;
        const ownedNodes = ns.hacknet.numNodes();

        // Derive $/s per unit of relativeProduction from a real node's real
        // production, so a brand-new node's expected production can be
        // compared against upgrades to existing nodes on the same $/s scale.
        let productionUnit = 0;
        if (ownedNodes > 0) {
            const stats = ns.hacknet.getNodeStats(0);
            const relative = relativeProduction(stats.level, stats.ram, stats.cores);
            if (relative > 0) productionUnit = stats.production / relative;
        }

        const candidates: Upgrade[] = [
            new Upgrade(
                `purchase`,
                -1,
                ns.hacknet.getPurchaseNodeCost(),
                // Bootstrap: with no nodes yet there's no production to scale
                // from, so just make sure the first node always wins.
                ownedNodes === 0 ? 1 : productionUnit,
                () => ns.hacknet.purchaseNode()
            ),
        ];

        for (let i = 0; i < ownedNodes; i++) {
            const stats = ns.hacknet.getNodeStats(i);

            candidates.push(
                new Upgrade(
                    `level`,
                    i,
                    ns.hacknet.getLevelUpgradeCost(i, 1),
                    stats.production / stats.level,
                    () => ns.hacknet.upgradeLevel(i, 1)
                ),
                new Upgrade(
                    `ram`,
                    i,
                    ns.hacknet.getRamUpgradeCost(i, 1),
                    // RAM upgrades double the node's RAM each time.
                    stats.production * (Math.pow(1.035, stats.ram) - 1),
                    () => ns.hacknet.upgradeRam(i, 1)
                ),
                new Upgrade(
                    `cores`,
                    i,
                    ns.hacknet.getCoreUpgradeCost(i, 1),
                    stats.production / (stats.cores + 5),
                    () => ns.hacknet.upgradeCore(i, 1)
                )
            );
        }

        // Pick the affordable candidate with the best $/s-per-$-spent ratio,
        // i.e. the fastest payback, instead of just the priciest affordable
        // one.
        let bestUpgrade: Upgrade | null = null;
        for (const candidate of candidates) {
            if (!Number.isFinite(candidate.cost) || candidate.cost > budget) continue;
            if (bestUpgrade === null || candidate.ratio > bestUpgrade.ratio) {
                bestUpgrade = candidate;
            }
        }

        if (bestUpgrade === null || bestUpgrade.ratio <= 0) {
            await ns.sleep(5000);
            continue;
        }

        bestUpgrade.func();
        const payback = `pays back in ${(1 / bestUpgrade.ratio).toFixed(1)}s`;
        if (bestUpgrade.type === `purchase`) {
            ns.print(
                `Purchased node for ${formatMoney(bestUpgrade.cost)} (${payback}).`
            );
        } else {
            ns.print(
                `Upgraded hacknet-node-${bestUpgrade.node} ${
                    bestUpgrade.type
                } for ${formatMoney(bestUpgrade.cost)} (${payback}).`
            );
        }
    }
}
