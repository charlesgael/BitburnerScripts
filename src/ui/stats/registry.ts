import { NS } from "@ns";

/**
 * One live stat shown in the overview panel's extra-hook row (see
 * `ui/components/overview-stats.ts`). Listed below in ascending RAM-cost
 * order so it reads as a menu — skim from the top until you've spent as
 * much as you're willing to on this.
 *
 * IMPORTANT: `enabled: false` stops a provider from being *called*, so it
 * stops costing runtime — but it does NOT shrink ui.app.js's own RAM cost.
 * Bitburner charges a script for every ns.* function its reachable code
 * merely *references*, whether or not that code path ever executes — the
 * same rule that sent Trainer's `ns.singularity.*` calls into their own
 * script (see `daemons/train.daemon.ts`). This file is always imported into
 * `ui.app.ts`, so every cost documented below is already baked into
 * ui.app.js's fixed footprint the instant a provider is added here,
 * `enabled` or not. To actually not pay for one, delete it from this file
 * — or move it into its own spawned script, the way Trainer/Programs do.
 *
 * Hacking level and money are deliberately not here — the game's own
 * default overview already shows both.
 */
export type StatValue =
    | { kind: "text"; label: string; value: string }
    | { kind: "bar"; label: string; value: string; pct: number };

export interface StatProvider {
    id: string;
    label: string;
    /** GB — matches the `RAM cost` line(s) in NetscriptDefinitions.d.ts
     * for whatever `compute` calls; see the comment on each entry. */
    ramCost: number;
    enabled: boolean;
    /** Called with the real `ns` directly (not the queued proxy) — see
     * `overview-stats.ts` for why. */
    compute: (ns: NS) => Promise<StatValue>;
}

function formatCompact(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2) + "t";
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "b";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "m";
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + "k";
    return n.toFixed(0);
}

export const STAT_PROVIDERS: StatProvider[] = [
    {
        id: "home-ram",
        label: "Home RAM",
        // ns.getServerUsedRam + ns.getServerMaxRam — RAM cost: 0.05 GB each
        // = 0.10 GB. Both are already referenced by the Programs/Trainer
        // apps, so this entry adds nothing new on top of those.
        ramCost: 0.1,
        enabled: true,
        compute: async (ns) => {
            const [used, max] = await Promise.all([ns.getServerUsedRam("home"), ns.getServerMaxRam("home")]);
            const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
            return { kind: "bar", label: "RAM", value: `${used.toFixed(0)}/${max.toFixed(0)}GB`, pct };
        },
    },
    {
        id: "karma",
        label: "Karma",
        // ns.getPlayer — RAM cost: 0.5 GB. Only reads .karma here, but the
        // same call is already paid for by the Trainer app, so this entry
        // adds nothing new on top of it either.
        ramCost: 0.5,
        enabled: true,
        compute: async (ns) => ({
            kind: "text",
            label: "Karma",
            value: (ns.getPlayer()).karma.toFixed(0),
        }),
    },
    {
        id: "hacknet-revenue",
        label: "Hacknet",
        // ns.hacknet.numNodes + ns.hacknet.getNodeStats — RAM cost: 0.5 GB
        // each = 1.0 GB. getNodeStats().production is documented as
        // "production per second" (money, for classic Hacknet Nodes), so
        // this sums the live rate across every node rather than a lifetime
        // total — ns.getMoneySources() would've been cheaper as a single
        // call for the same 1.0 GB, but it only exposes cumulative totals,
        // not a per-second rate.
        ramCost: 1.0,
        enabled: true,
        compute: async (ns) => {
            const count = ns.hacknet.numNodes();
            let perSecond = 0;
            for (let i = 0; i < count; i++) {
                perSecond += (ns.hacknet.getNodeStats(i)).production;
            }
            return { kind: "text", label: "Hacknet", value: `$${formatCompact(perSecond)}/s` };
        },
    },
];
